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
  createMockStorageService,
  MockStorageService,
} from '../../__mocks__/prisma.mock';

const PHOTO = '33333333-3333-4333-8333-333333333333';
const OLD_PHOTO = '44444444-4444-4444-8444-444444444444';

describe('MeasurementSyncService', () => {
  let service: MeasurementSyncService;
  let prisma: MockPrismaService;
  let storage: MockStorageService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();
    service = new MeasurementSyncService(prisma as any, storage as any);
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

  // ─── Push: progress photo ──────────────────────────────────────────────

  describe('push photo', () => {
    const photo = { id: PHOTO, width: 1536, height: 2048 };

    beforeEach(() => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(
        makeExistingMeasurement({
          updatedAt: new Date(PAST),
          photoId: OLD_PHOTO,
        }),
      );
      prisma.bodyMeasurement.upsert.mockResolvedValue({});
      prisma.bodyMeasurement.count.mockResolvedValue(0);
      prisma.photo.findUnique.mockResolvedValue(null);
      prisma.photo.upsert.mockResolvedValue({});
      prisma.photo.deleteMany.mockResolvedValue({ count: 1 });
    });

    it('keeps photoId when the key is missing (old clients)', async () => {
      const result = await service.push(USER_ID, [makeMeasurementPushDto()]);

      expect(result.accepted).toEqual(['measurement-1']);
      const call = prisma.bodyMeasurement.upsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty('photoId');
      expect(prisma.photo.upsert).not.toHaveBeenCalled();
      expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
      expect(storage.deleteQuietly).not.toHaveBeenCalled();
    });

    it('clears photoId on null and deletes the now-unreferenced photo', async () => {
      const result = await service.push(USER_ID, [
        makeMeasurementPushDto({ photo: null }),
      ]);

      expect(result.accepted).toEqual(['measurement-1']);
      expect(prisma.bodyMeasurement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ photoId: null }),
        }),
      );
      expect(prisma.bodyMeasurement.count).toHaveBeenCalledWith({
        where: { photoId: OLD_PHOTO },
      });
      expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
        where: { id: OLD_PHOTO, workoutId: null },
      });
      expect(storage.deleteQuietly).toHaveBeenCalledWith([
        `photos/${USER_ID}/${OLD_PHOTO}.jpg`,
      ]);
    });

    it('keeps the old photo while another measurement still references it', async () => {
      prisma.bodyMeasurement.count.mockResolvedValue(1);

      await service.push(USER_ID, [makeMeasurementPushDto({ photo: null })]);

      expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
      expect(storage.deleteQuietly).not.toHaveBeenCalled();
    });

    it('replacing the photo cleans up the old one', async () => {
      await service.push(USER_ID, [makeMeasurementPushDto({ photo })]);

      expect(prisma.bodyMeasurement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ photoId: PHOTO }),
        }),
      );
      expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
        where: { id: OLD_PHOTO, workoutId: null },
      });
    });

    it('re-pushing the same photo does not look for orphans', async () => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(
        makeExistingMeasurement({ updatedAt: new Date(PAST), photoId: PHOTO }),
      );

      await service.push(USER_ID, [makeMeasurementPushDto({ photo })]);

      expect(prisma.bodyMeasurement.count).not.toHaveBeenCalled();
      expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
    });

    it('upserts the photo row without ever touching uploadedAt', async () => {
      await service.push(USER_ID, [makeMeasurementPushDto({ photo })]);

      expect(prisma.photo.upsert).toHaveBeenCalledWith({
        where: { id: PHOTO },
        create: { id: PHOTO, userId: USER_ID, width: 1536, height: 2048 },
        update: { width: 1536, height: 2048 },
      });
      const call = prisma.photo.upsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty('uploadedAt');
      expect(call.update).not.toHaveProperty('workoutId');
    });

    it('two measurements sharing one photo id upsert the same single row', async () => {
      prisma.bodyMeasurement.findUnique.mockResolvedValue(null);

      const result = await service.push(USER_ID, [
        makeMeasurementPushDto({ id: 'm-weight', photo }),
        makeMeasurementPushDto({ id: 'm-waist', type: 'waist', photo }),
      ]);

      expect(result.accepted).toEqual(['m-weight', 'm-waist']);
      const photoIds = prisma.photo.upsert.mock.calls.map((c) => c[0].where.id);
      expect(new Set(photoIds)).toEqual(new Set([PHOTO]));
      expect(prisma.photo.create).not.toHaveBeenCalled();
      for (const [call] of prisma.bodyMeasurement.upsert.mock.calls) {
        expect(call.create.photoId).toBe(PHOTO);
      }
    });

    it("rejects a measurement claiming another user's photo as forbidden", async () => {
      prisma.photo.findUnique.mockResolvedValue({ userId: OTHER_USER_ID });

      const result = await service.push(USER_ID, [
        makeMeasurementPushDto({ photo }),
      ]);

      expect(result.rejected).toEqual([
        { id: 'measurement-1', reason: 'forbidden' },
      ]);
      expect(prisma.bodyMeasurement.upsert).not.toHaveBeenCalled();
      expect(prisma.photo.upsert).not.toHaveBeenCalled();
    });

    it('does not delete storage objects when the transaction fails', async () => {
      prisma.bodyMeasurement.upsert.mockRejectedValue(new Error('DB error'));

      const result = await service.push(USER_ID, [
        makeMeasurementPushDto({ photo: null }),
      ]);

      expect(result.rejected).toEqual([
        { id: 'measurement-1', reason: 'error' },
      ]);
      expect(storage.deleteQuietly).not.toHaveBeenCalled();
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('returns all when no since provided', async () => {
      const records = [makeExistingMeasurement()];
      prisma.bodyMeasurement.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 50);

      const { photoId: _photoId, ...rest } = records[0];
      expect(result.data).toEqual([{ ...rest, photo: null }]);
      expect(result.hasMore).toBe(false);
      expect(result.cursor).toBe(new Date(NOW).toISOString());
    });

    it('includes photo with uploaded flag, or null', async () => {
      prisma.bodyMeasurement.findMany.mockResolvedValue([
        makeExistingMeasurement({ id: 'm1', photoId: PHOTO }),
        makeExistingMeasurement({ id: 'm2', photoId: PHOTO }),
        makeExistingMeasurement({ id: 'm3', photoId: OLD_PHOTO }),
        makeExistingMeasurement({ id: 'm4' }),
      ]);
      prisma.photo.findMany.mockResolvedValue([
        {
          id: PHOTO,
          userId: USER_ID,
          width: 1536,
          height: 2048,
          uploadedAt: new Date(NOW),
        },
        {
          id: OLD_PHOTO,
          userId: USER_ID,
          width: 800,
          height: 600,
          uploadedAt: null,
        },
      ]);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(prisma.photo.findMany).toHaveBeenCalledWith({
        where: { id: { in: [PHOTO, OLD_PHOTO] }, userId: USER_ID },
      });
      expect(result.data.map((m) => m.photo)).toEqual([
        { id: PHOTO, width: 1536, height: 2048, uploaded: true },
        { id: PHOTO, width: 1536, height: 2048, uploaded: true },
        { id: OLD_PHOTO, width: 800, height: 600, uploaded: false },
        null,
      ]);
      expect(result.data[0]).not.toHaveProperty('photoId');
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
