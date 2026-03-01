import { WorkoutSyncService } from './workout-sync.service';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  PAST,
  FUTURE,
  makeWorkoutPushDto,
  makeExistingWorkout,
} from '../../__mocks__/prisma.mock';

describe('WorkoutSyncService', () => {
  let service: WorkoutSyncService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new WorkoutSyncService(prisma as any);
  });

  // ─── Push ──────────────────────────────────────────────────────────────

  describe('push', () => {
    it('accepts a new workout', async () => {
      prisma.workout.findUnique.mockResolvedValue(null);
      prisma.workout.upsert.mockResolvedValue({});
      prisma.workoutExercise.createMany.mockResolvedValue({ count: 1 });
      prisma.exerciseSet.createMany.mockResolvedValue({ count: 1 });

      const result = await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(result.accepted).toEqual(['workout-1']);
      expect(result.rejected).toEqual([]);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('accepts update when client is newer — deletes children first', async () => {
      prisma.workout.findUnique.mockResolvedValue(
        makeExistingWorkout({ updatedAt: new Date(PAST) }),
      );
      prisma.workout.upsert.mockResolvedValue({});
      prisma.workoutExercise.createMany.mockResolvedValue({ count: 1 });
      prisma.exerciseSet.createMany.mockResolvedValue({ count: 1 });
      prisma.exerciseSet.deleteMany.mockResolvedValue({ count: 0 });
      prisma.workoutExercise.deleteMany.mockResolvedValue({ count: 0 });
      prisma.workoutSuperset.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(result.accepted).toEqual(['workout-1']);
      // Verify children were deleted before re-creation
      expect(prisma.exerciseSet.deleteMany).toHaveBeenCalled();
      expect(prisma.workoutExercise.deleteMany).toHaveBeenCalled();
      expect(prisma.workoutSuperset.deleteMany).toHaveBeenCalled();
    });

    it('rejects when server is newer', async () => {
      prisma.workout.findUnique.mockResolvedValue(
        makeExistingWorkout({ updatedAt: new Date(FUTURE) }),
      );

      const result = await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'workout-1', reason: 'server_newer' },
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when userId does not match (forbidden)', async () => {
      prisma.workout.findUnique.mockResolvedValue(
        makeExistingWorkout({ userId: OTHER_USER_ID }),
      );

      const result = await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'workout-1', reason: 'forbidden' },
      ]);
    });

    it('accepts soft delete (deletedAt set)', async () => {
      prisma.workout.findUnique.mockResolvedValue(null);
      prisma.workout.upsert.mockResolvedValue({});
      prisma.workoutExercise.createMany.mockResolvedValue({ count: 1 });
      prisma.exerciseSet.createMany.mockResolvedValue({ count: 1 });

      const dto = makeWorkoutPushDto({ deletedAt: NOW });
      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['workout-1']);
      expect(prisma.workout.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            deletedAt: new Date(NOW),
          }),
        }),
      );
    });

    it('rejects with error on exception', async () => {
      prisma.workout.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'workout-1', reason: 'error' },
      ]);
    });

    it('creates supersets when provided', async () => {
      prisma.workout.findUnique.mockResolvedValue(null);
      prisma.workout.upsert.mockResolvedValue({});
      prisma.workoutExercise.createMany.mockResolvedValue({ count: 0 });
      prisma.workoutSuperset.createMany.mockResolvedValue({ count: 1 });

      const dto = makeWorkoutPushDto({
        exercises: [],
        supersets: [
          { id: 'ss-1', supersetColorIndex: 0, exerciseIds: ['ex-1', 'ex-2'] },
        ],
      });

      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['workout-1']);
      expect(prisma.workoutSuperset.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'ss-1',
            workoutId: 'workout-1',
            supersetColorIndex: 0,
            exerciseIds: ['ex-1', 'ex-2'],
          },
        ],
      });
    });

    it('creates exercise sets via createMany', async () => {
      prisma.workout.findUnique.mockResolvedValue(null);
      prisma.workout.upsert.mockResolvedValue({});
      prisma.workoutExercise.createMany.mockResolvedValue({ count: 1 });
      prisma.exerciseSet.createMany.mockResolvedValue({ count: 1 });

      await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(prisma.exerciseSet.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            id: 'set-1',
            workoutExerciseId: 'we-1',
            setNumber: 1,
            weight: 100,
            reps: 10,
          }),
        ],
      });
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('returns all with includes when no since', async () => {
      const records = [makeExistingWorkout()];
      prisma.workout.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.data).toEqual(records);
      expect(result.hasMore).toBe(false);
      expect(prisma.workout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID },
          include: expect.objectContaining({
            exercises: expect.anything(),
            supersets: true,
          }),
          take: 51,
        }),
      );
    });

    it('filters by updatedAt when since is provided', async () => {
      prisma.workout.findMany.mockResolvedValue([]);

      await service.pull(USER_ID, PAST, 50);

      expect(prisma.workout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER_ID,
            updatedAt: { gt: new Date(PAST) },
          },
        }),
      );
    });

    it('detects hasMore with limit+1 trick', async () => {
      const records = Array.from({ length: 3 }, (_, i) =>
        makeExistingWorkout({ id: `w-${i}` }),
      );
      prisma.workout.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 2);

      expect(result.hasMore).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('returns since as cursor when empty', async () => {
      prisma.workout.findMany.mockResolvedValue([]);

      const result = await service.pull(USER_ID, PAST, 50);

      expect(result.cursor).toBe(PAST);
    });

    it('returns null cursor when empty and no since', async () => {
      prisma.workout.findMany.mockResolvedValue([]);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.cursor).toBeNull();
    });
  });

  // ─── getLatestTimestamp ────────────────────────────────────────────────

  describe('getLatestTimestamp', () => {
    it('returns ISO string of latest updatedAt', async () => {
      prisma.workout.findFirst.mockResolvedValue({
        updatedAt: new Date(NOW),
      });

      expect(await service.getLatestTimestamp(USER_ID)).toBe(
        new Date(NOW).toISOString(),
      );
    });

    it('returns null when no records', async () => {
      prisma.workout.findFirst.mockResolvedValue(null);

      expect(await service.getLatestTimestamp(USER_ID)).toBeNull();
    });
  });
});
