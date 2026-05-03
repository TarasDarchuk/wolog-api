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

  @IsIn(['template'])
  kind: string;

  @IsObject()
  template: Record<string, unknown>;

  @IsArray()
  exercises: unknown[];

  @IsOptional()
  @IsString()
  creatorName?: string | null;

  @IsString()
  sourceAppVersion: string;

  @IsBoolean()
  useMetric: boolean;
}
