jest.mock('uuid', () => {
  let counter = 0;
  return {
    v4: jest.fn(
      () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    ),
  };
});

import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExerciseResolverService } from '../exercises/exercise-resolver.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  OTHER_USER_ID,
  NOW,
  PAST,
} from '../__mocks__/prisma.mock.js';
import { RoutinesService } from './routines.service.js';

function makeTemplateTree(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    userId: USER_ID,
    name: 'Push Day',
    notes: '',
    sortOrder: 0,
    createdAt: new Date(PAST),
    updatedAt: new Date(NOW),
    deletedAt: null,
    items: [
      {
        id: 'item-1',
        templateId: 'template-1',
        sortOrder: 0,
        supersetId: null,
        exercise: {
          id: 'te-1',
          templateItemId: 'item-1',
          supersetId: null,
          exerciseId: 'ex-1',
          sortOrder: 0,
          targetSets: 2,
          targetReps: 6,
          notes: null,
          restTimerSeconds: 180,
          exercise: { name: 'Bench Press (Barbell)' },
          sets: [
            {
              id: 'set-1',
              templateExerciseId: 'te-1',
              setNumber: 1,
              targetWeight: 60,
              targetReps: 6,
              targetDuration: null,
              targetDistance: null,
            },
            {
              id: 'set-2',
              templateExerciseId: 'te-1',
              setNumber: 2,
              targetWeight: 62.5,
              targetReps: 6,
              targetDuration: null,
              targetDistance: null,
            },
          ],
        },
      },
    ],
    supersets: [],
    ...overrides,
  };
}

