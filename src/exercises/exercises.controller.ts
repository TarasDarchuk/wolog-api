import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../common/decorators/public.decorator.js';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const take = Math.min(parseInt(limit || '50', 10), 200);
    const skip = parseInt(offset || '0', 10);

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
