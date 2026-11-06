import { IsIn } from 'class-validator';

export class PaywallCohortDto {
  @IsIn(['legacy', 'new'])
  cohort: 'legacy' | 'new';
}
