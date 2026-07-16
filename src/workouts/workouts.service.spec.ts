import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  PAST,
} from '../__mocks__/prisma.mock.js';
import { epleyE1Rm, WorkoutsService } from './workouts.service.js';

function makeSet(overrides: Record<string, unknown> = {}) {
  return {
    setNumber: 1,
    weight: 100,
    reps: 5,
    duration: null,
    distance: null,
    type: 'normal',
    isCompleted: true,
    ...overrides,
  };
}

describe('epleyE1Rm', () => {
  it('returns the weight itself for a single', () => {
    expect(epleyE1Rm(100, 1)).toBe(100);
  });

  it('applies the Epley formula for reps > 1', () => {
    expect(epleyE1Rm(100, 5)).toBeCloseTo(116.67, 1);
    expect(epleyE1Rm(60, 10)).toBeCloseTo(80, 1);
  });

  it('returns null when weight or reps are missing', () => {
    expect(epleyE1Rm(null, 5)).toBeNull();
    expect(epleyE1Rm(100, null)).toBeNull();
    expect(epleyE1Rm(0, 5)).toBeNull();
  });
});

describe('WorkoutsService', () => {
  let service: WorkoutsService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(WorkoutsService);
  });

  describe('listWorkouts', () => {
    it('returns completed workouts with exercises and kg sets', async () => {
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'workout-1',
          name: 'Push Day',
          startedAt: new Date(NOW),
          completedAt: new Date(NOW),
          exercises: [
            {
              exerciseId: 'ex-1',
              exercise: { name: 'Bench Press (Barbell)' },
              sets: [makeSet()],
            },
          ],
        },
      ]);

      const result = await service.listWorkouts(USER_ID, { limit: 20 });
      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].exercises[0]).toMatchObject({
        exerciseId: 'ex-1',
        name: 'Bench Press (Barbell)',
        sets: [expect.objectContaining({ weight: 100, reps: 5 })],
      });
      // Only completed, non-deleted workouts are eligible.
      const where = prisma.workout.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.completedAt).toEqual({
        not: null,
        // Zero-duration sessions (discarded in the app after syncing) are
        // excluded via a column comparison against startedAt.
        gt: prisma.workout.fields.startedAt,
      });
      expect(where.exercises).toEqual({
        some: { sets: { some: { isCompleted: true } } },
      });
    });

    it('only fetches performed (completed) sets', async () => {
      prisma.workout.findMany.mockResolvedValue([]);
      await service.listWorkouts(USER_ID, { limit: 20 });
      const include = prisma.workout.findMany.mock.calls[0][0].include;
      expect(include.exercises.include.sets.where).toEqual({
        isCompleted: true,
      });
    });

    it('drops exercises whose sets were all skipped', async () => {
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'workout-1',
          name: 'Push Day',
          startedAt: new Date(PAST),
          completedAt: new Date(NOW),
          exercises: [
            {
              exerciseId: 'ex-1',
              exercise: { name: 'Bench Press (Barbell)' },
              sets: [makeSet()],
            },
            {
              exerciseId: 'ex-2',
              exercise: { name: 'Face Pull' },
              // All sets skipped → filtered out by the query's set filter.
              sets: [],
            },
          ],
        },
      ]);

      const result = await service.listWorkouts(USER_ID, { limit: 20 });
      expect(result.workouts[0].exercises).toHaveLength(1);
      expect(result.workouts[0].exercises[0].exerciseId).toBe('ex-1');
    });

    it('filters by exercise when exerciseId is given', async () => {
      prisma.workout.findMany.mockResolvedValue([]);
      await service.listWorkouts(USER_ID, { exerciseId: 'ex-1', limit: 5 });
      const where = prisma.workout.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { exercises: { some: { exerciseId: 'ex-1' } } },
      ]);
    });
  });

  describe('exerciseHistory', () => {
    beforeEach(() => {
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-1',
        name: 'Bench Press (Barbell)',
        userId: null,
        deletedAt: null,
      });
    });

    it('derives the best set and e1RM per session', async () => {
      prisma.workout.findMany.mockResolvedValue([
        {
          id: 'workout-1',
          name: 'Push Day',
          completedAt: new Date(NOW),
          exercises: [
            {
              sets: [
                makeSet({ setNumber: 1, weight: 100, reps: 5 }),
                makeSet({ setNumber: 2, weight: 102.5, reps: 3 }),
              ],
            },
          ],
        },
      ]);

      const result = await service.exerciseHistory(USER_ID, 'ex-1', 10);
      expect(result.name).toBe('Bench Press (Barbell)');
      expect(result.sessions).toHaveLength(1);

      const session = result.sessions[0];
      // 102.5×3 → e1RM 112.75 loses to 100×5 → 116.67.
      expect(session.bestSet).toMatchObject({ weight: 100, reps: 5 });
      expect(session.estimatedOneRepMax).toBeCloseTo(116.67, 1);
      expect(session.sets).toHaveLength(2);
    });

    it('only counts sessions and sets that were actually performed', async () => {
      prisma.workout.findMany.mockResolvedValue([]);
      await service.exerciseHistory(USER_ID, 'ex-1', 10);

      const query = prisma.workout.findMany.mock.calls[0][0];
      expect(query.where.completedAt).toEqual({
        not: null,
        gt: prisma.workout.fields.startedAt,
      });
      expect(query.where.exercises).toEqual({
        some: { exerciseId: 'ex-1', sets: { some: { isCompleted: true } } },
      });
      expect(query.include.exercises.include.sets.where).toEqual({
        isCompleted: true,
      });
    });

    it("hides another user's custom exercise", async () => {
      prisma.exercise.findUnique.mockResolvedValue({
        id: 'ex-9',
        name: 'Secret Move',
        userId: OTHER_USER_ID,
        deletedAt: null,
      });
      await expect(
        service.exerciseHistory(USER_ID, 'ex-9', 10),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
