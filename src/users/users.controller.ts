import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UpdateProDto } from './dto/update-pro.dto.js';
import { TrainingProfileDto } from './dto/training-profile.dto.js';
import { TrainingProfileService } from './training-profile.service.js';
import { PaywallCohortDto } from '../subscriptions/dto/paywall-cohort.dto.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly trainingProfiles: TrainingProfileService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Get('me')
  getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getUserProfile(userId);
  }

  // App-only (first-party JWT — connector/MCP tokens are rejected by the global
  // guard). The app reports its current subscription state here; for
  // hard-paywall accounts the Adapty webhook wins (SubscriptionsService).
  @Put('me/pro')
  setPro(@CurrentUser('id') userId: string, @Body() dto: UpdateProDto) {
    return this.subscriptions.setProFromClient(userId, dto.isPro);
  }

  // Hard-paywall cohort, reported by the app after sign-in. One-way: a legacy
  // account never becomes new (409); see SubscriptionsService.setCohort.
  @Put('me/paywall-cohort')
  setPaywallCohort(
    @CurrentUser('id') userId: string,
    @Body() dto: PaywallCohortDto,
  ) {
    return this.subscriptions.setCohort(userId, dto.cohort);
  }

  // Onboarding answers. Full replace — omitted fields are cleared.
  @Put('me/training-profile')
  setTrainingProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: TrainingProfileDto,
  ) {
    return this.trainingProfiles.replace(userId, dto);
  }
}
