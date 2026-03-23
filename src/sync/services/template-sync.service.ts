import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TemplatePushDto } from '../dto/sync-push.dto.js';
import { PushResult } from '../interfaces/push-result.interface.js';

@Injectable()
export class TemplateSyncService {
  private readonly logger = new Logger(TemplateSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async push(
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
            await tx.templateSet.deleteMany({
              where: {
                templateExercise: {
                  templateItem: { templateId: template.id },
                },
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

              for (const se of ss.exercises || []) {
                await tx.templateExercise.create({
                  data: {
                    id: se.id,
                    templateItemId: se.id,
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

  async pull(userId: string, since: string | undefined, limit: number) {
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
        supersets: true,
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

  async getLatestTimestamp(userId: string): Promise<string | null> {
    const latest = await this.prisma.workoutTemplate.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return latest?.updatedAt.toISOString() || null;
  }
}
