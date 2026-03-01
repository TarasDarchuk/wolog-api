import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListExercisesDto } from './dto/list-exercises.dto.js';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListExercisesDto) {
    const take = dto.limit!;
    const skip = dto.offset!;

    const [exercises, total] = await Promise.all([
      this.prisma.exercise.findMany({
        where: { isCustom: false, deletedAt: null },
        orderBy: { name: 'asc' },
        take,
        skip,
      }),
      this.prisma.exercise.count({
        where: { isCustom: false, deletedAt: null },
      }),
    ]);

    return { exercises, total, limit: take, offset: skip };
  }
}
