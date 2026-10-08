import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireScopes } from '../common/decorators/require-scopes.decorator.js';
import { ConnectorAuthGuard } from '../common/guards/connector-auth.guard.js';
import { SCOPE_HISTORY_READ } from '../oauth/scopes.js';
import { TrainingProfileService } from './training-profile.service.js';

/**
 * AI-connector read of the onboarding profile (ChatGPT Action; Claude uses
 * the MCP tool get_training_profile). The app reads it via GET /users/me.
 */
@Public()
@UseGuards(ConnectorAuthGuard)
@RequireScopes(SCOPE_HISTORY_READ)
@Controller('training-profile')
export class TrainingProfileController {
  constructor(private readonly trainingProfiles: TrainingProfileService) {}

  @Get()
  async get(@CurrentUser('id') userId: string) {
    return { trainingProfile: await this.trainingProfiles.get(userId) };
  }
}
