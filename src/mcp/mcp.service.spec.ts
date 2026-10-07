jest.mock('uuid', () => {
  let counter = 0;
  return {
    v4: jest.fn(
      () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    ),
  };
});

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExercisesService } from '../exercises/exercises.service.js';
import { ExerciseResolverService } from '../exercises/exercise-resolver.service.js';
import { RoutinesService } from '../routines/routines.service.js';
import { FoldersService } from '../routines/folders.service.js';
import { WorkoutsService } from '../workouts/workouts.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  NOW,
  PAST,
} from '../__mocks__/prisma.mock.js';
import { McpService } from './mcp.service.js';
import { MCP_TOOLS } from './mcp-tools.js';

const ROUTINE_ID = '11111111-0000-4000-8000-000000000001';
const ITEM_ID = '11111111-0000-4000-8000-000000000002';
const TE_ID = '11111111-0000-4000-8000-000000000003';
const WARMUP_SET_ID = '11111111-0000-4000-8000-000000000004';
const WORK_SET_ID = '11111111-0000-4000-8000-000000000005';

function makeSet(id: string, setNumber: number, type: string | null) {
  return {
    id,
    templateExerciseId: TE_ID,
    setNumber,
    targetWeight: 60,
    targetReps: 8,
    targetDuration: null,
    targetDistance: null,
    type,
  };
}

function makeTemplateTree() {
  return {
    id: ROUTINE_ID,
    userId: USER_ID,
    folderId: null,
    name: 'Push Day',
    notes: '',
    sortOrder: 0,
    createdAt: new Date(PAST),
    updatedAt: new Date(NOW),
    deletedAt: null,
    items: [
      {
        id: ITEM_ID,
        templateId: ROUTINE_ID,
        sortOrder: 0,
        supersetId: null,
        exercise: {
          id: TE_ID,
          templateItemId: ITEM_ID,
          supersetId: null,
          exerciseId: '11111111-0000-4000-8000-000000000009',
          sortOrder: 0,
          targetSets: 2,
          targetReps: 8,
          notes: null,
          restTimerSeconds: null,
          exercise: { name: 'Bench Press (Barbell)' },
          sets: [
            makeSet(WARMUP_SET_ID, 1, 'warmup'),
            makeSet(WORK_SET_ID, 2, null),
          ],
        },
      },
    ],
    supersets: [],
  };
}

describe('McpService — routine set types', () => {
  let service: McpService;
  let prisma: MockPrismaService;
  const caller = {
    userId: USER_ID,
    scopes: ['routines:read', 'routines:write', 'history:read'],
  };

  const callTool = async (name: string, args: unknown) => {
    const res: any = await service.handleMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      caller,
    );
    return {
      isError: !!res.result.isError,
      text: res.result.content[0].text as string,
    };
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const resolver = {
      resolveAll: jest.fn(async (_userId: string, refs: any[]) =>
        refs.map((r, i) => ({
          requested: r.name ?? r.exerciseId,
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
        McpService,
        RoutinesService,
        FoldersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExerciseResolverService, useValue: resolver },
        { provide: ExercisesService, useValue: {} },
        { provide: WorkoutsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(McpService);

    prisma.user.findUnique.mockResolvedValue({ isPro: true });
    prisma.workoutTemplate.aggregate.mockResolvedValue({
      _max: { sortOrder: 0 },
    });
    prisma.workoutTemplate.findUnique.mockResolvedValue(makeTemplateTree());
    prisma.routineFolder.findMany.mockResolvedValue([]);
    prisma.routineFolder.findFirst.mockResolvedValue(null);
    prisma.routineFolder.findUnique.mockResolvedValue(null);
    prisma.routineFolder.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    }));
    prisma.workoutTemplate.groupBy.mockResolvedValue([]);
    prisma.routineFolder.aggregate.mockResolvedValue({
      _max: { sortOrder: 0 },
    });
  });

  it('advertises the set type enum in every routine-writing tool schema', () => {
    for (const name of ['create_routine', 'update_routine', 'create_program']) {
      const schema = JSON.stringify(
        MCP_TOOLS.find((t) => t.name === name)!.inputSchema,
      );
      expect(schema).toContain(
        '"enum":["normal","warmup","dropset","failure"]',
      );
    }
  });

  it('get_routine returns the type of every set', async () => {
    const { isError, text } = await callTool('get_routine', { id: ROUTINE_ID });

    expect(isError).toBe(false);
    const sets = JSON.parse(text).items[0].exercise.sets;
    expect(sets.map((s: any) => s.type)).toEqual(['warmup', 'normal']);
  });

  it('create_routine persists all set types', async () => {
    const { isError } = await callTool('create_routine', {
      routine: {
        name: 'Upper A',
        items: [
          {
            exercise: {
              name: 'Bench Press',
              sets: [
                { targetWeight: 40, targetReps: 10, type: 'warmup' },
                { targetWeight: 80, targetReps: 6 },
                { targetWeight: 80, targetReps: 6, type: 'failure' },
                { targetWeight: 60, targetReps: 10, type: 'dropset' },
              ],
            },
          },
        ],
      },
    });

    expect(isError).toBe(false);
    const { data } = prisma.templateSet.createMany.mock.calls[0][0];
    expect(data.map((s: any) => s.type)).toEqual([
      'warmup',
      null,
      'failure',
      'dropset',
    ]);
  });

  it('create_program persists set types in every routine', async () => {
    // The routine is filed into the folder create_program just made.
    prisma.routineFolder.findUnique.mockImplementation(
      async () => prisma.routineFolder.create.mock.results[0]?.value,
    );
    const { isError } = await callTool('create_program', {
      name: 'PPL',
      routines: [
        {
          name: 'Push',
          items: [
            {
              exercise: {
                name: 'Bench Press',
                sets: [{ targetReps: 10, type: 'warmup' }, { targetReps: 5 }],
              },
            },
          ],
        },
      ],
    });

    expect(isError).toBe(false);
    const { data } = prisma.templateSet.createMany.mock.calls[0][0];
    expect(data.map((s: any) => s.type)).toEqual(['warmup', null]);
  });

  it('update_routine round-trips get_routine output, keeping and changing types', async () => {
    const read = JSON.parse(
      (await callTool('get_routine', { id: ROUTINE_ID })).text,
    );
    const sets = read.items[0].exercise.sets;
    // Turn the working set into a failure set and add a drop set after it.
    sets[1].type = 'failure';
    sets.push({ targetWeight: 45, targetReps: 10, type: 'dropset' });

    const { isError } = await callTool('update_routine', {
      id: ROUTINE_ID,
      routine: read,
      baseUpdatedAt: read.updatedAt,
    });

    expect(isError).toBe(false);
    expect(prisma.templateSet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WARMUP_SET_ID },
        data: expect.objectContaining({ type: 'warmup' }),
      }),
    );
    expect(prisma.templateSet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORK_SET_ID },
        data: expect.objectContaining({ type: 'failure' }),
      }),
    );
    expect(prisma.templateSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ setNumber: 3, type: 'dropset' }),
      }),
    );
  });

  it('rejects an unknown set type as a tool error without writing', async () => {
    const { isError } = await callTool('create_routine', {
      routine: {
        name: 'Bad',
        items: [
          {
            exercise: {
              name: 'Squat',
              sets: [{ targetReps: 5, type: 'amrap' }],
            },
          },
        ],
      },
    });

    expect(isError).toBe(true);
    expect(prisma.workoutTemplate.create).not.toHaveBeenCalled();
  });
});
