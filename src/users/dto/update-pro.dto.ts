import { IsBoolean } from 'class-validator';

export class UpdateProDto {
  @IsBoolean()
  isPro: boolean;
}
