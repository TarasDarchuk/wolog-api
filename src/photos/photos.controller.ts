import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PhotoUploadUrlDto } from './dto/upload-url.dto.js';
import { PhotosService } from './photos.service.js';

// A malformed id can't name an existing photo — answer 404 like any unknown id.
const PhotoId = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.NOT_FOUND,
});

@Controller('photos')
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  @Post(':id/upload-url')
  @HttpCode(HttpStatus.OK)
  uploadUrl(
    @CurrentUser('id') userId: string,
    @Param('id', PhotoId) id: string,
    @Body() dto: PhotoUploadUrlDto,
  ) {
    return this.photosService.createUploadUrl(userId, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  complete(
    @CurrentUser('id') userId: string,
    @Param('id', PhotoId) id: string,
  ) {
    return this.photosService.complete(userId, id);
  }

  @Get(':id/download-url')
  downloadUrl(
    @CurrentUser('id') userId: string,
    @Param('id', PhotoId) id: string,
  ) {
    return this.photosService.createDownloadUrl(userId, id);
  }
}
