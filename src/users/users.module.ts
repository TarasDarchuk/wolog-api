import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { TrainingProfileService } from './training-profile.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [TrainingProfileService],
  exports: [TrainingProfileService],
})
export class UsersModule {}
