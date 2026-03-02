import {
  Controller,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import {
  AppleAuthDto,
  GoogleAuthDto,
  RefreshTokenDto,
  LogoutDto,
} from './dto/auth.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  signInWithApple(@Body() dto: AppleAuthDto) {
    return this.authService.signInWithApple(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('google')
  @HttpCode(HttpStatus.OK)
  signInWithGoogle(@Body() dto: GoogleAuthDto) {
    return this.authService.signInWithGoogle(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshAccessToken(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(@CurrentUser('id') userId: string) {
    await this.authService.deleteAccount(userId);
  }
}
