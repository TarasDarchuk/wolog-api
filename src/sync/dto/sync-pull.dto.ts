import { IsOptional, IsDateString, IsNumber, Min, Max } from 'class-validator';

export class SyncPullRequestDto {
  @IsOptional()
  since?: {
    workouts?: string;
    exercises?: string;
    templates?: string;
    measurements?: string;
  };

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
