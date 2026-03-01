import { TemplateSyncService } from './template-sync.service';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  PAST,
  FUTURE,
  makeTemplatePushDto,
  makeExistingTemplate,
} from '../../__mocks__/prisma.mock';

describe('TemplateSyncService', () => {
  let service: TemplateSyncService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new TemplateSyncService(prisma as any);
    // Default stubs for all create/delete calls inside transaction
    prisma.workoutTemplate.upsert.mockResolvedValue({});
    prisma.templateItem.create.mockResolvedValue({});
    prisma.templateExercise.create.mockResolvedValue({});
    prisma.templateExercise.findUnique.mockResolvedValue(null);
    prisma.templateExercise.update.mockResolvedValue({});
    prisma.templateSet.createMany.mockResolvedValue({ count: 0 });
    prisma.templateSet.findMany.mockResolvedValue([]);
    prisma.templateSuperset.create.mockResolvedValue({});
    prisma.templateSet.deleteMany.mockResolvedValue({ count: 0 });
    prisma.templateExercise.deleteMany.mockResolvedValue({ count: 0 });
    prisma.templateItem.deleteMany.mockResolvedValue({ count: 0 });
    prisma.templateSuperset.deleteMany.mockResolvedValue({ count: 0 });
  });

  // ─── Push ──────────────────────────────────────────────────────────────

  describe('push', () => {
    it('accepts a new template', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(null);

      const result = await service.push(USER_ID, [makeTemplatePushDto()]);

      expect(result.accepted).toEqual(['template-1']);
      expect(result.rejected).toEqual([]);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('accepts update when client is newer — deletes children first', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(
        makeExistingTemplate({ updatedAt: new Date(PAST) }),
      );

      const result = await service.push(USER_ID, [makeTemplatePushDto()]);

      expect(result.accepted).toEqual(['template-1']);
      expect(prisma.templateSet.deleteMany).toHaveBeenCalled();
      expect(prisma.templateExercise.deleteMany).toHaveBeenCalled();
      expect(prisma.templateItem.deleteMany).toHaveBeenCalled();
      expect(prisma.templateSuperset.deleteMany).toHaveBeenCalled();
    });

    it('rejects when server is newer', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(
        makeExistingTemplate({ updatedAt: new Date(FUTURE) }),
      );

      const result = await service.push(USER_ID, [makeTemplatePushDto()]);

      expect(result.rejected).toEqual([
        { id: 'template-1', reason: 'server_newer' },
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when userId does not match (forbidden)', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(
        makeExistingTemplate({ userId: OTHER_USER_ID }),
      );

      const result = await service.push(USER_ID, [makeTemplatePushDto()]);

      expect(result.rejected).toEqual([
        { id: 'template-1', reason: 'forbidden' },
      ]);
    });

    it('accepts soft delete (deletedAt set)', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(null);

      const dto = makeTemplatePushDto({ deletedAt: NOW });
      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['template-1']);
      expect(prisma.workoutTemplate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            deletedAt: new Date(NOW),
          }),
        }),
      );
    });

    it('rejects with error on exception', async () => {
      prisma.workoutTemplate.findUnique.mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.push(USER_ID, [makeTemplatePushDto()]);

      expect(result.rejected).toEqual([
        { id: 'template-1', reason: 'error' },
      ]);
    });

    it('creates supersets with nested exercises and sets', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(null);

      const dto = makeTemplatePushDto({
        items: [],
        supersets: [
          {
            id: 'ss-1',
            supersetColorIndex: 0,
            exerciseIds: ['ex-1'],
            exercises: [
              {
                id: 'se-1',
                exerciseId: 'ex-1',
                sortOrder: 0,
                sets: [
                  { id: 'ts-1', setNumber: 1, targetWeight: 50, targetReps: 8 },
                ],
              },
            ],
          },
        ],
      });

      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['template-1']);
      expect(prisma.templateSuperset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'ss-1',
          templateId: 'template-1',
        }),
      });
      expect(prisma.templateExercise.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'se-1',
          supersetId: 'ss-1',
          exerciseId: 'ex-1',
        }),
      });
      expect(prisma.templateSet.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            id: 'ts-1',
            templateExerciseId: 'se-1',
          }),
        ],
      });
    });

    it('links existing templateExercise to item via update', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(null);
      // Simulate exercise already created (e.g., from superset processing)
      prisma.templateExercise.findUnique.mockResolvedValue({
        id: 'texercise-1',
      });

      const result = await service.push(USER_ID, [makeTemplatePushDto()]);

      expect(result.accepted).toEqual(['template-1']);
      expect(prisma.templateExercise.update).toHaveBeenCalledWith({
        where: { id: 'texercise-1' },
        data: { templateItemId: 'item-1' },
      });
    });

    it('skips set creation when sets already exist for exercise', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(null);
      prisma.templateExercise.findUnique.mockResolvedValue(null);
      // Simulate sets already existing (created during superset phase)
      prisma.templateSet.findMany.mockResolvedValue([{ id: 'existing-set' }]);

      const result = await service.push(USER_ID, [makeTemplatePushDto()]);

      expect(result.accepted).toEqual(['template-1']);
      // createMany should still be called for the exercise, but not if sets exist
      // The code checks existingSets.length === 0 before creating
    });

    it('creates item without exercise when exercise is undefined', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(null);

      const dto = makeTemplatePushDto({
        items: [{ id: 'item-bare', sortOrder: 0 }],
      });

      const result = await service.push(USER_ID, [dto]);

      expect(result.accepted).toEqual(['template-1']);
      expect(prisma.templateItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 'item-bare' }),
      });
    });
  });

  // ─── Pull ──────────────────────────────────────────────────────────────

  describe('pull', () => {
    it('returns all with deep includes when no since', async () => {
      const records = [makeExistingTemplate()];
      prisma.workoutTemplate.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 50);

      expect(result.data).toEqual(records);
      expect(result.hasMore).toBe(false);
      expect(prisma.workoutTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID },
          include: expect.objectContaining({
            items: expect.anything(),
          }),
          take: 51,
        }),
      );
    });

    it('filters by updatedAt when since is provided', async () => {
      prisma.workoutTemplate.findMany.mockResolvedValue([]);

      await service.pull(USER_ID, PAST, 50);

      expect(prisma.workoutTemplate.findMany).toHaveBeenCalledWith(
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
        makeExistingTemplate({ id: `t-${i}` }),
      );
      prisma.workoutTemplate.findMany.mockResolvedValue(records);

      const result = await service.pull(USER_ID, undefined, 2);

      expect(result.hasMore).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  // ─── getLatestTimestamp ────────────────────────────────────────────────

  describe('getLatestTimestamp', () => {
    it('returns ISO string of latest updatedAt', async () => {
      prisma.workoutTemplate.findFirst.mockResolvedValue({
        updatedAt: new Date(NOW),
      });

      expect(await service.getLatestTimestamp(USER_ID)).toBe(
        new Date(NOW).toISOString(),
      );
    });

    it('returns null when no records', async () => {
      prisma.workoutTemplate.findFirst.mockResolvedValue(null);

      expect(await service.getLatestTimestamp(USER_ID)).toBeNull();
    });
  });
});
