import { Controller, Get } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('users')
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getUserProfile(userId);
  }
}
