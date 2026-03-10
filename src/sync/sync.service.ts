import { Injectable } from '@nestjs/common';
import { SyncPushRequestDto } from './dto/sync-push.dto.js';
import { SyncPullRequestDto } from './dto/sync-pull.dto.js';
import { EntityPushResult } from './interfaces/push-result.interface.js';
import { WorkoutSyncService } from './services/workout-sync.service.js';
import { ExerciseSyncService } from './services/exercise-sync.service.js';
import { TemplateSyncService } from './services/template-sync.service.js';
import { MeasurementSyncService } from './services/measurement-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workoutSync: WorkoutSyncService,
    private readonly exerciseSync: ExerciseSyncService,
    private readonly templateSync: TemplateSyncService,
    private readonly measurementSync: MeasurementSyncService,
  ) {}

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
      results.exercises = await this.exerciseSync.push(userId, dto.exercises);
    }

    if (dto.workouts?.length) {
      results.workouts = await this.workoutSync.push(userId, dto.workouts);
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

    const [workouts, exercises, templates, measurements] = await Promise.all([
      this.workoutSync.pull(userId, since.workouts, limit),
      this.exerciseSync.pull(userId, since.exercises, limit),
      this.templateSync.pull(userId, since.templates, limit),
      this.measurementSync.pull(userId, since.measurements, limit),
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

  async purge(userId: string) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 5);

    const deletedBefore = { userId, deletedAt: { lt: cutoff } };

    const [workouts, exercises, templates, measurements] =
      await this.prisma.$transaction(async (tx) => {
        const { count: workoutCount } = await tx.workout.deleteMany({
          where: deletedBefore,
        });

        const { count: exerciseCount } = await tx.exercise.deleteMany({
          where: deletedBefore,
        });

        const { count: templateCount } = await tx.workoutTemplate.deleteMany({
          where: deletedBefore,
        });

        const { count: measurementCount } =
          await tx.bodyMeasurement.deleteMany({
            where: deletedBefore,
          });

        return [workoutCount, exerciseCount, templateCount, measurementCount];
      });

    return {
      purged: { workouts, exercises, templates, measurements },
    };
  }

  async getStatus(userId: string) {
    const [workouts, exercises, templates, measurements] = await Promise.all([
      this.workoutSync.getLatestTimestamp(userId),
      this.exerciseSync.getLatestTimestamp(userId),
      this.templateSync.getLatestTimestamp(userId),
      this.measurementSync.getLatestTimestamp(userId),
    ]);

    return { workouts, exercises, templates, measurements };
  }
}
