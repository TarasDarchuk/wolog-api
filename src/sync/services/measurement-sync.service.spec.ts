import { MeasurementSyncService } from './measurement-sync.service';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  PAST,
  FUTURE,
  makeMeasurementPushDto,
  makeExistingMeasurement,
} from '../../__mocks__/prisma.mock';

describe('MeasurementSyncService', () => {
  let service: MeasurementSyncService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new MeasurementSyncService(prisma as any);
  });

  // ─── Push ──────────────────────────────────────────────────────────────

  describe('push', () => {
    it('accepts a new measurement', async () => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(null);
      prisma.bodyMeasurement.upsert.mockResolvedValue({});

      const result = await service.push(USER_ID, [makeMeasurementPushDto()]);

      expect(result.accepted).toEqual(['measurement-1']);
      expect(result.rejected).toEqual([]);
      expect(prisma.bodyMeasurement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'measurement-1' },
          create: expect.objectContaining({
            userId: USER_ID,
            value: 80.5,
          }),
        }),
      );
    });

    it('accepts update when client is newer', async () => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(
        makeExistingMeasurement({ updatedAt: new Date(PAST) }),
      );
      prisma.bodyMeasurement.upsert.mockResolvedValue({});

      const result = await service.push(USER_ID, [makeMeasurementPushDto()]);

      expect(result.accepted).toEqual(['measurement-1']);
    });

    it('rejects when server is newer', async () => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(
        makeExistingMeasurement({ updatedAt: new Date(FUTURE) }),
      );

      const result = await service.push(USER_ID, [makeMeasurementPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'measurement-1', reason: 'server_newer' },
      ]);
      expect(prisma.bodyMeasurement.upsert).not.toHaveBeenCalled();
    });

    it('rejects when userId does not match (forbidden)', async () => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(
        makeExistingMeasurement({ userId: OTHER_USER_ID }),
      );

      const result = await service.push(USER_ID, [makeMeasurementPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'measurement-1', reason: 'forbidden' },
      ]);
    });

    it('accepts soft delete (deletedAt set)', async () => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(null);
      prisma.bodyMeasurement.upsert.mockResolvedValue({});

      const dto = makeMeasurementPushDto({ deletedAt: NOW });
      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['measurement-1']);
      expect(prisma.bodyMeasurement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            deletedAt: new Date(NOW),
          }),
        }),
      );
    });

    it('rejects with error on exception', async () => {
      prisma.bodyMeasurement.findUnique.mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.push(USER_ID, [makeMeasurementPushDto()]);

      expect(result.rejected).toEqual([
        { id: 'measurement-1', reason: 'error' },
      ]);
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('returns all when no since provided', async () => {
      const records = [makeExistingMeasurement()];
      prisma.bodyMeasurement.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.data).toEqual(records);
      expect(result.hasMore).toBe(false);
      expect(result.cursor).toBe(new Date(NOW).toISOString());
    });

    it('filters by updatedAt when since is provided', async () => {
      prisma.bodyMeasurement.findMany.mockResolvedValue([]);

      await service.pull(USER_ID, PAST, 50);

      expect(prisma.bodyMeasurement.findMany).toHaveBeenCalledWith(
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
        makeExistingMeasurement({ id: `m-${i}` }),
      );
      prisma.bodyMeasurement.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 2);

      expect(result.hasMore).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  // ─── getLatestTimestamp ────────────────────────────────────────────────

  describe('getLatestTimestamp', () => {
    it('returns ISO string of latest updatedAt', async () => {
      prisma.bodyMeasurement.findFirst.mockResolvedValue({
        updatedAt: new Date(NOW),
      });

      expect(await service.getLatestTimestamp(USER_ID)).toBe(
        new Date(NOW).toISOString(),
      );
    });

    it('returns null when no records', async () => {
      prisma.bodyMeasurement.findFirst.mockResolvedValue(null);

      expect(await service.getLatestTimestamp(USER_ID)).toBeNull();
    });
  });
});
