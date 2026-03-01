import {
  IsArray,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsUUID,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Exercise Set DTO ───────────────────────────────────────────────────────

export class ExerciseSetPushDto {
  @IsUUID()
  id: string;

  @IsNumber()
  setNumber: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  reps?: number;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsNumber()
  distance?: number;

  @IsBoolean()
  isCompleted: boolean;

  @IsString()
  type: string;

  @IsOptional()
  prRecords?: any;
}

// ─── Workout Exercise DTO ───────────────────────────────────────────────────

export class WorkoutExercisePushDto {
  @IsUUID()
  id: string;

  @IsUUID()
  exerciseId: string;

  @IsNumber()
  sortOrder: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExerciseSetPushDto)
  sets: ExerciseSetPushDto[];
}

// ─── Workout Superset DTO ───────────────────────────────────────────────────

export class WorkoutSupersetPushDto {
  @IsUUID()
  id: string;

  @IsNumber()
  supersetColorIndex: number;

  @IsArray()
  @IsString({ each: true })
  exerciseIds: string[];
}

// ─── Workout DTO ────────────────────────────────────────────────────────────

export class WorkoutPushDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsDateString()
  startedAt: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  activeCalories?: number;

  @IsDateString()
  updatedAt: string;

  @IsOptional()
  @IsDateString()
  deletedAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutExercisePushDto)
  exercises: WorkoutExercisePushDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutSupersetPushDto)
  supersets: WorkoutSupersetPushDto[];
}

// ─── Custom Exercise DTO ────────────────────────────────────────────────────

export class ExercisePushDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsString()
  muscleGroup: string;

  @IsString()
  equipment: string;

  @IsString()
  exerciseType: string;

  @IsOptional()
  @IsNumber()
  restDuration?: number;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsArray()
  @IsString({ each: true })
  primaryMuscles: string[];

  @IsArray()
  @IsString({ each: true })
  secondaryMuscles: string[];

  @IsDateString()
  updatedAt: string;

  @IsOptional()
  @IsDateString()
  deletedAt?: string;
}

// ─── Template DTOs ──────────────────────────────────────────────────────────

export class TemplateSetPushDto {
  @IsUUID()
  id: string;

  @IsNumber()
  setNumber: number;

  @IsOptional()
  @IsNumber()
  targetWeight?: number;

  @IsOptional()
  @IsNumber()
  targetReps?: number;

  @IsOptional()
  @IsNumber()
  targetDuration?: number;

  @IsOptional()
  @IsNumber()
  targetDistance?: number;
}

export class TemplateExercisePushDto {
  @IsUUID()
  id: string;

  @IsUUID()
  exerciseId: string;

  @IsNumber()
  sortOrder: number;

  @IsOptional()
  @IsNumber()
  targetSets?: number;

  @IsOptional()
  @IsNumber()
  targetReps?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  restTimerSeconds?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSetPushDto)
  sets: TemplateSetPushDto[];
}

export class TemplateSupersetPushDto {
  @IsUUID()
  id: string;

  @IsNumber()
  supersetColorIndex: number;

  @IsArray()
  @IsString({ each: true })
  exerciseIds: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateExercisePushDto)
  exercises: TemplateExercisePushDto[];
}

export class TemplateItemPushDto {
  @IsUUID()
  id: string;

  @IsNumber()
  sortOrder: number;

  @IsOptional()
  @IsUUID()
  supersetId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateExercisePushDto)
  exercise?: TemplateExercisePushDto;
}

export class TemplatePushDto {
  @IsUUID()
  id: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsNumber()
  sortOrder: number;

  @IsDateString()
  createdAt: string;

  @IsDateString()
  updatedAt: string;

  @IsOptional()
  @IsDateString()
  deletedAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemPushDto)
  items: TemplateItemPushDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSupersetPushDto)
  supersets: TemplateSupersetPushDto[];
}

// ─── Body Measurement DTO ───────────────────────────────────────────────────

export class MeasurementPushDto {
  @IsUUID()
  id: string;

  @IsDateString()
  date: string;

  @IsString()
  type: string;

  @IsNumber()
  value: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsDateString()
  updatedAt: string;

  @IsOptional()
  @IsDateString()
  deletedAt?: string;
}

// ─── Top-level Push Request ─────────────────────────────────────────────────

export class SyncPushRequestDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkoutPushDto)
  workouts?: WorkoutPushDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExercisePushDto)
  exercises?: ExercisePushDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplatePushDto)
  templates?: TemplatePushDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementPushDto)
  measurements?: MeasurementPushDto[];
}
