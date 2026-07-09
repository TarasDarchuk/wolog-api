import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateShareDto {
  @IsInt()
  payloadVersion: number;

  @IsIn(['template', 'program'])
  kind: string;

  // Required for kind "template", absent for kind "program" (enforced in the service).
  @IsOptional()
  @IsObject()
  template?: Record<string, unknown> | null;

  @IsArray()
  exercises: unknown[];

  // Required for kind "program" — self-contained program payload with its own exercises.
  @IsOptional()
  @IsObject()
  program?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  creatorName?: string | null;

  @IsString()
  sourceAppVersion: string;

  @IsBoolean()
  useMetric: boolean;
}
