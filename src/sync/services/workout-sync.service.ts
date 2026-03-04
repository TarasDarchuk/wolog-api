import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WorkoutPushDto } from '../dto/sync-push.dto.js';
import { PushResult } from '../interfaces/push-result.interface.js';

@Injectable()
export class WorkoutSyncService {
  private readonly logger = new Logger(WorkoutSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async push(userId: string, workouts: WorkoutPushDto[]): Promise<PushResult> {
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
              heartRateSamples: workout.heartRateSamples
                ? (workout.heartRateSamples as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
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
              heartRateSamples: workout.heartRateSamples
                ? (workout.heartRateSamples as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
              deletedAt: workout.deletedAt
                ? new Date(workout.deletedAt)
                : null,
            },
          });

          if (workout.exercises.length) {
            await tx.workoutExercise.createMany({
              data: workout.exercises.map((we) => ({
                id: we.id,
                workoutId: workout.id,
                exerciseId: we.exerciseId,
                sortOrder: we.sortOrder,
                notes: we.notes || null,
              })),
            });

            const allSets = workout.exercises.flatMap((we) =>
              (we.sets || []).map((s) => ({
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
            );
            if (allSets.length) {
              await tx.exerciseSet.createMany({ data: allSets });
            }
          }

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

  async pull(userId: string, since: string | undefined, limit: number) {
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

  async getLatestTimestamp(userId: string): Promise<string | null> {
    const latest = await this.prisma.workout.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return latest?.updatedAt.toISOString() || null;
  }
}
