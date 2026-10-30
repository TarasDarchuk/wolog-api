import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { v4 as uuidv4 } from 'uuid';
import { Exercise } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateCustomExerciseDto,
  UpdateCustomExerciseDto,
} from './dto/custom-exercise.dto.js';

/**
 * The caller's custom exercises for the AI connector. Library exercises
 * (userId null) are read-only. Every write bumps updatedAt (Prisma
 * @updatedAt), so the change reaches the phone on its next exercise pull.
 */
@Injectable()
export class CustomExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a custom exercise. A same-named custom exercise is returned
   * instead of duplicated; a same-named library exercise is refused, so the
   * library entry (with its history and stats) keeps being used.
   */
  async create(userId: string, dto: CreateCustomExerciseDto) {
    const sameName = await this.prisma.exercise.findMany({
      where: {
        deletedAt: null,
        name: { equals: dto.name, mode: 'insensitive' },
        OR: [{ isCustom: false }, { userId }],
      },
    });
    const own = sameName.find((e) => e.userId === userId);
    if (own) return { exercise: view(own), created: false };
    const library = sameName.find((e) => !e.isCustom);
    if (library) {
      throw new ConflictException({
        message: `"${library.name}" is a library exercise — use it instead of creating a custom copy`,
        exercise: view(library),
      });
    }

    const exercise = await this.prisma.exercise.create({
      data: {
        id: uuidv4(),
        userId,
        name: dto.name,
        muscleGroup: dto.muscleGroup,
        equipment: dto.equipment,
        exerciseType: dto.exerciseType,
        isCustom: true,
        includesBodyweight: dto.includesBodyweight ?? false,
        restDuration: dto.restDuration ?? null,
        primaryMuscles: primaryMuscles(dto.muscleGroup),
        secondaryMuscles: dto.secondaryMuscles ?? [],
      },
    });
    return { exercise: view(exercise), created: true };
  }

  async update(userId: string, id: string, dto: UpdateCustomExerciseDto) {
    await this.requireOwn(userId, id);
    const exercise = await this.prisma.exercise.update({
      where: { id },
      data: {
        name: dto.name,
        muscleGroup: dto.muscleGroup,
        equipment: dto.equipment,
        exerciseType: dto.exerciseType,
        includesBodyweight: dto.includesBodyweight,
        secondaryMuscles: dto.secondaryMuscles,
        restDuration: dto.restDuration,
        ...(dto.muscleGroup
          ? { primaryMuscles: primaryMuscles(dto.muscleGroup) }
          : {}),
      },
    });
    return { exercise: view(exercise) };
  }

  /**
   * Soft-deletes an unused custom exercise. Exercises referenced by any
   * workout or live routine are refused: app versions before 1.4.2 purge a
   * deleted exercise from the device even while workouts still point at it
   * (and crash), and the server purge cascades into those workouts.
   */
  async remove(userId: string, id: string) {
    await this.requireOwn(userId, id);

    const [workoutCount, routines] = await Promise.all([
      this.prisma.workoutExercise.count({ where: { exerciseId: id } }),
      this.prisma.workoutTemplate.findMany({
        where: {
          userId,
          deletedAt: null,
          items: { some: { exercise: { exerciseId: id } } },
        },
        select: { id: true, name: true },
      }),
    ]);
    if (workoutCount > 0 || routines.length > 0) {
      throw new ConflictException({
        message:
          workoutCount > 0
            ? 'This exercise has logged workouts and cannot be deleted — its history would be lost. Rename it instead if needed.'
            : 'This exercise is used in routines. Remove it from these routines first, then delete it.',
        workoutCount,
        routines,
      });
    }

    await this.prisma.exercise.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  private async requireOwn(userId: string, id: string): Promise<Exercise> {
    if (!isUUID(id)) throw new NotFoundException('Exercise not found');
    const exercise = await this.prisma.exercise.findUnique({ where: { id } });
    if (!exercise || exercise.deletedAt) {
      throw new NotFoundException('Exercise not found');
    }
    if (!exercise.isCustom && !exercise.userId) {
      throw new ForbiddenException(
        'Library exercises are read-only — only custom exercises can be changed',
      );
    }
    if (exercise.userId !== userId) {
      throw new NotFoundException('Exercise not found');
    }
    return exercise;
  }
}

function primaryMuscles(muscleGroup: string): string[] {
  return muscleGroup === 'other' ? [] : [muscleGroup];
}

function view(e: Exercise) {
  return {
    id: e.id,
    name: e.name,
    muscleGroup: e.muscleGroup,
    equipment: e.equipment,
    exerciseType: e.exerciseType,
    isCustom: e.isCustom,
    includesBodyweight: e.includesBodyweight,
    secondaryMuscles: e.secondaryMuscles,
    restDuration: e.restDuration,
    updatedAt: e.updatedAt.toISOString(),
  };
}
