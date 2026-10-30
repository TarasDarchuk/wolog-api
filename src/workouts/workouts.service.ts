import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface HistorySet {
  setNumber: number;
  weight: number | null; // kg
  reps: number | null;
  duration: number | null; // seconds
  distance: number | null; // meters
  type: string;
  isCompleted: boolean;
}

/** Epley estimated 1RM: weight × (1 + reps/30). Null when not derivable. */
export function epleyE1Rm(
  weight: number | null,
  reps: number | null,
): number | null {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 100) / 100;
}

export interface RecordSet {
  value: number;
  weight: number | null; // kg
  reps: number | null;
  duration: number | null; // seconds
  distance: number | null; // meters
  workoutId: string;
  completedAt: string;
}

export interface ExerciseRecords {
  exerciseId: string;
  name: string;
  exerciseType: string;
  sessions: number;
  lastPerformedAt: string;
  bestE1Rm: RecordSet | null;
  heaviestWeight: RecordSet | null;
  mostReps: RecordSet | null;
  longestDuration: RecordSet | null;
  longestDistance: RecordSet | null;
}

/** One record row per metric: the top set by `order`, as JSON. */
function recordAgg(value: Prisma.Sql, filter: Prisma.Sql, order: Prisma.Sql) {
  return Prisma.sql`(array_agg(jsonb_build_object(
      'value', ${value},
      'weight', s.weight, 'reps', s.reps,
      'duration', s.duration, 'distance', s.distance,
      'workoutId', s."workoutId",
      'completedAt', to_char(s."completedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY ${order}, s."completedAt") FILTER (WHERE ${filter}))[1]`;
}