describe('RoutinesService', () => {
  let service: RoutinesService;
  let prisma: MockPrismaService;
  let resolver: { resolveAll: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    resolver = {
      resolveAll: jest.fn(async (_userId: string, refs: any[]) =>
        refs.map((r, i) => ({
          requested: r.name ?? r.exerciseId ?? '(unspecified)',
          resolvedTo: r.name ?? 'Resolved',
          id: r.exerciseId ?? `resolved-ex-${i}`,
          method: 'exact',
          confidence: 1,
          createdCustom: false,
        })),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutinesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExerciseResolverService, useValue: resolver },
      ],
    }).compile();

    service = moduleRef.get(RoutinesService);
  });

  describe('list', () => {
    it('returns summaries with exercise counts', async () => {
      prisma.workoutTemplate.findMany.mockResolvedValue([
        {
          id: 'template-1',
          name: 'Push Day',
          notes: '',
          updatedAt: new Date(NOW),
          items: [{ exercise: { id: 'te-1' } }, { exercise: null }],
        },
      ]);

      const result = await service.list(USER_ID);
      expect(result.routines).toEqual([
        {
          id: 'template-1',
          name: 'Push Day',
          notes: null,
          exerciseCount: 1,
          updatedAt: NOW,
        },
      ]);
    });
  });

  describe('getOne', () => {
    it('maps the full tree to the AI-facing schema', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(makeTemplateTree());

      const view = await service.getOne(USER_ID, 'template-1');
      expect(view.id).toBe('template-1');
      expect(view.items).toHaveLength(1);
      expect(view.items[0].exercise).toMatchObject({
        id: 'te-1',
        exerciseId: 'ex-1',
        name: 'Bench Press (Barbell)',
        sets: [
          expect.objectContaining({ id: 'set-1', targetWeight: 60 }),
          expect.objectContaining({ id: 'set-2', targetWeight: 62.5 }),
        ],
      });
      expect(view.updatedAt).toBe(NOW);
    });

    it("rejects another user's routine as not found", async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(
        makeTemplateTree({ userId: OTHER_USER_ID }),
      );
      await expect(service.getOne(USER_ID, 'template-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a soft-deleted routine as not found', async () => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(
        makeTemplateTree({ deletedAt: new Date(NOW) }),
      );
      await expect(service.getOne(USER_ID, 'template-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ isPro: false });
      prisma.workoutTemplate.count.mockResolvedValue(0);
      prisma.workoutTemplate.aggregate.mockResolvedValue({
        _max: { sortOrder: 4 },
      });
      prisma.workoutTemplate.findUnique.mockResolvedValue(makeTemplateTree());
    });

    it('enforces the free-tier routine limit with PRO_REQUIRED', async () => {
      prisma.workoutTemplate.count.mockResolvedValue(5);

      await expect(
        service.create(USER_ID, {
          name: 'Sixth',
          items: [{ exercise: { name: 'Squat' } }],
        } as any),
      ).rejects.toMatchObject({
        constructor: ForbiddenException,
        response: expect.objectContaining({ code: 'PRO_REQUIRED' }),
      });
      expect(prisma.workoutTemplate.create).not.toHaveBeenCalled();
    });

    it('does not limit Pro users', async () => {
      prisma.user.findUnique.mockResolvedValue({ isPro: true });
      prisma.workoutTemplate.count.mockResolvedValue(50);

      await service.create(USER_ID, {
        name: 'Routine',
        items: [{ exercise: { name: 'Squat' } }],
      } as any);
      expect(prisma.workoutTemplate.create).toHaveBeenCalled();
    });

    it('creates template, items, exercises and materialized sets', async () => {
      const result = await service.create(USER_ID, {
        name: 'Upper A',
        notes: 'week 1',
        items: [
          { exercise: { name: 'Bench Press', targetSets: 4, targetReps: 6 } },
        ],
      } as any);

      expect(prisma.workoutTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_ID,
            name: 'Upper A',
            notes: 'week 1',
            sortOrder: 5,
          }),
        }),
      );
      expect(prisma.templateItem.create).toHaveBeenCalledTimes(1);
      expect(prisma.templateExercise.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            exerciseId: 'resolved-ex-0',
            targetSets: 4,
            targetReps: 6,
          }),
        }),
      );
      // 4 placeholder sets materialized from targetSets×targetReps
      const setsArg = prisma.templateSet.createMany.mock.calls[0][0];
      expect(setsArg.data).toHaveLength(4);
      expect(setsArg.data[0]).toMatchObject({ setNumber: 1, targetReps: 6 });
      expect(result.resolutions).toHaveLength(1);
    });

    it('creates supersets with one item per member exercise', async () => {
      await service.create(USER_ID, {
        name: 'Supersets',
        items: [
          {
            superset: {
              supersetColorIndex: 2,
              exercises: [{ name: 'Lat Pulldown' }, { name: 'Face Pull' }],
            },
          },
        ],
      } as any);

      expect(prisma.templateSuperset.create).toHaveBeenCalledTimes(1);
      const ssData = prisma.templateSuperset.create.mock.calls[0][0].data;
      expect(ssData.supersetColorIndex).toBe(2);
      expect(ssData.exerciseIds).toHaveLength(2);

      expect(prisma.templateItem.create).toHaveBeenCalledTimes(2);
      for (const call of prisma.templateItem.create.mock.calls) {
        expect(call[0].data.supersetId).toBe(ssData.id);
      }
    });

    it('rejects items with both exercise and superset', async () => {
      await expect(
        service.create(USER_ID, {
          name: 'Bad',
          items: [
            {
              exercise: { name: 'Squat' },
              superset: { exercises: [{ name: 'Curl' }] },
            },
          ],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.workoutTemplate.findUnique.mockResolvedValue(makeTemplateTree());
    });

    it('returns 409 with the current routine when baseUpdatedAt is stale', async () => {
      await expect(
        service.update(USER_ID, 'template-1', {
          baseUpdatedAt: PAST,
          items: [],
        }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        response: expect.objectContaining({
          current: expect.objectContaining({ id: 'template-1' }),
        }),
      });
      expect(prisma.workoutTemplate.update).not.toHaveBeenCalled();
    });

    it('accepts a fresh baseUpdatedAt', async () => {
      await service.update(USER_ID, 'template-1', { baseUpdatedAt: NOW });
      expect(prisma.workoutTemplate.update).toHaveBeenCalled();
    });

    it('updates rows in place when ids are preserved (progressive overload)', async () => {
      await service.update(USER_ID, 'template-1', {
        items: [
          {
            id: 'item-1',
            exercise: {
              id: 'te-1',
              sets: [
                { id: 'set-1', targetWeight: 62.5, targetReps: 6 },
                { id: 'set-2', targetWeight: 65, targetReps: 6 },
              ],
            },
          },
        ],
      } as any);

      // Existing rows updated, never re-created.
      expect(prisma.templateExercise.create).not.toHaveBeenCalled();
      expect(prisma.templateSet.create).not.toHaveBeenCalled();
      expect(prisma.templateExercise.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'te-1' } }),
      );
      expect(prisma.templateSet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'set-1' },
          data: expect.objectContaining({ targetWeight: 62.5 }),
        }),
      );
      expect(prisma.templateSet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'set-2' },
          data: expect.objectContaining({ targetWeight: 65 }),
        }),
      );

      // Deletions exclude every kept row.
      expect(prisma.templateSet.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['set-1', 'set-2'] },
          }),
        }),
      );
      expect(prisma.templateExercise.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { notIn: ['te-1'] } }),
        }),
      );

      // updatedAt bumped on the template (what drives the pull sync).
      expect(prisma.workoutTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'template-1' },
          data: expect.objectContaining({ updatedAt: expect.any(Date) }),
        }),
      );
    });

    it('keeps existing sets untouched when the payload omits "sets"', async () => {
      await service.update(USER_ID, 'template-1', {
        items: [
          { id: 'item-1', exercise: { id: 'te-1', restTimerSeconds: 240 } },
        ],
      } as any);

      expect(prisma.templateSet.update).not.toHaveBeenCalled();
      expect(prisma.templateSet.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['set-1', 'set-2'] },
          }),
        }),
      );
      expect(prisma.templateExercise.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            restTimerSeconds: 240,
            // untouched fields keep their existing values
            targetReps: 6,
            exerciseId: 'ex-1',
          }),
        }),
      );
    });

    it('deletes children missing from the payload and inserts new ones', async () => {
      await service.update(USER_ID, 'template-1', {
        items: [{ exercise: { name: 'Squat', targetSets: 3 } }],
      } as any);

      // Old exercise dropped…
      expect(prisma.templateExercise.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { notIn: [] } }),
        }),
      );
      // …new one inserted with a resolved exercise id.
      expect(prisma.templateExercise.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ exerciseId: 'resolved-ex-0' }),
        }),
      );
    });

    it('rejects a stale exercise row id with no exercise reference', async () => {
      await expect(
        service.update(USER_ID, 'template-1', {
          items: [{ exercise: { id: '4242aaaa-0000-0000-0000-000000000000' } }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
