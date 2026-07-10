import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireScopes } from '../common/decorators/require-scopes.decorator.js';
import { ConnectorAuthGuard } from '../common/guards/connector-auth.guard.js';
import { SCOPE_ROUTINES_READ, SCOPE_ROUTINES_WRITE } from '../oauth/scopes.js';
import { FoldersService } from './folders.service.js';

export class FolderNameDto {
  @IsString()
  @MaxLength(120)
  name: string;
}

/**
 * AI-connector routine folders REST. Folders group routines (a training
 * program = a folder of routines). Same auth model as RoutinesController.
 */
@Public()
@UseGuards(ConnectorAuthGuard)
@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  @RequireScopes(SCOPE_ROUTINES_READ)
  async list(@CurrentUser('id') userId: string) {
    return this.folders.list(userId);
  }

  @Post()
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async create(@CurrentUser('id') userId: string, @Body() dto: FolderNameDto) {
    return this.folders.createOrGet(userId, dto.name);
  }

  @Patch(':id')
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async rename(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FolderNameDto,
  ) {
    return this.folders.rename(userId, id, dto.name);
  }

  @Delete(':id')
  @RequireScopes(SCOPE_ROUTINES_WRITE)
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.folders.remove(userId, id);
  }
}
