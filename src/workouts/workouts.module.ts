import { Module } from '@nestjs/common';
import { OAuthModule } from '../oauth/oauth.module.js';
import {
  ExerciseHistoryController,
  PersonalRecordsController,
  WorkoutsController,
} from './workouts.controller.js';
import { WorkoutsService } from './workouts.service.js';

@Module({
  imports: [OAuthModule],
  controllers: [
    WorkoutsController,
    ExerciseHistoryController,
    PersonalRecordsController,
  ],
  providers: [WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
