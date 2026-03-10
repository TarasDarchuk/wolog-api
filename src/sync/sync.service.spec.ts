import { SyncService } from './sync.service';
import {
  createMockPrismaService,
  USER_ID,
  NOW,
  PAST,
} from '../__mocks__/prisma.mock';

function createMockEntitySyncService() {
  return {
    push: jest.fn().mockResolvedValue({ accepted: [], rejected: [] }),
    pull: jest.fn().mockResolvedValue({ data: [], cursor: null, hasMore: false }),
    getLatestTimestamp: jest.fn().mockResolvedValue(null),
  };
}

describe('SyncService', () => {
  let service: SyncService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let workoutSync: ReturnType<typeof createMockEntitySyncService>;
  let exerciseSync: ReturnType<typeof createMockEntitySyncService>;
  let templateSync: ReturnType<typeof createMockEntitySyncService>;
  let measurementSync: ReturnType<typeof createMockEntitySyncService>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    workoutSync = createMockEntitySyncService();
    exerciseSync = createMockEntitySyncService();
    templateSync = createMockEntitySyncService();
    measurementSync = createMockEntitySyncService();

    service = new SyncService(
      prisma as any,
      workoutSync as any,
      exerciseSync as any,
      templateSync as any,
      measurementSync as any,
    );
  });

  // ─── Push ──────────────────────────────────────────────────────────────

  describe('push', () => {
    it('processes exercises first, then others', async () => {
      const callOrder: string[] = [];
      exerciseSync.push.mockImplementation(async () => {
        callOrder.push('exercises');
        return { accepted: ['e1'], rejected: [] };
      });
      workoutSync.push.mockImplementation(async () => {
        callOrder.push('workouts');
        return { accepted: ['w1'], rejected: [] };
      });

      const result = await service.push(USER_ID, {
        exercises: [{ id: 'e1' } as any],
        workouts: [{ id: 'w1' } as any],
      });

      expect(callOrder).toEqual(['exercises', 'workouts']);
      expect(result.exercises.accepted).toEqual(['e1']);
      expect(result.workouts.accepted).toEqual(['w1']);
    });

    it('skips entity types not present in dto', async () => {
      const result = await service.push(USER_ID, {});

      expect(workoutSync.push).not.toHaveBeenCalled();
      expect(exerciseSync.push).not.toHaveBeenCalled();
      expect(templateSync.push).not.toHaveBeenCalled();
      expect(measurementSync.push).not.toHaveBeenCalled();
      expect(result.workouts).toEqual({ accepted: [], rejected: [] });
    });

    it('returns results from all entity types', async () => {
      workoutSync.push.mockResolvedValue({
        accepted: ['w1'],
        rejected: [{ id: 'w2', reason: 'server_newer' }],
      });

      const result = await service.push(USER_ID, {
        workouts: [{ id: 'w1' } as any, { id: 'w2' } as any],
      });

      expect(result.workouts.accepted).toEqual(['w1']);
      expect(result.workouts.rejected).toEqual([
        { id: 'w2', reason: 'server_newer' },
      ]);
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('calls all services in parallel with default limit', async () => {
      await service.pull(USER_ID, {});

      expect(workoutSync.pull).toHaveBeenCalledWith(USER_ID, undefined, 50);
      expect(exerciseSync.pull).toHaveBeenCalledWith(USER_ID, undefined, 50);
      expect(templateSync.pull).toHaveBeenCalledWith(USER_ID, undefined, 50);
      expect(measurementSync.pull).toHaveBeenCalledWith(USER_ID, undefined, 50);
    });

    it('passes since cursors and custom limit', async () => {
      await service.pull(USER_ID, {
        since: { workouts: PAST, exercises: NOW },
        limit: 10,
      });

      expect(workoutSync.pull).toHaveBeenCalledWith(USER_ID, PAST, 10);
      expect(exerciseSync.pull).toHaveBeenCalledWith(USER_ID, NOW, 10);
      expect(templateSync.pull).toHaveBeenCalledWith(USER_ID, undefined, 10);
    });

    it('assembles response with data, cursors, and hasMore', async () => {
      workoutSync.pull.mockResolvedValue({
        data: [{ id: 'w1' }],
        cursor: NOW,
        hasMore: true,
      });

      const result = await service.pull(USER_ID, {});

      expect(result.workouts).toEqual([{ id: 'w1' }]);
      expect(result.cursors.workouts).toBe(NOW);
      expect(result.hasMore.workouts).toBe(true);
    });
  });

  // ─── Purge ─────────────────────────────────────────────────────────────

  describe('purge', () => {
    it('hard-deletes soft-deleted records older than 30 days', async () => {
      prisma.workout.deleteMany.mockResolvedValue({ count: 3 });
      prisma.exercise.deleteMany.mockResolvedValue({ count: 1 });
      prisma.workoutTemplate.deleteMany.mockResolvedValue({ count: 0 });
      prisma.bodyMeasurement.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.purge(USER_ID);

      expect(result).toEqual({
        purged: { workouts: 3, exercises: 1, templates: 0, measurements: 2 },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.workout.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: USER_ID,
          deletedAt: { lt: expect.any(Date) },
        }),
      });
    });
  });

  // ─── Status ────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns timestamps from all services', async () => {
      workoutSync.getLatestTimestamp.mockResolvedValue(NOW);
      exerciseSync.getLatestTimestamp.mockResolvedValue(PAST);
      templateSync.getLatestTimestamp.mockResolvedValue(null);
      measurementSync.getLatestTimestamp.mockResolvedValue(null);

      const result = await service.getStatus(USER_ID);

      expect(result).toEqual({
        workouts: NOW,
        exercises: PAST,
        templates: null,
        measurements: null,
      });
    });
  });
});
