import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller.js';

@Module({
  controllers: [ExercisesController],
})
export class ExercisesModule {}
