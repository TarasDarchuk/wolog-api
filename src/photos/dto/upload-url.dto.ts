import { IsIn, IsInt, Max, Min } from 'class-validator';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export class PhotoUploadUrlDto {
  @IsIn(['image/jpeg'])
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(MAX_PHOTO_BYTES)
  byteSize: number;
}
