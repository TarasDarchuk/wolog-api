import 'dotenv/config';
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

  const BATCH_SIZE = 50;
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < raw.length; i += BATCH_SIZE) {
    const batch = raw.slice(i, i + BATCH_SIZE);
    const ops = batch.map((ex) => {
      const equipment = equipmentMap[ex.equipment] || 'other';
      const primaryMuscle = muscleGroupMap[ex.primaryMuscles[0]] || 'other';
      const exerciseType = ex.exerciseType || 'weightReps';

      return prisma.exercise.upsert({
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
    });

    try {
      await prisma.$transaction(ops);
      created += batch.length;
    } catch (error) {
      console.warn(`Batch at index ${i} failed:`, error.message);
      skipped += batch.length;
    }

    console.log(`Progress: ${Math.min(i + BATCH_SIZE, raw.length)}/${raw.length}`);
  }

  console.log(`Seeded ${created} exercises (${skipped} skipped)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
