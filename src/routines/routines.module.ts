import { Module } from '@nestjs/common';
import { OAuthModule } from '../oauth/oauth.module.js';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { FoldersController } from './folders.controller.js';
import { FoldersService } from './folders.service.js';
import { RoutinesController } from './routines.controller.js';
import { RoutinesService } from './routines.service.js';

@Module({
  imports: [OAuthModule, ExercisesModule],
  controllers: [RoutinesController, FoldersController],
  providers: [RoutinesService, FoldersService],
  exports: [RoutinesService, FoldersService],
})
export class RoutinesModule {}
