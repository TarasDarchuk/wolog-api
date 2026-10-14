import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ExercisePushDto } from '../dto/sync-push.dto.js';
import { PushResult } from '../interfaces/push-result.interface.js';
import { pullPage } from '../helpers/pull-page.js';

@Injectable()
export class ExerciseSyncService {
  private readonly logger = new Logger(ExerciseSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async push(
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

        const primaryMuscles = exercise.primaryMuscles ?? [];
        const secondaryMuscles = exercise.secondaryMuscles ?? [];

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
            includesBodyweight: exercise.includesBodyweight ?? false,
            restDuration: exercise.restDuration ?? null,
            thumbnailUrl: exercise.thumbnailUrl || null,
            videoUrl: exercise.videoUrl || null,
            primaryMuscles,
            secondaryMuscles,
            deletedAt: exercise.deletedAt
              ? new Date(exercise.deletedAt)
              : null,
          },
          update: {
            name: exercise.name,
            muscleGroup: exercise.muscleGroup as any,
            equipment: exercise.equipment as any,
            exerciseType: exercise.exerciseType as any,
            includesBodyweight: exercise.includesBodyweight ?? false,
            restDuration: exercise.restDuration ?? null,
            thumbnailUrl: exercise.thumbnailUrl || null,
            videoUrl: exercise.videoUrl || null,
            primaryMuscles,
            secondaryMuscles,
            deletedAt: exercise.deletedAt
              ? new Date(exercise.deletedAt)
              : null,
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

  async pull(userId: string, since: string | undefined, limit: number) {
    const where: Prisma.ExerciseWhereInput = {
      userId,
    };

    const { rows: exercises, hasMore } = await pullPage(
      (updatedAt, take) =>
        this.prisma.exercise.findMany({
          where: { ...where, ...(updatedAt ? { updatedAt } : {}) },
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          take,
        }),
      since,
      limit,
    );
    const data = exercises;
    const cursor =
      data.length > 0
        ? data[data.length - 1].updatedAt.toISOString()
        : since || null;

    return { data, cursor, hasMore };
  }

  async getLatestTimestamp(userId: string): Promise<string | null> {
    const latest = await this.prisma.exercise.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return latest?.updatedAt.toISOString() || null;
  }
}
