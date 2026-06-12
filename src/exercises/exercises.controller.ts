import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { OptionalConnectorAuthGuard } from '../common/guards/connector-auth.guard.js';
import { ExercisesService } from './exercises.service.js';
import { ListExercisesDto } from './dto/list-exercises.dto.js';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  // Public catalog; a valid bearer token (app JWT or connector token) merges
  // in the caller's custom exercises.
  @Public()
  @UseGuards(OptionalConnectorAuthGuard)
  @Get()
  async list(
    @Query() dto: ListExercisesDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.exercisesService.list(dto, userId);
  }
}
