import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireScopes } from '../common/decorators/require-scopes.decorator.js';
import {
  ConnectorAuthGuard,
  OptionalConnectorAuthGuard,
} from '../common/guards/connector-auth.guard.js';
import { RequiresAccess } from '../subscriptions/requires-access.guard.js';
import { SCOPE_ROUTINES_WRITE } from '../oauth/scopes.js';
import { ExercisesService } from './exercises.service.js';
import { CustomExercisesService } from './custom-exercises.service.js';
import { ListExercisesDto } from './dto/list-exercises.dto.js';
import {
  CreateCustomExerciseDto,
  UpdateCustomExerciseDto,
} from './dto/custom-exercise.dto.js';

@Controller('exercises')
export class ExercisesController {
  constructor(
    private readonly exercisesService: ExercisesService,
    private readonly customExercises: CustomExercisesService,
  ) {}

  // Public catalog; a valid bearer token (app JWT or connector token) merges
  // in the caller's custom exercises.
  @Public()
  @UseGuards(OptionalConnectorAuthGuard)
  @Get()
  async list(
    @Query() dto: ListExercisesDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.exercisesService.list(dto, userId);
  }

  // Custom exercise management for AI connectors. Same scope as routine
  // writes: routine creation already creates custom exercises for unknown names.
  @Public()
  @RequiresAccess()
  @UseGuards(ConnectorAuthGuard)
  @Post()
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCustomExerciseDto,
  ) {
    return this.customExercises.create(userId, dto);
  }

  @Public()
  @RequiresAccess()
  @UseGuards(ConnectorAuthGuard)
  @Patch(':id')
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomExerciseDto,
  ) {
    return this.customExercises.update(userId, id, dto);
  }

  @Public()
  @RequiresAccess()
  @UseGuards(ConnectorAuthGuard)
  @Delete(':id')
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customExercises.remove(userId, id);
  }
}
