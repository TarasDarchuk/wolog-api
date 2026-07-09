import { FolderSyncService } from './folder-sync.service';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  PAST,
  FUTURE,
  makeFolderPushDto,
  makeExistingFolder,
} from '../../__mocks__/prisma.mock';

describe('FolderSyncService', () => {
  let service: FolderSyncService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new FolderSyncService(prisma as any);
  });

  // ─── Push ──────────────────────────────────────────────────────────────

  describe('push', () => {
    it('accepts a new folder', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(null);
      prisma.routineFolder.upsert.mockResolvedValue({});

      const result = await service.push(USER_ID, [makeFolderPushDto()]);

      expect(result.accepted).toEqual(['folder-1']);
      expect(result.rejected).toEqual([]);
      expect(prisma.routineFolder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'folder-1' },
          create: expect.objectContaining({
            userId: USER_ID,
            name: 'Push Days',
          }),
        }),
      );
    });

    it('accepts update when client is newer', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(
        makeExistingFolder({ updatedAt: new Date(PAST) }),
      );
      prisma.routineFolder.upsert.mockResolvedValue({});

      const result = await service.push(USER_ID, [makeFolderPushDto()]);

      expect(result.accepted).toEqual(['folder-1']);
    });

    it('rejects when server is newer', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(
        makeExistingFolder({ updatedAt: new Date(FUTURE) }),
      );

      const result = await service.push(USER_ID, [makeFolderPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'folder-1', reason: 'server_newer' },
      ]);
      expect(prisma.routineFolder.upsert).not.toHaveBeenCalled();
    });

    it('rejects when userId does not match (forbidden)', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(
        makeExistingFolder({ userId: OTHER_USER_ID }),
      );

      const result = await service.push(USER_ID, [makeFolderPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'folder-1', reason: 'forbidden' },
      ]);
    });

    it('accepts soft delete (deletedAt set)', async () => {
      prisma.routineFolder.findUnique.mockResolvedValue(null);
      prisma.routineFolder.upsert.mockResolvedValue({});

      const dto = makeFolderPushDto({ deletedAt: NOW });
      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['folder-1']);
      expect(prisma.routineFolder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            deletedAt: new Date(NOW),
          }),
        }),
      );
    });

    it('rejects with error on exception', async () => {
      prisma.routineFolder.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.push(USER_ID, [makeFolderPushDto()]);

      expect(result.rejected).toEqual([{ id: 'folder-1', reason: 'error' }]);
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('returns all when no since provided', async () => {
      const records = [makeExistingFolder()];
      prisma.routineFolder.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.data).toEqual(records);
      expect(result.hasMore).toBe(false);
      expect(result.cursor).toBe(new Date(NOW).toISOString());
    });

    it('filters by updatedAt when since is provided', async () => {
      prisma.routineFolder.findMany.mockResolvedValue([]);

      await service.pull(USER_ID, PAST, 50);

      expect(prisma.routineFolder.findMany).toHaveBeenCalledWith(
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
        makeExistingFolder({ id: `f-${i}` }),
      );
      prisma.routineFolder.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 2);

      expect(result.hasMore).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  // ─── getLatestTimestamp ────────────────────────────────────────────────

  describe('getLatestTimestamp', () => {
    it('returns ISO string of latest updatedAt', async () => {
      prisma.routineFolder.findFirst.mockResolvedValue({
        updatedAt: new Date(NOW),
      });

      expect(await service.getLatestTimestamp(USER_ID)).toBe(
        new Date(NOW).toISOString(),
      );
    });

    it('returns null when no records', async () => {
      prisma.routineFolder.findFirst.mockResolvedValue(null);

      expect(await service.getLatestTimestamp(USER_ID)).toBeNull();
    });
  });
});
