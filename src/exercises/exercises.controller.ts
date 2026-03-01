import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { ExercisesService } from './exercises.service.js';
import { ListExercisesDto } from './dto/list-exercises.dto.js';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Public()
  @Get()
  async list(@Query() dto: ListExercisesDto) {
    return this.exercisesService.list(dto);
  }
}
