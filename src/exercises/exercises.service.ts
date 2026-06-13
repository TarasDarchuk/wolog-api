import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListExercisesDto } from './dto/list-exercises.dto.js';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists the exercise catalog: the seeded library, plus the caller's custom
   * exercises when a user is known (AI connectors need both for name
   * discovery). Anonymous callers see the library only.
   */
  async list(dto: ListExercisesDto, userId?: string) {
    const take = dto.limit!;
    const skip = dto.offset!;

    const where: Prisma.ExerciseWhereInput = {
      deletedAt: null,
      ...(userId
        ? { OR: [{ isCustom: false }, { userId }] }
        : { isCustom: false }),
      ...(dto.query
        ? { name: { contains: dto.query.trim(), mode: 'insensitive' } }
        : {}),
    };

    const [exercises, total] = await Promise.all([
      this.prisma.exercise.findMany({
        where,
        orderBy: { name: 'asc' },
        take,
        skip,
      }),
      this.prisma.exercise.count({ where }),
    ]);

    return { exercises, total, limit: take, offset: skip };
  }
}
