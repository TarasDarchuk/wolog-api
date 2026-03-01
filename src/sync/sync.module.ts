import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { WorkoutSyncService } from './services/workout-sync.service.js';
import { ExerciseSyncService } from './services/exercise-sync.service.js';
import { TemplateSyncService } from './services/template-sync.service.js';
import { MeasurementSyncService } from './services/measurement-sync.service.js';

@Module({
  controllers: [SyncController],
  providers: [
    SyncService,
    WorkoutSyncService,
    ExerciseSyncService,
    TemplateSyncService,
    MeasurementSyncService,
  ],
})
export class SyncModule {}
