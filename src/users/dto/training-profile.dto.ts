import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TRAINING_GOALS = ['gainMuscle', 'getStronger', 'loseWeight'];
export const TRAINING_LEVELS = ['beginner', 'intermediate', 'advanced'];
export const TRAINING_EQUIPMENT = ['fullGym', 'dumbbells', 'bodyweight'];
export const MIN_DAYS_PER_WEEK = 2;
export const MAX_DAYS_PER_WEEK = 6;

/**
 * Full replace: every field is optional and an omitted field is stored as
 * null (`goals` as []). `@IsOptional` also lets explicit nulls through.
 */
export class TrainingProfileDto {
  /** Ordered, primary goal first. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(TRAINING_GOALS, { each: true })
  goals?: string[] | null;

  @IsOptional()
  @IsIn(TRAINING_LEVELS)
  level?: string | null;

  @IsOptional()
  @IsIn(TRAINING_EQUIPMENT)
  equipment?: string | null;

  @IsOptional()
  @IsInt()
  @Min(MIN_DAYS_PER_WEEK)
  @Max(MAX_DAYS_PER_WEEK)
  daysPerWeek?: number | null;

  @IsOptional()
  @IsBoolean()
  useMetric?: boolean | null;

  /** Bundled catalog id of the starter program the user installed. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  starterProgramId?: string | null;

  @IsOptional()
  @IsDateString()
  onboardingCompletedAt?: string | null;
}
