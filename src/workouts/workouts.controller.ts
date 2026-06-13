import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireScopes } from '../common/decorators/require-scopes.decorator.js';
import { ConnectorAuthGuard } from '../common/guards/connector-auth.guard.js';
import { SCOPE_HISTORY_READ } from '../oauth/scopes.js';
import { WorkoutsService } from './workouts.service.js';
import {
  ExerciseHistoryDto,
  ListWorkoutsDto,
} from '../routines/dto/routine.dto.js';

@Public()
@UseGuards(ConnectorAuthGuard)
@RequireScopes(SCOPE_HISTORY_READ)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Get()
  async list(@CurrentUser('id') userId: string, @Query() dto: ListWorkoutsDto) {
    return this.workouts.listWorkouts(userId, {
      since: dto.since,
      exerciseId: dto.exerciseId,
      limit: dto.limit!,
    });
  }
}

@Public()
@UseGuards(ConnectorAuthGuard)
@RequireScopes(SCOPE_HISTORY_READ)
@Controller('exercises')
export class ExerciseHistoryController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Get(':id/history')
  async history(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) exerciseId: string,
    @Query() dto: ExerciseHistoryDto,
  ) {
    return this.workouts.exerciseHistory(userId, exerciseId, dto.limit!);
  }
}