@Injectable()
export class WorkoutsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recent completed workouts, newest first (§7). All weights kg.
   *
   * Only performed work is returned: sets the user never checked off are
   * omitted, and so are sessions with zero duration or zero completed sets.
   * A workout discarded in the app after it already synced shows up here as a
   * zero-duration "completed" workout full of untouched target sets — without
   * these filters it pollutes history with numbers the user never lifted.
   */
  async listWorkouts(
    userId: string,
    options: { since?: string; exerciseId?: string; limit: number },
  ) {
    const where: Prisma.WorkoutWhereInput = {
      userId,
      deletedAt: null,
      completedAt: {
        not: null,
        gt: this.prisma.workout.fields.startedAt,
        ...(options.since ? { gte: new Date(options.since) } : {}),
      },
      exercises: { some: { sets: { some: { isCompleted: true } } } },
      ...(options.exerciseId
        ? { AND: [{ exercises: { some: { exerciseId: options.exerciseId } } }] }
        : {}),
    };

    const workouts = await this.prisma.workout.findMany({
      where,
      orderBy: { completedAt: 'desc' },
      take: options.limit,
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: {
            sets: {
              where: { isCompleted: true },
              orderBy: { setNumber: 'asc' },
            },
            exercise: { select: { name: true } },
          },
        },
      },
    });

    return {
      workouts: workouts.map((w) => ({
        id: w.id,
        name: w.name,
        startedAt: w.startedAt.toISOString(),
        completedAt: w.completedAt?.toISOString() ?? null,
        exercises: w.exercises
          .filter((we) => we.sets.length > 0)
          .map((we) => ({
            exerciseId: we.exerciseId,
            name: we.exercise?.name ?? null,
            sets: we.sets.map((s) => this.mapSet(s)),
          })),
      })),
    };
  }

  /**
   * Recent sets for one exercise across workouts, with derived best set and
   * Epley e1RM per session — the progressive-overload data source (§7).
   *
   * Same performed-work filters as listWorkouts: only completed sets, only
   * sessions with a positive duration where this exercise has at least one
   * completed set.
   */
  async exerciseHistory(userId: string, exerciseId: string, limit: number) {
    if (!isUUID(exerciseId)) throw new NotFoundException('Exercise not found');
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { id: true, name: true, userId: true, deletedAt: true },
    });
    if (
      !exercise ||
      exercise.deletedAt ||
      (exercise.userId !== null && exercise.userId !== userId)
    ) {
      throw new NotFoundException('Exercise not found');
    }

    const workouts = await this.prisma.workout.findMany({
      where: {
        userId,
        deletedAt: null,
        completedAt: { not: null, gt: this.prisma.workout.fields.startedAt },
        exercises: {
          some: { exerciseId, sets: { some: { isCompleted: true } } },
        },
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
      include: {
        exercises: {
          where: { exerciseId },
          include: {
            sets: {
              where: { isCompleted: true },
              orderBy: { setNumber: 'asc' },
            },
          },
        },
      },
    });

    const sessions = workouts.map((w) => {
      const sets = w.exercises
        .flatMap((we) => we.sets)
        .map((s) => this.mapSet(s));

      let bestSet: HistorySet | null = null;
      let bestE1Rm: number | null = null;
      // Warmups don't count toward records (same as the app).
      for (const set of sets) {
        if (set.type === 'warmup') continue;
        const e1rm = epleyE1Rm(set.weight, set.reps);
        if (
          bestSet === null ||
          (e1rm ?? -1) > (bestE1Rm ?? -1) ||
          (e1rm === null &&
            bestE1Rm === null &&
            (set.weight ?? set.reps ?? 0) >
              (bestSet.weight ?? bestSet.reps ?? 0))
        ) {
          bestSet = set;
          bestE1Rm = e1rm;
        }
      }

      return {
        workoutId: w.id,
        workoutName: w.name,
        completedAt: w.completedAt?.toISOString() ?? null,
        sets,
        bestSet,
        estimatedOneRepMax: bestE1Rm,
      };
    });

    const [allTime] = await this.personalRecords(userId, [exerciseId]);
    return {
      exerciseId: exercise.id,
      name: exercise.name,
      allTime: allTime ?? null,
      sessions,
    };
  }

  /**
   * All-time records per exercise over the user's whole performed history
   * (same filters as above: completed sets of completed, non-discarded
   * workouts; warmups excluded). `sessions` in exerciseHistory is only the
   * most recent page, so PRs set earlier would otherwise be invisible.
   *
   * Assisted exercises get no weight records: there less assistance is better.
   */
  async personalRecords(
    userId: string,
    exerciseIds?: string[],
  ): Promise<ExerciseRecords[]> {
    const e1rm = Prisma.sql`CASE WHEN s.reps = 1 THEN s.weight ELSE s.weight * (1 + s.reps / 30.0) END`;
    const weighted = Prisma.sql`s.weight > 0 AND s."exerciseType" <> 'assistedBodyweight'`;
    const byExercise = exerciseIds?.length
      ? Prisma.sql`AND we."exerciseId" = ANY(${exerciseIds}::uuid[])`
      : Prisma.empty;

    return this.prisma.$queryRaw<ExerciseRecords[]>`
      WITH s AS (
        SELECT we."exerciseId", e.name, e."exerciseType"::text AS "exerciseType",
               w.id AS "workoutId", w."completedAt",
               es.weight, es.reps, es.duration, es.distance
        FROM "ExerciseSet" es
        JOIN "WorkoutExercise" we ON we.id = es."workoutExerciseId"
        JOIN "Workout" w ON w.id = we."workoutId"
        JOIN "Exercise" e ON e.id = we."exerciseId"
        WHERE w."userId" = ${userId}::uuid
          AND w."deletedAt" IS NULL
          AND w."completedAt" > w."startedAt"
          AND es."isCompleted"
          AND es.type <> 'warmup'
          ${byExercise}
      )
      SELECT s."exerciseId", s.name, s."exerciseType",
        count(DISTINCT s."workoutId")::int AS sessions,
        to_char(max(s."completedAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastPerformedAt",
        ${recordAgg(
          Prisma.sql`round((${e1rm})::numeric, 2)`,
          Prisma.sql`${weighted} AND s.reps > 0`,
          Prisma.sql`${e1rm} DESC`,
        )} AS "bestE1Rm",
        ${recordAgg(
          Prisma.sql`s.weight`,
          weighted,
          Prisma.sql`s.weight DESC, s.reps DESC NULLS LAST`,
        )} AS "heaviestWeight",
        ${recordAgg(
          Prisma.sql`s.reps`,
          Prisma.sql`s.reps > 0`,
          Prisma.sql`s.reps DESC, s.weight DESC NULLS LAST`,
        )} AS "mostReps",
        ${recordAgg(
          Prisma.sql`s.duration`,
          Prisma.sql`s.duration > 0`,
          Prisma.sql`s.duration DESC`,
        )} AS "longestDuration",
        ${recordAgg(
          Prisma.sql`s.distance`,
          Prisma.sql`s.distance > 0`,
          Prisma.sql`s.distance DESC`,
        )} AS "longestDistance"
      FROM s
      GROUP BY s."exerciseId", s.name, s."exerciseType"
      ORDER BY sessions DESC, s.name`;
  }

  private mapSet(s: {
    setNumber: number;
    weight: number | null;
    reps: number | null;
    duration: number | null;
    distance: number | null;
    type: string;
    isCompleted: boolean;
  }): HistorySet {
    return {
      setNumber: s.setNumber,
      weight: s.weight,
      reps: s.reps,
      duration: s.duration,
      distance: s.distance,
      type: s.type,
      isCompleted: s.isCompleted,
    };
  }
}
