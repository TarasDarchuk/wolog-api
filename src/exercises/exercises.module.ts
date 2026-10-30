import { Module } from '@nestjs/common';
import { OAuthModule } from '../oauth/oauth.module.js';
import { ExercisesController } from './exercises.controller.js';
import { ExercisesService } from './exercises.service.js';
import { ExerciseResolverService } from './exercise-resolver.service.js';
import { CustomExercisesService } from './custom-exercises.service.js';

@Module({
  imports: [OAuthModule],
  controllers: [ExercisesController],
  providers: [
    ExercisesService,
    ExerciseResolverService,
    CustomExercisesService,
  ],
  exports: [ExercisesService, ExerciseResolverService, CustomExercisesService],
})
export class ExercisesModule {}
