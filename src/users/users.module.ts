import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
})
export class UsersModule {}
