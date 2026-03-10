import {
  IsArray,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsUUID,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ExerciseType,
  MuscleGroup,
  Equipment,
  SetType,
  MeasurementType,
} from '../../generated/prisma/client.js';

// ─── Heart Rate Sample DTO ──────────────────────────────────────────────────

export class HeartRateSampleDto {
  @IsDateString()
  timestamp: string;

  @IsNumber()
  bpm: number;
}

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

  @IsIn(Object.values(SetType))
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

  @IsOptional()
  @IsUUID()
  supersetId?: string;

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
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  activeCalories?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HeartRateSampleDto)
  heartRateSamples?: HeartRateSampleDto[];

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

  @IsIn(Object.values(MuscleGroup))
  muscleGroup: string;

  @IsIn(Object.values(Equipment))
  equipment: string;

  @IsIn(Object.values(ExerciseType))
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

  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;

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
  supersetId?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateExercisePushDto)
  exercise?: TemplateExercisePushDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateSupersetPushDto)
  superset?: TemplateSupersetPushDto | null;
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSupersetPushDto)
  supersets?: TemplateSupersetPushDto[];
}

// ─── Body Measurement DTO ───────────────────────────────────────────────────

export class MeasurementPushDto {
  @IsUUID()
  id: string;

  @IsDateString()
  date: string;

  @IsIn(Object.values(MeasurementType))
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
