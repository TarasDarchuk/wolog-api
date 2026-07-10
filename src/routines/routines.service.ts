import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ExerciseResolution,
  ExerciseResolverService,
} from '../exercises/exercise-resolver.service.js';
import {
  CreateProgramDto,
  CreateRoutineDto,
  RoutineExerciseDto,
  RoutineItemDto,
  UpdateRoutineDto,
} from './dto/routine.dto.js';
import { FoldersService, FolderView } from './folders.service.js';
import { RoutineView, toRoutineView } from './routine-mapper.js';

export const FREE_ROUTINE_LIMIT = 5;

const FULL_TEMPLATE_INCLUDE = {
  items: {
    include: {
      exercise: {
        include: {
          sets: true,
          exercise: { select: { name: true } },
        },
      },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  supersets: true,
};

/** One exercise slot after flattening §8 items (superset members expand). */
interface ExpandedEntry {
  dto: RoutineExerciseDto;
  itemDtoId?: string;
  groupIndex: number | null; // index into groups, null = standalone
}

interface ExpandedGroup {
  dtoId?: string;
  colorIndex: number;
}

function expandItems(items: RoutineItemDto[]): {
  entries: ExpandedEntry[];
  groups: ExpandedGroup[];
} {
  const entries: ExpandedEntry[] = [];
  const groups: ExpandedGroup[] = [];

  for (const item of items) {
    const hasExercise = !!item.exercise;
    const hasSuperset = !!item.superset;
    if (hasExercise === hasSuperset) {
      throw new BadRequestException(
        'Each routine item must contain exactly one of "exercise" or "superset"',
      );
    }

    if (item.exercise) {
      entries.push({
        dto: item.exercise,
        itemDtoId: item.id,
        groupIndex: null,
      });
      continue;
    }

    const superset = item.superset!;
    if (!superset.exercises || superset.exercises.length === 0) {
      throw new BadRequestException('A superset must contain exercises');
    }
    const groupIndex = groups.length;
    groups.push({
      dtoId: superset.id,
      colorIndex: superset.supersetColorIndex ?? 0,
    });
    for (const exercise of superset.exercises) {
      entries.push({ dto: exercise, groupIndex });
    }
  }

  return { entries, groups };
}

@Injectable()
export class RoutinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ExerciseResolverService,
    private readonly folders: FoldersService,
  ) {}

  // ─── Read ─────────────────────────────────────────────────────────────────

  async list(userId: string) {
    const templates = await this.prisma.workoutTemplate.findMany({
      where: { userId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: { select: { exercise: { select: { id: true } } } },
      },
    });

    const folders = await this.prisma.routineFolder.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true },
    });
    const folderNameById = new Map(folders.map((f) => [f.id, f.name]));

    return {
      routines: templates.map((t) => {
        // A dangling folderId (folder deleted) reports as unfiled, like the app.
        const folderName = t.folderId
          ? (folderNameById.get(t.folderId) ?? null)
          : null;
        return {
          id: t.id,
          name: t.name,
          notes: t.notes || null,
          folderId: folderName ? t.folderId : null,
          folderName,
          exerciseCount: t.items.filter((i) => i.exercise).length,
          updatedAt: t.updatedAt.toISOString(),
        };
      }),
    };
  }

  async getOne(
    userId: string,
    routineId: string,
  ): Promise<RoutineView & { folder: FolderView | null }> {
    const template = await this.loadTemplate(userId, routineId);
    const folder = await this.folders.folderInfo(userId, template.folderId);
    return { ...toRoutineView(template), folder };
  }

  private async loadTemplate(userId: string, routineId: string) {
    const template = await this.prisma.workoutTemplate.findUnique({
      where: { id: routineId },
      include: FULL_TEMPLATE_INCLUDE,
    });
    if (!template || template.userId !== userId || template.deletedAt) {
      throw new NotFoundException('Routine not found');
    }
    return template;
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateRoutineDto, skipLimitCheck = false) {
    if (!skipLimitCheck) {
      await this.enforceRoutineLimit(userId, 1);
    }
    const folderId = (await this.folders.resolveRef(userId, dto)) ?? null;

    const { entries, groups } = expandItems(dto.items);
    this.requireResolvableRefs(entries);

    const resolutions = await this.resolver.resolveAll(
      userId,
      entries.map((e) => ({ exerciseId: e.dto.exerciseId, name: e.dto.name })),
    );

    const templateId = uuidv4();
    const groupDbIds = groups.map(() => uuidv4());

    const maxSort = await this.prisma.workoutTemplate.aggregate({
      where: { userId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.workoutTemplate.create({
        data: {
          id: templateId,
          userId,
          name: dto.name,
          notes: dto.notes || '',
          folderId,
          sortOrder,
        },
      });

      // Superset rows must exist before member exercises reference them.
      const teIds = entries.map(() => uuidv4());
      for (let g = 0; g < groups.length; g++) {
        await tx.templateSuperset.create({
          data: {
            id: groupDbIds[g],
            templateId,
            supersetColorIndex: groups[g].colorIndex,
            exerciseIds: entries
              .map((e, i) => (e.groupIndex === g ? teIds[i] : null))
              .filter((id): id is string => !!id),
          },
        });
      }

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const supersetId =
          entry.groupIndex !== null ? groupDbIds[entry.groupIndex] : null;
        const itemId = uuidv4();

        await tx.templateItem.create({
          data: { id: itemId, templateId, sortOrder: i, supersetId },
        });

        const { targetSets, targetReps, sets } = this.materializeSets(
          entry.dto,
        );

        await tx.templateExercise.create({
          data: {
            id: teIds[i],
            templateItemId: itemId,
            supersetId,
            exerciseId: resolutions[i].id,
            sortOrder: i,
            targetSets,
            targetReps,
            notes: entry.dto.notes ?? null,
            restTimerSeconds: entry.dto.restTimerSeconds ?? null,
          },
        });

        if (sets.length > 0) {
          await tx.templateSet.createMany({
            data: sets.map((s, idx) => ({
              id: uuidv4(),
              templateExerciseId: teIds[i],
              setNumber: idx + 1,
              targetWeight: s.targetWeight ?? null,
              targetReps: s.targetReps ?? null,
              targetDuration: s.targetDuration ?? null,
              targetDistance: s.targetDistance ?? null,
            })),
          });
        }
      }
    });

    const routine = await this.getOne(userId, templateId);
    return { routine, resolutions };
  }

  /**
   * Create a complete training program: a folder named after the program
   * plus every routine inside it. The free routine limit is checked up
   * front for the whole batch so a partial program is never created.
   */
  async createProgram(userId: string, dto: CreateProgramDto) {
    await this.enforceRoutineLimit(userId, dto.routines.length);
    const { folder, created } = await this.folders.createOrGet(
      userId,
      dto.name,
    );

    const routines: Awaited<ReturnType<RoutinesService['getOne']>>[] = [];
    const resolutions: ExerciseResolution[] = [];
    for (const routineDto of dto.routines) {
      const result = await this.create(
        userId,
        { ...routineDto, folderId: folder.id, folderName: undefined },
        true,
      );
      routines.push(result.routine);
      resolutions.push(...result.resolutions);
    }

    return { folder: { ...folder, created }, routines, resolutions };
  }

  /**
   * Per-set targets: use the provided sets, or materialize
   * targetSets × targetReps placeholder sets so the app always has set rows.
   */
  private materializeSets(dto: RoutineExerciseDto): {
    targetSets: number;
    targetReps: number;
    sets: Array<{
      targetWeight?: number;
      targetReps?: number;
      targetDuration?: number;
      targetDistance?: number;
    }>;
  } {
    const targetReps = dto.targetReps ?? dto.sets?.[0]?.targetReps ?? 10;
    if (dto.sets && dto.sets.length > 0) {
      return { targetSets: dto.sets.length, targetReps, sets: dto.sets };
    }
    const targetSets = dto.targetSets ?? 3;
    return {
      targetSets,
      targetReps,
      sets: Array.from({ length: targetSets }, () => ({ targetReps })),
    };
  }

  // ─── Update (id-keyed merge — progressive overload path) ─────────────────

  async update(userId: string, routineId: string, dto: UpdateRoutineDto) {
    const existing = await this.loadTemplate(userId, routineId);

    if (dto.baseUpdatedAt) {
      const base = Date.parse(dto.baseUpdatedAt);
      if (Number.isNaN(base)) {
        throw new BadRequestException('baseUpdatedAt is not a valid date');
      }
      if (existing.updatedAt.getTime() > base) {
        throw new ConflictException({
          message:
            'The routine changed since it was last read. Re-read it and retry with the merged changes.',
          error: 'Conflict',
          statusCode: 409,
          current: toRoutineView(existing),
        });
      }
    }

    let resolutions: ExerciseResolution[] = [];

    if (dto.items) {
      resolutions = await this.mergeItems(userId, existing, dto.items);
    }

    // undefined = leave folder unchanged; null = remove from folder.
    const folderRef = await this.folders.resolveRef(userId, dto);

    await this.prisma.workoutTemplate.update({
      where: { id: routineId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes ?? '' } : {}),
        ...(folderRef !== undefined ? { folderId: folderRef } : {}),
        // Explicit bump: this is what moves the routine past the app's pull
        // cursor so the change reaches the phone.
        updatedAt: new Date(),
      },
    });

    const routine = await this.getOne(userId, routineId);
    return { routine, resolutions };
  }

  private async mergeItems(
    userId: string,
    existing: Awaited<ReturnType<RoutinesService['loadTemplate']>>,
    items: RoutineItemDto[],
  ): Promise<ExerciseResolution[]> {
    const { entries, groups } = expandItems(items);

    const existingTeById = new Map(
      existing.items
        .filter((i) => i.exercise)
        .map((i) => [i.exercise!.id, { item: i, te: i.exercise! }]),
    );
    const existingSupersetIds = new Set(existing.supersets.map((s) => s.id));

    // Resolve exercise references. Entries that key an existing row and don't
    // re-specify the exercise keep their current exerciseId untouched.
    const resolutions: ExerciseResolution[] = new Array(entries.length);
    const toResolve: { index: number; exerciseId?: string; name?: string }[] =
      [];
    for (let i = 0; i < entries.length; i++) {
      const { dto } = entries[i];
      const kept = dto.id ? existingTeById.get(dto.id) : undefined;
      if (kept && !dto.exerciseId && !dto.name) {
        resolutions[i] = {
          requested: kept.te.exercise?.name ?? kept.te.exerciseId,
          resolvedTo: kept.te.exercise?.name ?? kept.te.exerciseId,
          id: kept.te.exerciseId,
          method: 'id',
          confidence: 1,
          createdCustom: false,
        };
      } else {
        if (!kept && dto.id && !dto.exerciseId && !dto.name?.trim()) {
          throw new BadRequestException(
            `Exercise row "${dto.id}" does not exist in this routine — re-read the routine, or provide a name/exerciseId`,
          );
        }
        if (!dto.exerciseId && !dto.name?.trim()) {
          throw new BadRequestException(
            'Each exercise needs a "name" or an "exerciseId"',
          );
        }
        toResolve.push({
          index: i,
          exerciseId: dto.exerciseId,
          name: dto.name,
        });
      }
    }
    if (toResolve.length > 0) {
      const resolved = await this.resolver.resolveAll(
        userId,
        toResolve.map((r) => ({ exerciseId: r.exerciseId, name: r.name })),
      );
      toResolve.forEach((r, idx) => {
        resolutions[r.index] = resolved[idx];
      });
    }

    // Assign db ids: kept rows keep theirs, new rows get fresh UUIDs.
    const plan = entries.map((entry, i) => {
      const kept = entry.dto.id ? existingTeById.get(entry.dto.id) : undefined;
      return {
        entry,
        resolution: resolutions[i],
        kept,
        teId: kept ? kept.te.id : uuidv4(),
        itemId: kept ? kept.item.id : uuidv4(),
      };
    });

    const groupPlan = groups.map((group) => ({
      group,
      dbId:
        group.dtoId && existingSupersetIds.has(group.dtoId)
          ? group.dtoId
          : uuidv4(),
      isKept: !!group.dtoId && existingSupersetIds.has(group.dtoId),
    }));

    const keptTeIds = plan.filter((p) => p.kept).map((p) => p.teId);
    const keptItemIds = plan.filter((p) => p.kept).map((p) => p.itemId);
    const keptSupersetIds = groupPlan
      .filter((g) => g.isKept)
      .map((g) => g.dbId);

    // Sets to keep: incoming set ids that belong to the same exercise, plus
    // every existing set of a kept exercise whose payload omitted "sets"
    // (omitting the array means "leave my sets alone").
    const keptSetIds: string[] = [];
    for (const p of plan) {
      if (!p.kept) continue;
      const existingSetIds = new Set(p.kept.te.sets.map((s) => s.id));
      if (p.entry.dto.sets === undefined) {
        keptSetIds.push(...existingSetIds);
      } else {
        for (const s of p.entry.dto.sets) {
          if (s.id && existingSetIds.has(s.id)) keptSetIds.push(s.id);
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Deletions (children first; TemplateSet does not cascade).
      await tx.templateSet.deleteMany({
        where: {
          templateExercise: { templateItem: { templateId: existing.id } },
          id: { notIn: keptSetIds },
        },
      });
      await tx.templateExercise.deleteMany({
        where: {
          templateItem: { templateId: existing.id },
          id: { notIn: keptTeIds },
        },
      });
      await tx.templateItem.deleteMany({
        where: { templateId: existing.id, id: { notIn: keptItemIds } },
      });
      await tx.templateSuperset.deleteMany({
        where: { templateId: existing.id, id: { notIn: keptSupersetIds } },
      });

      // 2. Supersets (members reference them via FK).
      for (let g = 0; g < groupPlan.length; g++) {
        const memberTeIds = plan
          .filter((p) => p.entry.groupIndex === g)
          .map((p) => p.teId);
        const data = {
          supersetColorIndex: groupPlan[g].group.colorIndex,
          exerciseIds: memberTeIds,
        };
        if (groupPlan[g].isKept) {
          await tx.templateSuperset.update({
            where: { id: groupPlan[g].dbId },
            data,
          });
        } else {
          await tx.templateSuperset.create({
            data: { id: groupPlan[g].dbId, templateId: existing.id, ...data },
          });
        }
      }

      // 3. Items + exercises in payload order.
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        const supersetId =
          p.entry.groupIndex !== null
            ? groupPlan[p.entry.groupIndex].dbId
            : null;

        if (p.kept) {
          const te = p.kept.te;
          const dtoEx = p.entry.dto;
          const targetSets =
            dtoEx.sets !== undefined
              ? Math.max(dtoEx.sets.length, 1)
              : (dtoEx.targetSets ?? te.targetSets);

          await tx.templateItem.update({
            where: { id: p.itemId },
            data: { sortOrder: i, supersetId },
          });
          await tx.templateExercise.update({
            where: { id: p.teId },
            data: {
              exerciseId: p.resolution.id,
              sortOrder: i,
              supersetId,
              targetSets,
              targetReps: dtoEx.targetReps ?? te.targetReps,
              notes: dtoEx.notes !== undefined ? dtoEx.notes : te.notes,
              restTimerSeconds:
                dtoEx.restTimerSeconds !== undefined
                  ? dtoEx.restTimerSeconds
                  : te.restTimerSeconds,
            },
          });

          if (dtoEx.sets !== undefined) {
            const existingSetIds = new Set(te.sets.map((s) => s.id));
            for (let s = 0; s < dtoEx.sets.length; s++) {
              const setDto = dtoEx.sets[s];
              const values = {
                setNumber: s + 1,
                targetWeight: setDto.targetWeight ?? null,
                targetReps: setDto.targetReps ?? null,
                targetDuration: setDto.targetDuration ?? null,
                targetDistance: setDto.targetDistance ?? null,
              };
              if (setDto.id && existingSetIds.has(setDto.id)) {
                await tx.templateSet.update({
                  where: { id: setDto.id },
                  data: values,
                });
              } else {
                await tx.templateSet.create({
                  data: {
                    id: uuidv4(),
                    templateExerciseId: p.teId,
                    ...values,
                  },
                });
              }
            }
          }
        } else {
          await tx.templateItem.create({
            data: {
              id: p.itemId,
              templateId: existing.id,
              sortOrder: i,
              supersetId,
            },
          });

          const { targetSets, targetReps, sets } = this.materializeSets(
            p.entry.dto,
          );
          await tx.templateExercise.create({
            data: {
              id: p.teId,
              templateItemId: p.itemId,
              supersetId,
              exerciseId: p.resolution.id,
              sortOrder: i,
              targetSets,
              targetReps,
              notes: p.entry.dto.notes ?? null,
              restTimerSeconds: p.entry.dto.restTimerSeconds ?? null,
            },
          });
          if (sets.length > 0) {
            await tx.templateSet.createMany({
              data: sets.map((s, idx) => ({
                id: uuidv4(),
                templateExerciseId: p.teId,
                setNumber: idx + 1,
                targetWeight: s.targetWeight ?? null,
                targetReps: s.targetReps ?? null,
                targetDuration: s.targetDuration ?? null,
                targetDistance: s.targetDistance ?? null,
              })),
            });
          }
        }
      }
    });

    return resolutions;
  }

  // ─── Guards ───────────────────────────────────────────────────────────────

  private requireResolvableRefs(entries: Array<{ dto: RoutineExerciseDto }>) {
    for (const { dto } of entries) {
      if (!dto.exerciseId && !dto.name?.trim() && !dto.id) {
        throw new BadRequestException(
          'Each exercise needs a "name" or an "exerciseId"',
        );
      }
    }
  }

  private async enforceRoutineLimit(userId: string, adding: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPro: true },
    });
    if (user?.isPro) return;

    const count = await this.prisma.workoutTemplate.count({
      where: { userId, deletedAt: null },
    });
    if (count + adding > FREE_ROUTINE_LIMIT) {
      throw new ForbiddenException({
        message: `Free accounts are limited to ${FREE_ROUTINE_LIMIT} routines. Upgrade to Wolog Pro for unlimited routines.`,
        error: 'Forbidden',
        statusCode: 403,
        code: 'PRO_REQUIRED',
      });
    }
  }
}
