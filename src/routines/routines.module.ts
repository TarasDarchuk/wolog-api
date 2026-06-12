import { Module } from '@nestjs/common';
import { OAuthModule } from '../oauth/oauth.module.js';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { RoutinesController } from './routines.controller.js';
import { RoutinesService } from './routines.service.js';

@Module({
  imports: [OAuthModule, ExercisesModule],
  controllers: [RoutinesController],
  providers: [RoutinesService],
  exports: [RoutinesService],
})
export class RoutinesModule {}
