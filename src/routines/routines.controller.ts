import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireScopes } from '../common/decorators/require-scopes.decorator.js';
import { ConnectorAuthGuard } from '../common/guards/connector-auth.guard.js';
import { SCOPE_ROUTINES_READ, SCOPE_ROUTINES_WRITE } from '../oauth/scopes.js';
import { RoutinesService } from './routines.service.js';
import {
  CreateProgramDto,
  CreateRoutineDto,
  UpdateRoutineDto,
} from './dto/routine.dto.js';

/**
 * AI-connector routines REST (§6). Authenticated by connector OAuth tokens
 * (scoped) or first-party app JWTs. @Public only bypasses the global app-JWT
 * guard — ConnectorAuthGuard enforces auth here.
 */
@Public()
@UseGuards(ConnectorAuthGuard)
@Controller('routines')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  @RequireScopes(SCOPE_ROUTINES_READ)
  async list(@CurrentUser('id') userId: string) {
    return this.routines.list(userId);
  }

  @Get(':id')
  @RequireScopes(SCOPE_ROUTINES_READ)
  async getOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.routines.getOne(userId, id);
  }

  @Post()
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRoutineDto,
  ) {
    return this.routines.create(userId, dto);
  }

  @Post('programs')
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async createProgram(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProgramDto,
  ) {
    return this.routines.createProgram(userId, dto);
  }

  @Patch(':id')
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoutineDto,
  ) {
    return this.routines.update(userId, id, dto);
  }
}
