import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller.js';
import { ExercisesService } from './exercises.service.js';

@Module({
  controllers: [ExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}
