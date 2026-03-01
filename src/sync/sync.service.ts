import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SyncPushRequestDto,
  WorkoutPushDto,
  ExercisePushDto,
  TemplatePushDto,
  MeasurementPushDto,
} from './dto/sync-push.dto.js';
import { SyncPullRequestDto } from './dto/sync-pull.dto.js';

interface PushResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

export interface EntityPushResult {
  workouts: PushResult;
  exercises: PushResult;
  templates: PushResult;
  measurements: PushResult;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private prisma: PrismaService) {}

  // ─── PUSH ───────────────────────────────────────────────────────────────────

  async push(
    userId: string,
    dto: SyncPushRequestDto,
  ): Promise<EntityPushResult> {
    const results: EntityPushResult = {
      workouts: { accepted: [], rejected: [] },
      exercises: { accepted: [], rejected: [] },
      templates: { accepted: [], rejected: [] },
      measurements: { accepted: [], rejected: [] },
    };

    // Process exercises first (workouts/templates reference them)
    if (dto.exercises?.length) {
      results.exercises = await this.pushExercises(userId, dto.exercises);
    }

    if (dto.workouts?.length) {
      results.workouts = await this.pushWorkouts(userId, dto.workouts);
    }

    if (dto.templates?.length) {
      results.templates = await this.pushTemplates(userId, dto.templates);
    }

    if (dto.measurements?.length) {
      results.measurements = await this.pushMeasurements(
        userId,
        dto.measurements,
      );
    }

    return results;
  }

  private async pushWorkouts(
    userId: string,
    workouts: WorkoutPushDto[],
  ): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };

    for (const workout of workouts) {
      try {
        const existing = await this.prisma.workout.findUnique({
          where: { id: workout.id },
        });

        const clientUpdatedAt = new Date(workout.updatedAt);

        if (existing && existing.userId !== userId) {
          result.rejected.push({ id: workout.id, reason: 'forbidden' });
          continue;
        }

        if (existing && existing.updatedAt > clientUpdatedAt) {
          result.rejected.push({ id: workout.id, reason: 'server_newer' });
          continue;
        }

        // Atomic upsert: delete children then re-insert in a transaction
        await this.prisma.$transaction(async (tx) => {
          if (existing) {
            await tx.exerciseSet.deleteMany({
              where: { workoutExercise: { workoutId: workout.id } },
            });
            await tx.workoutExercise.deleteMany({
              where: { workoutId: workout.id },
            });
            await tx.workoutSuperset.deleteMany({
              where: { workoutId: workout.id },
            });
          }

          await tx.workout.upsert({
            where: { id: workout.id },
            create: {
              id: workout.id,
              userId,
              name: workout.name,
              startedAt: new Date(workout.startedAt),
              completedAt: workout.completedAt
                ? new Date(workout.completedAt)
                : null,
              notes: workout.notes || null,
              activeCalories: workout.activeCalories || 0,
              deletedAt: workout.deletedAt ? new Date(workout.deletedAt) : null,
            },
            update: {
              name: workout.name,
              startedAt: new Date(workout.startedAt),
              completedAt: workout.completedAt
                ? new Date(workout.completedAt)
                : null,
              notes: workout.notes || null,
              activeCalories: workout.activeCalories || 0,
              deletedAt: workout.deletedAt ? new Date(workout.deletedAt) : null,
            },
          });

          // Insert exercises
          for (const we of workout.exercises) {
            await tx.workoutExercise.create({
              data: {
                id: we.id,
                workoutId: workout.id,
                exerciseId: we.exerciseId,
                sortOrder: we.sortOrder,
                notes: we.notes || null,
              },
            });

            if (we.sets?.length) {
              await tx.exerciseSet.createMany({
                data: we.sets.map((s) => ({
                  id: s.id,
                  workoutExerciseId: we.id,
                  setNumber: s.setNumber,
                  weight: s.weight ?? null,
                  reps: s.reps ?? null,
                  duration: s.duration ?? null,
                  distance: s.distance ?? null,
                  isCompleted: s.isCompleted,
                  type: s.type as any,
                  prRecords: s.prRecords ?? Prisma.JsonNull,
                })),
              });
            }
          }

          // Insert supersets
          if (workout.supersets?.length) {
            await tx.workoutSuperset.createMany({
              data: workout.supersets.map((ss) => ({
                id: ss.id,
                workoutId: workout.id,
                supersetColorIndex: ss.supersetColorIndex,
                exerciseIds: ss.exerciseIds,
              })),
            });
          }
        });

        result.accepted.push(workout.id);
      } catch (error) {
        this.logger.error(`Failed to push workout ${workout.id}`, error);
        result.rejected.push({ id: workout.id, reason: 'error' });
      }
    }

    return result;
  }

  private async pushExercises(
    userId: string,
    exercises: ExercisePushDto[],
  ): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };

    for (const exercise of exercises) {
      try {
        const existing = await this.prisma.exercise.findUnique({
          where: { id: exercise.id },
        });

        const clientUpdatedAt = new Date(exercise.updatedAt);

        if (existing && existing.userId !== userId) {
          result.rejected.push({ id: exercise.id, reason: 'forbidden' });
          continue;
        }

        if (existing && existing.updatedAt > clientUpdatedAt) {
          result.rejected.push({ id: exercise.id, reason: 'server_newer' });
          continue;
        }

        await this.prisma.exercise.upsert({
          where: { id: exercise.id },
          create: {
            id: exercise.id,
            userId,
            name: exercise.name,
            muscleGroup: exercise.muscleGroup as any,
            equipment: exercise.equipment as any,
            exerciseType: exercise.exerciseType as any,
            isCustom: true,
            restDuration: exercise.restDuration ?? null,
            thumbnailUrl: exercise.thumbnailUrl || null,
            videoUrl: exercise.videoUrl || null,
            primaryMuscles: exercise.primaryMuscles,
            secondaryMuscles: exercise.secondaryMuscles,
            deletedAt: exercise.deletedAt ? new Date(exercise.deletedAt) : null,
          },
          update: {
            name: exercise.name,
            muscleGroup: exercise.muscleGroup as any,
            equipment: exercise.equipment as any,
            exerciseType: exercise.exerciseType as any,
            restDuration: exercise.restDuration ?? null,
            thumbnailUrl: exercise.thumbnailUrl || null,
            videoUrl: exercise.videoUrl || null,
            primaryMuscles: exercise.primaryMuscles,
            secondaryMuscles: exercise.secondaryMuscles,
            deletedAt: exercise.deletedAt ? new Date(exercise.deletedAt) : null,
          },
        });

        result.accepted.push(exercise.id);
      } catch (error) {
        this.logger.error(`Failed to push exercise ${exercise.id}`, error);
        result.rejected.push({ id: exercise.id, reason: 'error' });
      }
    }

    return result;
  }

  private async pushTemplates(
    userId: string,
    templates: TemplatePushDto[],
  ): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };

    for (const template of templates) {
      try {
        const existing = await this.prisma.workoutTemplate.findUnique({
          where: { id: template.id },
        });

        const clientUpdatedAt = new Date(template.updatedAt);

        if (existing && existing.userId !== userId) {
          result.rejected.push({ id: template.id, reason: 'forbidden' });
          continue;
        }

        if (existing && existing.updatedAt > clientUpdatedAt) {
          result.rejected.push({ id: template.id, reason: 'server_newer' });
          continue;
        }

        await this.prisma.$transaction(async (tx) => {
          if (existing) {
            // Delete children in correct order
            await tx.templateSet.deleteMany({
              where: {
                templateExercise: { templateItem: { templateId: template.id } },
              },
            });
            await tx.templateExercise.deleteMany({
              where: { templateItem: { templateId: template.id } },
            });
            await tx.templateItem.deleteMany({
              where: { templateId: template.id },
            });
            await tx.templateSuperset.deleteMany({
              where: { templateId: template.id },
            });
          }

          await tx.workoutTemplate.upsert({
            where: { id: template.id },
            create: {
              id: template.id,
              userId,
              name: template.name,
              notes: template.notes || '',
              sortOrder: template.sortOrder,
              createdAt: new Date(template.createdAt),
              deletedAt: template.deletedAt
                ? new Date(template.deletedAt)
                : null,
            },
            update: {
              name: template.name,
              notes: template.notes || '',
              sortOrder: template.sortOrder,
              deletedAt: template.deletedAt
                ? new Date(template.deletedAt)
                : null,
            },
          });

          // Insert supersets first (items reference them)
          if (template.supersets?.length) {
            for (const ss of template.supersets) {
              await tx.templateSuperset.create({
                data: {
                  id: ss.id,
                  templateId: template.id,
                  supersetColorIndex: ss.supersetColorIndex,
                  exerciseIds: ss.exerciseIds,
                },
              });

              // Superset-level exercises
              for (const se of ss.exercises || []) {
                await tx.templateExercise.create({
                  data: {
                    id: se.id,
                    templateItemId: se.id, // Will be linked when item is created
                    supersetId: ss.id,
                    exerciseId: se.exerciseId,
                    sortOrder: se.sortOrder,
                    targetSets: se.targetSets ?? 3,
                    targetReps: se.targetReps ?? 10,
                    notes: se.notes || null,
                    restTimerSeconds: se.restTimerSeconds ?? null,
                  },
                });

                if (se.sets?.length) {
                  await tx.templateSet.createMany({
                    data: se.sets.map((s) => ({
                      id: s.id,
                      templateExerciseId: se.id,
                      setNumber: s.setNumber,
                      targetWeight: s.targetWeight ?? null,
                      targetReps: s.targetReps ?? null,
                      targetDuration: s.targetDuration ?? null,
                      targetDistance: s.targetDistance ?? null,
                    })),
                  });
                }
              }
            }
          }

          // Insert items
          for (const item of template.items) {
            await tx.templateItem.create({
              data: {
                id: item.id,
                templateId: template.id,
                sortOrder: item.sortOrder,
                supersetId: item.supersetId || null,
              },
            });

            if (item.exercise) {
              const ex = item.exercise;
              // Check if already created via superset
              const existingExercise = await tx.templateExercise.findUnique({
                where: { id: ex.id },
              });

              if (!existingExercise) {
                await tx.templateExercise.create({
                  data: {
                    id: ex.id,
                    templateItemId: item.id,
                    exerciseId: ex.exerciseId,
                    sortOrder: ex.sortOrder,
                    targetSets: ex.targetSets ?? 3,
                    targetReps: ex.targetReps ?? 10,
                    notes: ex.notes || null,
                    restTimerSeconds: ex.restTimerSeconds ?? null,
                  },
                });
              } else {
                // Update the templateItemId link
                await tx.templateExercise.update({
                  where: { id: ex.id },
                  data: { templateItemId: item.id },
                });
              }

              if (ex.sets?.length) {
                const existingSets = await tx.templateSet.findMany({
                  where: { templateExerciseId: ex.id },
                });
                if (existingSets.length === 0) {
                  await tx.templateSet.createMany({
                    data: ex.sets.map((s) => ({
                      id: s.id,
                      templateExerciseId: ex.id,
                      setNumber: s.setNumber,
                      targetWeight: s.targetWeight ?? null,
                      targetReps: s.targetReps ?? null,
                      targetDuration: s.targetDuration ?? null,
                      targetDistance: s.targetDistance ?? null,
                    })),
                  });
                }
              }
            }
          }
        });

        result.accepted.push(template.id);
      } catch (error) {
        this.logger.error(`Failed to push template ${template.id}`, error);
        result.rejected.push({ id: template.id, reason: 'error' });
      }
    }

    return result;
  }

  private async pushMeasurements(
    userId: string,
    measurements: MeasurementPushDto[],
  ): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };

    for (const m of measurements) {
      try {
        const existing = await this.prisma.bodyMeasurement.findUnique({
          where: { id: m.id },
        });

        const clientUpdatedAt = new Date(m.updatedAt);

        if (existing && existing.userId !== userId) {
          result.rejected.push({ id: m.id, reason: 'forbidden' });
          continue;
        }

        if (existing && existing.updatedAt > clientUpdatedAt) {
          result.rejected.push({ id: m.id, reason: 'server_newer' });
          continue;
        }

        await this.prisma.bodyMeasurement.upsert({
          where: { id: m.id },
          create: {
            id: m.id,
            userId,
            date: new Date(m.date),
            type: m.type as any,
            value: m.value,
            photoUrl: m.photoUrl || null,
            deletedAt: m.deletedAt ? new Date(m.deletedAt) : null,
          },
          update: {
            date: new Date(m.date),
            type: m.type as any,
            value: m.value,
            photoUrl: m.photoUrl || null,
            deletedAt: m.deletedAt ? new Date(m.deletedAt) : null,
          },
        });

        result.accepted.push(m.id);
      } catch (error) {
        this.logger.error(`Failed to push measurement ${m.id}`, error);
        result.rejected.push({ id: m.id, reason: 'error' });
      }
    }

    return result;
  }

  // ─── PULL ───────────────────────────────────────────────────────────────────

  async pull(userId: string, dto: SyncPullRequestDto) {
    const limit = dto.limit || 50;
    const since = dto.since || {};

    const [workouts, exercises, templates, measurements] = await Promise.all([
      this.pullWorkouts(userId, since.workouts, limit),
      this.pullExercises(userId, since.exercises, limit),
      this.pullTemplates(userId, since.templates, limit),
      this.pullMeasurements(userId, since.measurements, limit),
    ]);

    return {
      workouts: workouts.data,
      exercises: exercises.data,
      templates: templates.data,
      measurements: measurements.data,
      cursors: {
        workouts: workouts.cursor,
        exercises: exercises.cursor,
        templates: templates.cursor,
        measurements: measurements.cursor,
      },
      hasMore: {
        workouts: workouts.hasMore,
        exercises: exercises.hasMore,
        templates: templates.hasMore,
        measurements: measurements.hasMore,
      },
    };
  }

  private async pullWorkouts(
    userId: string,
    since: string | undefined,
    limit: number,
  ) {
    const where: Prisma.WorkoutWhereInput = {
      userId,
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    };

    const workouts = await this.prisma.workout.findMany({
      where,
      include: {
        exercises: {
          include: { sets: true },
          orderBy: { sortOrder: 'asc' },
        },
        supersets: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: limit + 1,
    });

    const hasMore = workouts.length > limit;
    const data = hasMore ? workouts.slice(0, limit) : workouts;
    const cursor =
      data.length > 0
        ? data[data.length - 1].updatedAt.toISOString()
        : since || null;

    return { data, cursor, hasMore };
  }

  private async pullExercises(
    userId: string,
    since: string | undefined,
    limit: number,
  ) {
    const where: Prisma.ExerciseWhereInput = {
      userId,
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    };

    const exercises = await this.prisma.exercise.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: limit + 1,
    });

    const hasMore = exercises.length > limit;
    const data = hasMore ? exercises.slice(0, limit) : exercises;
    const cursor =
      data.length > 0
        ? data[data.length - 1].updatedAt.toISOString()
        : since || null;

    return { data, cursor, hasMore };
  }

  private async pullTemplates(
    userId: string,
    since: string | undefined,
    limit: number,
  ) {
    const where: Prisma.WorkoutTemplateWhereInput = {
      userId,
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    };

    const templates = await this.prisma.workoutTemplate.findMany({
      where,
      include: {
        items: {
          include: {
            exercise: {
              include: { sets: true },
            },
            superset: {
              include: { exercises: { include: { sets: true } } },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit + 1,
    });

    const hasMore = templates.length > limit;
    const data = hasMore ? templates.slice(0, limit) : templates;
    const cursor =
      data.length > 0
        ? data[data.length - 1].updatedAt.toISOString()
        : since || null;

    return { data, cursor, hasMore };
  }

  private async pullMeasurements(
    userId: string,
    since: string | undefined,
    limit: number,
  ) {
    const where: Prisma.BodyMeasurementWhereInput = {
      userId,
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    };

    const measurements = await this.prisma.bodyMeasurement.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: limit + 1,
    });

    const hasMore = measurements.length > limit;
    const data = hasMore ? measurements.slice(0, limit) : measurements;
    const cursor =
      data.length > 0
        ? data[data.length - 1].updatedAt.toISOString()
        : since || null;

    return { data, cursor, hasMore };
  }

  // ─── STATUS ─────────────────────────────────────────────────────────────────

  async getStatus(userId: string) {
    const [latestWorkout, latestExercise, latestTemplate, latestMeasurement] =
      await Promise.all([
        this.prisma.workout.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
        this.prisma.exercise.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
        this.prisma.workoutTemplate.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
        this.prisma.bodyMeasurement.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
      ]);

    return {
      workouts: latestWorkout?.updatedAt.toISOString() || null,
      exercises: latestExercise?.updatedAt.toISOString() || null,
      templates: latestTemplate?.updatedAt.toISOString() || null,
      measurements: latestMeasurement?.updatedAt.toISOString() || null,
    };
  }
}
