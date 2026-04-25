import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateShareDto } from './dto/create-share.dto.js';
import {
  ShareRateLimitedException,
  SharesService,
} from './shares.service.js';

@Controller('shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateShareDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return await this.sharesService.create(userId, dto);
    } catch (err) {
      if (err instanceof ShareRateLimitedException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      throw err;
    }
  }

  @Public()
  @Get(':id')
  fetch(@Param('id') id: string) {
    return this.sharesService.fetch(id);
  }
}
