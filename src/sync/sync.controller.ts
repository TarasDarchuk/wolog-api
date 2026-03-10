import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SyncService } from './sync.service.js';
import { SyncPushRequestDto } from './dto/sync-push.dto.js';
import { SyncPullRequestDto } from './dto/sync-pull.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @HttpCode(HttpStatus.OK)
  push(@CurrentUser('id') userId: string, @Body() dto: SyncPushRequestDto) {
    return this.syncService.push(userId, dto);
  }

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  pull(@CurrentUser('id') userId: string, @Body() dto: SyncPullRequestDto) {
    return this.syncService.pull(userId, dto);
  }

  @Post('purge')
  @HttpCode(HttpStatus.OK)
  purge(@CurrentUser('id') userId: string) {
    return this.syncService.purge(userId);
  }

  @Get('status')
  getStatus(@CurrentUser('id') userId: string) {
    return this.syncService.getStatus(userId);
  }
}
