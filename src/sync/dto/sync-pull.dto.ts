import {
  IsOptional,
  IsDateString,
  IsNumber,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SyncPullSinceDto {
  @IsOptional()
  @IsDateString()
  workouts?: string;

  @IsOptional()
  @IsDateString()
  exercises?: string;

  @IsOptional()
  @IsDateString()
  templates?: string;

  @IsOptional()
  @IsDateString()
  measurements?: string;
}

export class SyncPullRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SyncPullSinceDto)
  since?: SyncPullSinceDto;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SyncStatusResponseDto {
  workouts: string | null;
  exercises: string | null;
  templates: string | null;
  measurements: string | null;
}
