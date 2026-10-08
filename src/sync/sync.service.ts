import { Injectable } from '@nestjs/common';
import { SyncPushRequestDto } from './dto/sync-push.dto.js';
import { SyncPullRequestDto } from './dto/sync-pull.dto.js';
import { EntityPushResult } from './interfaces/push-result.interface.js';
import { WorkoutSyncService } from './services/workout-sync.service.js';
import { ExerciseSyncService } from './services/exercise-sync.service.js';
import { TemplateSyncService } from './services/template-sync.service.js';
import { FolderSyncService } from './services/folder-sync.service.js';
import { MeasurementSyncService } from './services/measurement-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService, photoKey } from '../storage/storage.service.js';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workoutSync: WorkoutSyncService,
    private readonly exerciseSync: ExerciseSyncService,
    private readonly templateSync: TemplateSyncService,
    private readonly folderSync: FolderSyncService,
    private readonly measurementSync: MeasurementSyncService,
    private readonly storage: StorageService,
  ) {}

  async push(
    userId: string,
    dto: SyncPushRequestDto,
  ): Promise<EntityPushResult> {
    const results: EntityPushResult = {
      workouts: { accepted: [], rejected: [] },
      exercises: { accepted: [], rejected: [] },
      templates: { accepted: [], rejected: [] },
      folders: { accepted: [], rejected: [] },
      measurements: { accepted: [], rejected: [] },
    };

    // Process exercises first (workouts/templates reference them)
    if (dto.exercises?.length) {
      results.exercises = await this.exerciseSync.push(userId, dto.exercises);
    }

    if (dto.workouts?.length) {
      results.workouts = await this.workoutSync.push(userId, dto.workouts);
    }

    if (dto.folders?.length) {
      results.folders = await this.folderSync.push(userId, dto.folders);
    }

    if (dto.templates?.length) {
      results.templates = await this.templateSync.push(userId, dto.templates);
    }

    if (dto.measurements?.length) {
      results.measurements = await this.measurementSync.push(
        userId,
        dto.measurements,
      );
    }

    return results;
  }

  async pull(userId: string, dto: SyncPullRequestDto) {
    const limit = dto.limit || 50;
    const since = dto.since || {};

    const [workouts, exercises, templates, folders, measurements] =
      await Promise.all([
        this.workoutSync.pull(userId, since.workouts, limit),
        this.exerciseSync.pull(userId, since.exercises, limit),
        this.templateSync.pull(userId, since.templates, limit),
        this.folderSync.pull(userId, since.folders, limit),
        this.measurementSync.pull(userId, since.measurements, limit),
      ]);

    return {
      workouts: workouts.data,
      exercises: exercises.data,
      templates: templates.data,
      folders: folders.data,
      measurements: measurements.data,
      cursors: {
        workouts: workouts.cursor,
        exercises: exercises.cursor,
        templates: templates.cursor,
        folders: folders.cursor,
        measurements: measurements.cursor,
      },
      hasMore: {
        workouts: workouts.hasMore,
        exercises: exercises.hasMore,
        templates: templates.hasMore,
        folders: folders.hasMore,
        measurements: measurements.hasMore,
      },
    };
  }

  async purge(userId: string) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 5);

    const deletedBefore = { userId, deletedAt: { lt: cutoff } };

    let purgedPhotoIds: string[] = [];

    const [workouts, exercises, templates, folders, measurements] =
      await this.prisma.$transaction(async (tx) => {
        // Workout photo rows cascade with their workouts; remember them so
        // the storage objects can be removed once the transaction commits.
        const photos = await tx.photo.findMany({
          where: { workout: deletedBefore },
          select: { id: true },
        });
        purgedPhotoIds = photos.map((p) => p.id);

        const { count: workoutCount } = await tx.workout.deleteMany({
          where: deletedBefore,
        });

        const { count: exerciseCount } = await tx.exercise.deleteMany({
          where: deletedBefore,
        });

        const { count: templateCount } = await tx.workoutTemplate.deleteMany({
          where: deletedBefore,
        });

        const { count: folderCount } = await tx.routineFolder.deleteMany({
          where: deletedBefore,
        });

        const { count: measurementCount } = await tx.bodyMeasurement.deleteMany(
          {
            where: deletedBefore,
          },
        );

        // Progress photos no remaining measurement references are orphans.
        const referenced = await tx.bodyMeasurement.findMany({
          where: { userId, photoId: { not: null } },
          select: { photoId: true },
          distinct: ['photoId'],
        });
        const orphans = await tx.photo.findMany({
          where: {
            userId,
            workoutId: null,
            id: { notIn: referenced.map((m) => m.photoId!) },
          },
          select: { id: true },
        });
        if (orphans.length) {
          await tx.photo.deleteMany({
            where: { id: { in: orphans.map((p) => p.id) } },
          });
          purgedPhotoIds.push(...orphans.map((p) => p.id));
        }

        return [
          workoutCount,
          exerciseCount,
          templateCount,
          folderCount,
          measurementCount,
        ];
      });

    if (purgedPhotoIds.length) {
      await this.storage.deleteQuietly(
        purgedPhotoIds.map((id) => photoKey(userId, id)),
      );
    }

    return {
      purged: { workouts, exercises, templates, folders, measurements },
    };
  }

  async getStatus(userId: string) {
    const [workouts, exercises, templates, folders, measurements] =
      await Promise.all([
        this.workoutSync.getLatestTimestamp(userId),
        this.exerciseSync.getLatestTimestamp(userId),
        this.templateSync.getLatestTimestamp(userId),
        this.folderSync.getLatestTimestamp(userId),
        this.measurementSync.getLatestTimestamp(userId),
      ]);

    return { workouts, exercises, templates, folders, measurements };
  }
}
