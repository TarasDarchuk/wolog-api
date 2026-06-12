import { Module } from '@nestjs/common';
import { OAuthModule } from '../oauth/oauth.module.js';
import { ExercisesModule } from '../exercises/exercises.module.js';
import { RoutinesModule } from '../routines/routines.module.js';
import { WorkoutsModule } from '../workouts/workouts.module.js';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [OAuthModule, ExercisesModule, RoutinesModule, WorkoutsModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
