import { PrismaClient, Equipment, MuscleGroup, ExerciseType } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Maps from exercises.json display values → Prisma enum values
const equipmentMap: Record<string, Equipment> = {
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

const muscleGroupMap: Record<string, MuscleGroup> = {
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

interface RawExercise {
  id: string;
  name: string;
  equipment: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  thumbnailUrl: string;
  videoUrl: string;
  exerciseType: string;
}

async function main() {
  console.log('Seeding exercises...');

  // Try to find exercises.json in sibling iOS project or local copy
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'wolog', 'wolog', 'Resources', 'exercises.json'),
    path.join(__dirname, 'exercises.json'),
  ];

  let exercisesPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      exercisesPath = p;
      break;
    }
  }

  if (!exercisesPath) {
    console.error('exercises.json not found. Tried:', possiblePaths);
    process.exit(1);
  }

  const raw: RawExercise[] = JSON.parse(fs.readFileSync(exercisesPath, 'utf-8'));
  console.log(`Found ${raw.length} exercises in ${exercisesPath}`);

  let created = 0;
  let skipped = 0;

  for (const ex of raw) {
    const equipment = equipmentMap[ex.equipment] || 'other';
    const primaryMuscle = muscleGroupMap[ex.primaryMuscles[0]] || 'other';
    const exerciseType = (ex.exerciseType as ExerciseType) || 'weightReps';

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
          primaryMuscles: ex.primaryMuscles.map(
            (m) => muscleGroupMap[m] || m.toLowerCase(),
          ),
          secondaryMuscles: ex.secondaryMuscles.map(
            (m) => muscleGroupMap[m] || m.toLowerCase(),
          ),
        },
        update: {},
      });
      created++;
    } catch (error) {
      console.warn(`Skipped exercise "${ex.name}" (${ex.id}):`, (error as Error).message);
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
  .finally(async () => {
    await prisma.$disconnect();
  });
