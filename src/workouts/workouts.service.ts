import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class WorkoutsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recent completed workouts, newest first (§7). All weights kg. */
  async listWorkouts(
    userId: string,
    options: { since?: string; exerciseId?: string; limit: number },
  ) {
    const where: Prisma.WorkoutWhereInput = {
      userId,
      deletedAt: null,
      completedAt: options.since
        ? { not: null, gte: new Date(options.since) }
        : { not: null },
      ...(options.exerciseId
        ? { exercises: { some: { exerciseId: options.exerciseId } } }
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
            sets: { orderBy: { setNumber: 'asc' } },
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
        exercises: w.exercises.map((we) => ({
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
   */
  async exerciseHistory(userId: string, exerciseId: string, limit: number) {
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
        completedAt: { not: null },
        exercises: { some: { exerciseId } },
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
      include: {
        exercises: {
          where: { exerciseId },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    });

    const sessions = workouts.map((w) => {
      const sets = w.exercises
        .flatMap((we) => we.sets)
        .map((s) => this.mapSet(s));

      const completedSets = sets.filter((s) => s.isCompleted);
      const scoredSets = completedSets.length > 0 ? completedSets : sets;

      let bestSet: HistorySet | null = null;
      let bestE1Rm: number | null = null;
      for (const set of scoredSets) {
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

    return { exerciseId: exercise.id, name: exercise.name, sessions };
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
