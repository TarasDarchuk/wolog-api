import { ExerciseSyncService } from './exercise-sync.service';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  PAST,
  FUTURE,
  makeExercisePushDto,
  makeExistingExercise,
} from '../../__mocks__/prisma.mock';

describe('ExerciseSyncService', () => {
  let service: ExerciseSyncService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new ExerciseSyncService(prisma as any);
  });

  // ─── Push ──────────────────────────────────────────────────────────────

  describe('push', () => {
    it('accepts a new exercise', async () => {
      prisma.exercise.findUnique.mockResolvedValue(null);
      prisma.exercise.upsert.mockResolvedValue({});

      const result = await service.push(USER_ID, [makeExercisePushDto()]);

      expect(result.accepted).toEqual(['exercise-1']);
      expect(result.rejected).toEqual([]);
      expect(prisma.exercise.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exercise-1' },
          create: expect.objectContaining({
            userId: USER_ID,
            isCustom: true,
          }),
        }),
      );
    });

    it('accepts update when client is newer', async () => {
      prisma.exercise.findUnique.mockResolvedValue(
        makeExistingExercise({ updatedAt: new Date(PAST) }),
      );
      prisma.exercise.upsert.mockResolvedValue({});

      const result = await service.push(USER_ID, [makeExercisePushDto()]);

      expect(result.accepted).toEqual(['exercise-1']);
    });

    it('rejects when server is newer', async () => {
      prisma.exercise.findUnique.mockResolvedValue(
        makeExistingExercise({ updatedAt: new Date(FUTURE) }),
      );

      const result = await service.push(USER_ID, [makeExercisePushDto()]);

      expect(result.rejected).toEqual([
        { id: 'exercise-1', reason: 'server_newer' },
      ]);
      expect(prisma.exercise.upsert).not.toHaveBeenCalled();
    });

    it('rejects when userId does not match (forbidden)', async () => {
      prisma.exercise.findUnique.mockResolvedValue(
        makeExistingExercise({ userId: OTHER_USER_ID }),
      );

      const result = await service.push(USER_ID, [makeExercisePushDto()]);

      expect(result.rejected).toEqual([
        { id: 'exercise-1', reason: 'forbidden' },
      ]);
    });

    it('accepts soft delete (deletedAt set)', async () => {
      prisma.exercise.findUnique.mockResolvedValue(null);
      prisma.exercise.upsert.mockResolvedValue({});

      const dto = makeExercisePushDto({ deletedAt: NOW });
      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['exercise-1']);
      expect(prisma.exercise.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            deletedAt: new Date(NOW),
          }),
        }),
      );
    });

    it('rejects with error on exception', async () => {
      prisma.exercise.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.push(USER_ID, [makeExercisePushDto()]);

      expect(result.rejected).toEqual([
        { id: 'exercise-1', reason: 'error' },
      ]);
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('returns all when no since provided', async () => {
      const records = [makeExistingExercise()];
      prisma.exercise.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.data).toEqual(records);
      expect(result.hasMore).toBe(false);
      expect(result.cursor).toBe(new Date(NOW).toISOString());
      expect(prisma.exercise.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID },
          take: 51,
        }),
      );
    });

    it('filters by updatedAt when since is provided', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      await service.pull(USER_ID, PAST, 50);

      expect(prisma.exercise.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID, updatedAt: { gt: new Date(PAST) } },
        }),
      );
    });

    it('detects hasMore with limit+1 trick', async () => {
      const records = Array.from({ length: 3 }, (_, i) =>
        makeExistingExercise({ id: `ex-${i}` }),
      );
      prisma.exercise.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 2);

      expect(result.hasMore).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('returns since as cursor when empty', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      const result = await service.pull(USER_ID, PAST, 50);

      expect(result.cursor).toBe(PAST);
    });

    it('returns null cursor when empty and no since', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.cursor).toBeNull();
    });
  });

  // ─── getLatestTimestamp ────────────────────────────────────────────────

  describe('getLatestTimestamp', () => {
    it('returns ISO string of latest updatedAt', async () => {
      prisma.exercise.findFirst.mockResolvedValue({
        updatedAt: new Date(NOW),
      });

      const result = await service.getLatestTimestamp(USER_ID);

      expect(result).toBe(new Date(NOW).toISOString());
    });

    it('returns null when no records', async () => {
      prisma.exercise.findFirst.mockResolvedValue(null);

      const result = await service.getLatestTimestamp(USER_ID);

      expect(result).toBeNull();
    });
  });
});
