/**
 * Shared mock factory for Prisma and DTO builders used across all test files.
 */

// ─── Mock PrismaService ────────────────────────────────────────────────────

function createModelMock() {
  return {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

export function createMockPrismaService() {
  const mock = {
    user: createModelMock(),
    refreshToken: createModelMock(),
    workout: createModelMock(),
    workoutExercise: createModelMock(),
    exerciseSet: createModelMock(),
    workoutSuperset: createModelMock(),
    exercise: createModelMock(),
    workoutTemplate: createModelMock(),
    templateItem: createModelMock(),
    templateExercise: createModelMock(),
    templateSet: createModelMock(),
    templateSuperset: createModelMock(),
    bodyMeasurement: createModelMock(),
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  // $transaction calls the callback with the same mock (tx has same shape)
  mock.$transaction.mockImplementation((cb: (tx: typeof mock) => Promise<unknown>) => cb(mock));

  return mock;
}

export type MockPrismaService = ReturnType<typeof createMockPrismaService>;

// ─── DTO Builders ──────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-other';
const NOW = '2025-06-01T12:00:00.000Z';
const PAST = '2025-05-01T12:00:00.000Z';
const FUTURE = '2025-07-01T12:00:00.000Z';

export { USER_ID, OTHER_USER_ID, NOW, PAST, FUTURE };

export function makeWorkoutPushDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workout-1',
    name: 'Push Day',
    startedAt: NOW,
    completedAt: NOW,
    notes: '',
    activeCalories: 200,
    updatedAt: NOW,
    exercises: [
      {
        id: 'we-1',
        exerciseId: 'ex-1',
        sortOrder: 0,
        notes: '',
        sets: [
          {
            id: 'set-1',
            setNumber: 1,
            weight: 100,
            reps: 10,
            isCompleted: true,
            type: 'normal',
          },
        ],
      },
    ],
    supersets: [],
    ...overrides,
  };
}

export function makeExercisePushDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exercise-1',
    name: 'Custom Curl',
    muscleGroup: 'biceps',
    equipment: 'dumbbell',
    exerciseType: 'weightReps',
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeMeasurementPushDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'measurement-1',
    date: NOW,
    type: 'weight',
    value: 80.5,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeTemplatePushDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    name: 'Push Day Template',
    notes: '',
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: 'item-1',
        sortOrder: 0,
        exercise: {
          id: 'texercise-1',
          exerciseId: 'ex-1',
          sortOrder: 0,
          targetSets: 3,
          targetReps: 10,
          sets: [
            {
              id: 'tset-1',
              setNumber: 1,
              targetWeight: 100,
              targetReps: 10,
            },
          ],
        },
      },
    ],
    supersets: [],
    ...overrides,
  };
}

// ─── Existing Record Builders (DB records with Date objects) ───────────────

export function makeExistingWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workout-1',
    userId: USER_ID,
    name: 'Push Day',
    startedAt: new Date(NOW),
    completedAt: new Date(NOW),
    notes: '',
    activeCalories: 200,
    updatedAt: new Date(NOW),
    deletedAt: null,
    ...overrides,
  };
}

export function makeExistingExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exercise-1',
    userId: USER_ID,
    name: 'Custom Curl',
    muscleGroup: 'biceps',
    equipment: 'dumbbell',
    exerciseType: 'weightReps',
    isCustom: true,
    restDuration: null,
    thumbnailUrl: null,
    videoUrl: null,
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    updatedAt: new Date(NOW),
    deletedAt: null,
    ...overrides,
  };
}

export function makeExistingMeasurement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'measurement-1',
    userId: USER_ID,
    date: new Date(NOW),
    type: 'weight',
    value: 80.5,
    photoUrl: null,
    updatedAt: new Date(NOW),
    deletedAt: null,
    ...overrides,
  };
}

export function makeExistingTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    userId: USER_ID,
    name: 'Push Day Template',
    notes: '',
    sortOrder: 0,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    deletedAt: null,
    ...overrides,
  };
}

export function makeExistingUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'test@example.com',
    displayName: 'Test User',
    appleUserId: 'apple-sub-123',
    googleUserId: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}
