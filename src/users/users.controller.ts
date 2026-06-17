import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UpdateProDto } from './dto/update-pro.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getUserProfile(userId);
  }

  // App-only (first-party JWT — connector/MCP tokens are rejected by the global
  // guard). The app reports its current subscription state here so the backend
  // Pro flag stays in lockstep with the entitlement.
  @Put('me/pro')
  setPro(@CurrentUser('id') userId: string, @Body() dto: UpdateProDto) {
    return this.authService.setProStatus(userId, dto.isPro);
  }
}
