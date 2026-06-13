import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// AI-facing routine schema (§8 of the connector spec). Weights kg, durations
// seconds, distances meters. Each item is exactly one of exercise | superset.

export class RoutineSetDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  setNumber?: number; // informational — recomputed from array order

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetWeight?: number; // kg

  @IsOptional()
  @IsInt()
  @Min(0)
  targetReps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDuration?: number; // seconds

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDistance?: number; // meters
}

export class RoutineExerciseDto {
  @IsOptional()
  @IsUUID()
  id?: string; // TemplateExercise id — preserve on update

  @IsOptional()
  @IsUUID()
  exerciseId?: string; // catalog/custom exercise UUID

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string; // resolved server-side when exerciseId is absent

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  targetSets?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  targetReps?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  restTimerSeconds?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutineSetDto)
  sets?: RoutineSetDto[];
}

export class RoutineSupersetDto {
  @IsOptional()
  @IsUUID()
  id?: string; // TemplateSuperset id — preserve on update

  @IsOptional()
  @IsInt()
  @Min(0)
  supersetColorIndex?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutineExerciseDto)
  exercises: RoutineExerciseDto[];
}

export class RoutineItemDto {
  @IsOptional()
  @IsUUID()
  id?: string; // TemplateItem id

  @IsOptional()
  @ValidateNested()
  @Type(() => RoutineExerciseDto)
  exercise?: RoutineExerciseDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RoutineSupersetDto)
  superset?: RoutineSupersetDto;
}

export class CreateRoutineDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutineItemDto)
  items: RoutineItemDto[];
}

export class UpdateRoutineDto {
  // The AI is told to send back the structure it read from GET — these
  // read-only echoes are accepted and ignored (the path param is the truth).
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsDateString()
  createdAt?: string;

  @IsOptional()
  @IsDateString()
  updatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutineItemDto)
  items?: RoutineItemDto[];

  /**
   * Optimistic concurrency: the routine's updatedAt as last read by the
   * caller. If the routine changed since, the server returns 409 Conflict
   * with the current routine so the caller can re-read and retry.
   */
  @IsOptional()
  @IsDateString()
  baseUpdatedAt?: string;
}

export class ListWorkoutsDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ExerciseHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
