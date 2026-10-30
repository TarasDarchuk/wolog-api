import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  Equipment,
  ExerciseType,
  MuscleGroup,
} from '../../generated/prisma/client.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A custom exercise owned by the caller (AI connector create). */
export class CreateCustomExerciseDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsIn(Object.values(MuscleGroup))
  muscleGroup: MuscleGroup;

  @IsIn(Object.values(Equipment))
  equipment: Equipment;

  @IsIn(Object.values(ExerciseType))
  exerciseType: ExerciseType;

  /** Body weight counts toward the load (e.g. weighted pull-ups, dips). */
  @IsOptional()
  @IsBoolean()
  includesBodyweight?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(Object.values(MuscleGroup), { each: true })
  secondaryMuscles?: MuscleGroup[];

  /** Default rest between sets in seconds; null clears it on update. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  restDuration?: number | null;
}

/** Partial update: omitted fields stay as they are. */
export class UpdateCustomExerciseDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(Object.values(MuscleGroup))
  muscleGroup?: MuscleGroup;

  @IsOptional()
  @IsIn(Object.values(Equipment))
  equipment?: Equipment;

  @IsOptional()
  @IsIn(Object.values(ExerciseType))
  exerciseType?: ExerciseType;

  @IsOptional()
  @IsBoolean()
  includesBodyweight?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(Object.values(MuscleGroup), { each: true })
  secondaryMuscles?: MuscleGroup[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  restDuration?: number | null;
}
