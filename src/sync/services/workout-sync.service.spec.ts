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
  createMockStorageService,
  MockStorageService,
} from '../../__mocks__/prisma.mock';

const PHOTO_A = '11111111-1111-4111-8111-111111111111';
const PHOTO_B = '22222222-2222-4222-8222-222222222222';

function makePhotoDto(id: string, sortOrder = 0) {
  return { id, sortOrder, width: 1536, height: 2048, createdAt: PAST };
}

function makePhotoRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: USER_ID,
    workoutId: 'workout-1',
    sortOrder: 0,
    width: 1536,
    height: 2048,
    createdAt: new Date(PAST),
    uploadedAt: null,
    byteSize: null,
    ...overrides,
  };
}

describe('WorkoutSyncService', () => {
  let service: WorkoutSyncService;
  let prisma: MockPrismaService;
  let storage: MockStorageService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();
    service = new WorkoutSyncService(prisma as any, storage as any);
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

      expect(result.rejected).toEqual([{ id: 'workout-1', reason: 'error' }]);
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

  // ─── Push: photos ──────────────────────────────────────────────────────

  describe('push photos', () => {
    beforeEach(() => {
      prisma.workout.findUnique.mockResolvedValue(
        makeExistingWorkout({ updatedAt: new Date(PAST) }),
      );
      prisma.workout.upsert.mockResolvedValue({});
      prisma.workoutExercise.createMany.mockResolvedValue({ count: 1 });
      prisma.exerciseSet.createMany.mockResolvedValue({ count: 1 });
      prisma.photo.findMany.mockResolvedValue([]);
      prisma.photo.upsert.mockResolvedValue({});
      prisma.photo.deleteMany.mockResolvedValue({ count: 0 });
    });

    it('leaves photos untouched when the key is missing (old clients)', async () => {
      const result = await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(result.accepted).toEqual(['workout-1']);
      expect(prisma.photo.findMany).not.toHaveBeenCalled();
      expect(prisma.photo.upsert).not.toHaveBeenCalled();
      expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
      expect(storage.deleteQuietly).not.toHaveBeenCalled();
    });

    it('deletes all photos and their objects when photos is []', async () => {
      prisma.photo.findMany.mockResolvedValue([
        { id: PHOTO_A },
        { id: PHOTO_B },
      ]);

      const result = await service.push(USER_ID, [
        makeWorkoutPushDto({ photos: [] }),
      ]);

      expect(result.accepted).toEqual(['workout-1']);
      expect(prisma.photo.findMany).toHaveBeenCalledWith({
        where: { workoutId: 'workout-1', id: { notIn: [] } },
        select: { id: true },
      });
      expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [PHOTO_A, PHOTO_B] } },
      });
      expect(storage.deleteQuietly).toHaveBeenCalledWith([
        `photos/${USER_ID}/${PHOTO_A}.jpg`,
        `photos/${USER_ID}/${PHOTO_B}.jpg`,
      ]);
    });

    it('deletes storage objects only after the transaction commits', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const res = await cb(prisma);
        order.push('commit');
        return res;
      });
      storage.deleteQuietly.mockImplementation(async () => {
        order.push('storage');
      });
      prisma.photo.findMany
        .mockResolvedValueOnce([]) // ownership check
        .mockResolvedValueOnce([{ id: PHOTO_B }]); // removed photos

      await service.push(USER_ID, [
        makeWorkoutPushDto({ photos: [makePhotoDto(PHOTO_A)] }),
      ]);

      expect(order).toEqual(['commit', 'storage']);
    });

    it('does not delete storage objects when the transaction fails', async () => {
      prisma.photo.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: PHOTO_B }]);
      prisma.photo.upsert.mockRejectedValue(new Error('DB error'));

      const result = await service.push(USER_ID, [
        makeWorkoutPushDto({ photos: [makePhotoDto(PHOTO_A)] }),
      ]);

      expect(result.rejected).toEqual([{ id: 'workout-1', reason: 'error' }]);
      expect(storage.deleteQuietly).not.toHaveBeenCalled();
    });

    it('upserts photos without ever touching uploadedAt', async () => {
      // PHOTO_A is already uploaded on the server
      prisma.photo.findMany.mockResolvedValue([]);

      await service.push(USER_ID, [
        makeWorkoutPushDto({ photos: [makePhotoDto(PHOTO_A, 3)] }),
      ]);

      expect(prisma.photo.upsert).toHaveBeenCalledWith({
        where: { id: PHOTO_A },
        create: {
          id: PHOTO_A,
          userId: USER_ID,
          workoutId: 'workout-1',
          sortOrder: 3,
          width: 1536,
          height: 2048,
          createdAt: new Date(PAST),
        },
        update: {
          workoutId: 'workout-1',
          sortOrder: 3,
          width: 1536,
          height: 2048,
        },
      });
      const call = prisma.photo.upsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty('uploadedAt');
      expect(call.update).not.toHaveProperty('byteSize');
      expect(call.create).not.toHaveProperty('uploadedAt');
    });

    it('keeps listed photos and deletes only the unlisted ones', async () => {
      prisma.photo.findMany
        .mockResolvedValueOnce([{ userId: USER_ID }])
        .mockResolvedValueOnce([{ id: PHOTO_B }]);

      await service.push(USER_ID, [
        makeWorkoutPushDto({ photos: [makePhotoDto(PHOTO_A)] }),
      ]);

      expect(prisma.photo.findMany).toHaveBeenLastCalledWith({
        where: { workoutId: 'workout-1', id: { notIn: [PHOTO_A] } },
        select: { id: true },
      });
      expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [PHOTO_B] } },
      });
      expect(storage.deleteQuietly).toHaveBeenCalledWith([
        `photos/${USER_ID}/${PHOTO_B}.jpg`,
      ]);
    });

    it('does not rebuild photos with the other children', async () => {
      await service.push(USER_ID, [makeWorkoutPushDto()]);

      expect(prisma.exerciseSet.deleteMany).toHaveBeenCalled();
      expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
    });

    it('checks photo ownership by the photo owner (workout or measurement photo)', async () => {
      await service.push(USER_ID, [
        makeWorkoutPushDto({ photos: [makePhotoDto(PHOTO_A)] }),
      ]);

      expect(prisma.photo.findMany).toHaveBeenNthCalledWith(1, {
        where: { id: { in: [PHOTO_A] } },
        select: { userId: true },
      });
    });

    it("rejects a workout claiming another user's photo as forbidden", async () => {
      prisma.photo.findMany.mockResolvedValueOnce([{ userId: OTHER_USER_ID }]);

      const result = await service.push(USER_ID, [
        makeWorkoutPushDto({ photos: [makePhotoDto(PHOTO_A)] }),
      ]);

      expect(result.rejected).toEqual([
        { id: 'workout-1', reason: 'forbidden' },
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.photo.upsert).not.toHaveBeenCalled();
    });

    it('creates photos for a new workout without looking for removals', async () => {
      prisma.workout.findUnique.mockResolvedValue(null);

      const result = await service.push(USER_ID, [
        makeWorkoutPushDto({
          photos: [makePhotoDto(PHOTO_A, 0), makePhotoDto(PHOTO_B, 1)],
        }),
      ]);

      expect(result.accepted).toEqual(['workout-1']);
      expect(prisma.photo.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
      // Only the ownership check queried photos
      expect(prisma.photo.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('returns all with includes when no since', async () => {
      const records = [makeExistingWorkout({ photos: [] })];
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
            photos: { orderBy: { sortOrder: 'asc' } },
          }),
          take: 51,
        }),
      );
    });

    it('returns photos with `uploaded` and without server-only fields', async () => {
      prisma.workout.findMany.mockResolvedValue([
        makeExistingWorkout({
          photos: [
            makePhotoRow(PHOTO_A, {
              sortOrder: 0,
              uploadedAt: new Date(NOW),
              byteSize: 412345,
            }),
            makePhotoRow(PHOTO_B, { sortOrder: 1 }),
          ],
        }),
      ]);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.data[0].photos).toEqual([
        {
          id: PHOTO_A,
          sortOrder: 0,
          width: 1536,
          height: 2048,
          createdAt: new Date(PAST),
          uploaded: true,
        },
        {
          id: PHOTO_B,
          sortOrder: 1,
          width: 1536,
          height: 2048,
          createdAt: new Date(PAST),
          uploaded: false,
        },
      ]);
    });

    it('always includes a photos array', async () => {
      prisma.workout.findMany.mockResolvedValue([
        makeExistingWorkout({ photos: [] }),
      ]);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.data[0].photos).toEqual([]);
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
