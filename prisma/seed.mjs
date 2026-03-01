import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find the generated Prisma client
let PrismaClient;
try {
  const mod = await import('../src/generated/prisma/client.js');
  PrismaClient = mod.PrismaClient;
} catch {
  const mod = await import('../dist/src/generated/prisma/client.js');
  PrismaClient = mod.PrismaClient;
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const equipmentMap = {
  Barbell: 'barbell',
  Dumbbell: 'dumbbell',
  Bodyweight: 'bodyweight',
  None: 'bodyweight',
  Cable: 'cable',
  Machine: 'machine',
  Kettlebell: 'kettlebell',
  Plate: 'plate',
  'Resistance Band': 'resistanceBand',
  Suspension: 'suspension',
  Other: 'other',
};

const muscleGroupMap = {
  Chest: 'chest',
  Lats: 'lats',
  'Lower Back': 'lowerBack',
  Traps: 'traps',
  'Upper Back': 'upperBack',
  Abductors: 'abductors',
  Adductors: 'adductors',
  Calves: 'calves',
  Tibialis: 'tibialis',
  Glutes: 'glutes',
  Hamstrings: 'hamstrings',
  Quadriceps: 'quadriceps',
  Shoulders: 'shoulders',
  Neck: 'neck',
  Biceps: 'biceps',
  Triceps: 'triceps',
  Forearms: 'forearms',
  Abdominals: 'abdominals',
  Cardio: 'cardio',
  'Full Body': 'fullBody',
  Other: 'other',
};

async function main() {
  console.log('Seeding exercises...');

  const possiblePaths = [
    join(__dirname, 'exercises.json'),
    join(__dirname, '..', '..', 'wolog', 'wolog', 'Resources', 'exercises.json'),
  ];

  let exercisesPath = null;
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      exercisesPath = p;
      break;
    }
  }

  if (!exercisesPath) {
    console.error('exercises.json not found. Tried:', possiblePaths);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(exercisesPath, 'utf-8'));
  console.log(`Found ${raw.length} exercises in ${exercisesPath}`);

  let created = 0;
  let skipped = 0;

  for (const ex of raw) {
    const equipment = equipmentMap[ex.equipment] || 'other';
    const primaryMuscle = muscleGroupMap[ex.primaryMuscles[0]] || 'other';
    const exerciseType = ex.exerciseType || 'weightReps';

    try {
      await prisma.exercise.upsert({
        where: { id: ex.id },
        create: {
          id: ex.id,
          userId: null,
          name: ex.name,
          muscleGroup: primaryMuscle,
          equipment,
          exerciseType,
          isCustom: false,
          thumbnailUrl: ex.thumbnailUrl || null,
          videoUrl: ex.videoUrl || null,
          primaryMuscles: ex.primaryMuscles.map(m => muscleGroupMap[m] || m.toLowerCase()),
          secondaryMuscles: ex.secondaryMuscles.map(m => muscleGroupMap[m] || m.toLowerCase()),
        },
        update: {},
      });
      created++;
    } catch (error) {
      console.warn(`Skipped exercise "${ex.name}" (${ex.id}):`, error.message);
      skipped++;
    }
  }

  console.log(`Seeded ${created} exercises (${skipped} skipped)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
