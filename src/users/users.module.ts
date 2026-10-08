import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { TrainingProfileController } from './training-profile.controller.js';
import { TrainingProfileService } from './training-profile.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { OAuthModule } from '../oauth/oauth.module.js';

@Module({
  imports: [AuthModule, OAuthModule],
  controllers: [UsersController, TrainingProfileController],
  providers: [TrainingProfileService],
  exports: [TrainingProfileService],
})
export class UsersModule {}
