import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WorkoutPhotoPushDto, WorkoutPushDto } from '../dto/sync-push.dto.js';
import { PushResult } from '../interfaces/push-result.interface.js';
import { StorageService, photoKeys } from '../../storage/storage.service.js';
import { pullPage } from '../helpers/pull-page.js';

@Injectable()
export class WorkoutSyncService {
  private readonly logger = new Logger(WorkoutSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async push(userId: string, workouts: WorkoutPushDto[]): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };

    for (let workout of workouts) {
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

        if (
          workout.photos?.length &&
          (await this.ownsForeignPhoto(userId, workout.photos))
        ) {
          result.rejected.push({ id: workout.id, reason: 'forbidden' });
          continue;
        }

        const remapped = await this.remapForeignChildIds(userId, workout);
        if (!remapped) {
          result.rejected.push({ id: workout.id, reason: 'forbidden' });
          continue;
        }
        workout = remapped;

        let removedPhotoIds: string[] = [];

        await this.prisma.$transaction(async (tx) => {
          // Photos are not part of the children rebuild: they are only
          // touched when the client sends the `photos` key.
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
              templateId: workout.templateId || null,
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
              templateId: workout.templateId || null,
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
          });

          if (workout.exercises.length) {
            await tx.workoutExercise.createMany({
              data: workout.exercises.map((we) => ({
                id: we.id,
                workoutId: workout.id,
                exerciseId: we.exerciseId,
                sortOrder: we.sortOrder,
                notes: we.notes || null,
                restTimerSeconds: we.restTimerSeconds ?? null,
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

          if (workout.photos) {
            removedPhotoIds = await this.replacePhotos(
              tx,
              userId,
              workout.id,
              !!existing,
              workout.photos,
            );
          }
        });

        if (removedPhotoIds.length) {
          await this.storage.deleteQuietly(
            removedPhotoIds.flatMap((id) => photoKeys(userId, id)),
          );
        }

        result.accepted.push(workout.id);
      } catch (error) {
        this.logger.error(`Failed to push workout ${workout.id}`, error);
        result.rejected.push({ id: workout.id, reason: 'error' });
      }
    }

    return result;
  }

  /**
   * Children are replaced by id, so an id that already belongs to another workout
   * fails the createMany (P2002) — every workout in a bulk re-push whose children
   * collide is rejected. Ids held by another workout of the same user get fresh
   * ones (the pull hands them back to the client); ids of another user's
   * workout → null.
   */
  private async remapForeignChildIds(
    userId: string,
    workout: WorkoutPushDto,
  ): Promise<WorkoutPushDto | null> {
    const exerciseIds = workout.exercises.map((we) => we.id);
    const setIds = workout.exercises.flatMap((we) =>
      (we.sets ?? []).map((s) => s.id),
    );
    const supersetIds = (workout.supersets ?? []).map((ss) => ss.id);

    const notThis = { not: workout.id };
    const [exs, sets, sss] = await Promise.all([
      this.prisma.workoutExercise.findMany({
        where: { id: { in: exerciseIds }, workoutId: notThis },
        select: { id: true, workout: { select: { userId: true } } },
      }),
      this.prisma.exerciseSet.findMany({
        where: {
          id: { in: setIds },
          workoutExercise: { workoutId: notThis },
        },
        select: {
          id: true,
          workoutExercise: {
            select: { workout: { select: { userId: true } } },
          },
        },
      }),
      this.prisma.workoutSuperset.findMany({
        where: { id: { in: supersetIds }, workoutId: notThis },
        select: { id: true, workout: { select: { userId: true } } },
      }),
    ]);

    const owners = [
      ...exs.map((r) => ({ id: r.id, userId: r.workout?.userId })),
      ...sets.map((r) => ({
        id: r.id,
        userId: r.workoutExercise?.workout?.userId,
      })),
      ...sss.map((r) => ({ id: r.id, userId: r.workout?.userId })),
    ];
    if (owners.length === 0) return workout;
    if (owners.some((o) => o.userId !== userId)) {
      this.logger.warn(
        `Workout ${workout.id} reuses child ids of another user's workout`,
      );
      return null;
    }

    // Postgres returns ids lowercased; clients send them uppercase
    const fresh = new Map(
      owners.map((o) => [o.id.toLowerCase(), randomUUID()]),
    );
    const map = (id: string) => fresh.get(id.toLowerCase()) ?? id;
    this.logger.warn(
      `Workout ${workout.id}: ${fresh.size} child ids belong to another workout of the same user — reassigned`,
    );

    return {
      ...workout,
      exercises: workout.exercises.map((we) => ({
        ...we,
        id: map(we.id),
        supersetId: we.supersetId ? map(we.supersetId) : we.supersetId,
        sets: (we.sets ?? []).map((s) => ({ ...s, id: map(s.id) })),
      })),
      supersets: workout.supersets?.map((ss) => ({
        ...ss,
        id: map(ss.id),
        exerciseIds: ss.exerciseIds.map(map),
      })),
    };
  }

  /** True if any of the photo ids is already owned by another user. */
  private async ownsForeignPhoto(
    userId: string,
    photos: WorkoutPhotoPushDto[],
  ): Promise<boolean> {
    const rows = await this.prisma.photo.findMany({
      where: { id: { in: photos.map((p) => p.id) } },
      select: { userId: true },
    });
    return rows.some((r) => r.userId !== userId);
  }

  /**
   * Makes `photos` the workout's full photo list: upserts by id (never
   * touching uploadedAt/byteSize) and deletes rows not in the list.
   * Returns the ids of deleted photos so their objects can be removed
   * after the transaction commits.
   */
  private async replacePhotos(
    tx: Prisma.TransactionClient,
    userId: string,
    workoutId: string,
    workoutExisted: boolean,
    photos: WorkoutPhotoPushDto[],
  ): Promise<string[]> {
    const ids = photos.map((p) => p.id);
    let removedIds: string[] = [];

    if (workoutExisted) {
      const removed = await tx.photo.findMany({
        where: { workoutId, id: { notIn: ids } },
        select: { id: true },
      });
      removedIds = removed.map((r) => r.id);
      if (removedIds.length) {
        await tx.photo.deleteMany({ where: { id: { in: removedIds } } });
      }
    }

    for (const photo of photos) {
      await tx.photo.upsert({
        where: { id: photo.id },
        create: {
          id: photo.id,
          userId,
          workoutId,
          sortOrder: photo.sortOrder,
          width: photo.width,
          height: photo.height,
          createdAt: new Date(photo.createdAt),
        },
        update: {
          workoutId,
          sortOrder: photo.sortOrder,
          width: photo.width,
          height: photo.height,
        },
      });
    }

    return removedIds;
  }

  async pull(userId: string, since: string | undefined, limit: number) {
    const where: Prisma.WorkoutWhereInput = {
      userId,
    };

    const { rows: workouts, hasMore } = await pullPage(
      (updatedAt, take) =>
        this.prisma.workout.findMany({
          where: { ...where, ...(updatedAt ? { updatedAt } : {}) },
          include: {
            exercises: {
              include: { sets: true },
              orderBy: { sortOrder: 'asc' },
            },
            supersets: true,
            photos: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          take,
        }),
      since,
      limit,
    );
    const data = workouts.map(({ photos, ...w }) => ({
      ...w,
      photos: (photos ?? []).map((p) => ({
        id: p.id,
        sortOrder: p.sortOrder,
        width: p.width,
        height: p.height,
        createdAt: p.createdAt,
        uploaded: p.uploadedAt != null,
      })),
    }));
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
