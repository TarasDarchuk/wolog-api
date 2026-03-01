import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as appleSignin from 'apple-signin-auth';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AppleAuthDto,
  GoogleAuthDto,
  RefreshTokenDto,
  AuthResponseDto,
} from './dto/auth.dto.js';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client | null = null;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    const googleClientId = this.configService.get('GOOGLE_CLIENT_ID');
    if (googleClientId) {
      this.googleClient = new OAuth2Client(googleClientId);
    }
  }

  async signInWithApple(dto: AppleAuthDto): Promise<AuthResponseDto> {
    let applePayload: { sub: string; email?: string };

    try {
      applePayload = await appleSignin.verifyIdToken(dto.identityToken, {
        audience: this.configService.get('APPLE_CLIENT_ID'),
      });
    } catch {
      throw new UnauthorizedException('Invalid Apple identity token');
    }

    const { sub: appleUserId, email } = applePayload;

    let user = await this.prisma.user.findUnique({
      where: { appleUserId },
    });

    if (!user && email) {
      const existingByEmail = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingByEmail) {
        if (existingByEmail.appleUserId) {
          throw new ConflictException(
            'Email already linked to another Apple account',
          );
        }
        user = await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: { appleUserId },
        });
      }
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          appleUserId,
          email: email || null,
          displayName: dto.displayName || null,
        },
      });
    }

    return this.generateTokens(user.id, user.email, dto.deviceName);
  }

  async signInWithGoogle(dto: GoogleAuthDto): Promise<AuthResponseDto> {
    if (!this.googleClient) {
      throw new UnauthorizedException('Google Sign-In is not configured');
    }

    let googlePayload: { sub: string; email?: string; name?: string };

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: this.configService.get('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) {
        throw new Error('No subject in token');
      }
      googlePayload = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
      };
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    const { sub: googleUserId, email, name } = googlePayload;

    let user = await this.prisma.user.findUnique({
      where: { googleUserId },
    });

    if (!user && email) {
      const existingByEmail = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingByEmail) {
        if (existingByEmail.googleUserId) {
          throw new ConflictException(
            'Email already linked to another Google account',
          );
        }
        user = await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: { googleUserId },
        });
      }
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          googleUserId,
          email: email || null,
          displayName: name || null,
        },
      });
    }

    return this.generateTokens(user.id, user.email, dto.deviceName);
  }

  async refreshAccessToken(dto: RefreshTokenDto): Promise<AuthResponseDto> {
    // Look up by tokenFamily (first 8 chars of the token used as lookup key)
    const tokenFamily = dto.refreshToken.substring(0, 8);
    const candidates = await this.prisma.refreshToken.findMany({
      where: {
        tokenFamily,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    let matchedToken: (typeof candidates)[0] | null = null;
    for (const token of candidates) {
      const isMatch = await bcrypt.compare(dto.refreshToken, token.tokenHash);
      if (isMatch) {
        matchedToken = token;
        break;
      }
    }

    if (!matchedToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke old, issue new
    await this.prisma.refreshToken.update({
      where: { id: matchedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(
      matchedToken.user.id,
      matchedToken.user.email,
      matchedToken.deviceName ?? undefined,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenFamily = refreshToken.substring(0, 8);
    const candidates = await this.prisma.refreshToken.findMany({
      where: { tokenFamily, revokedAt: null },
    });

    for (const token of candidates) {
      const isMatch = await bcrypt.compare(refreshToken, token.tokenHash);
      if (isMatch) {
        await this.prisma.refreshToken.update({
          where: { id: token.id },
          data: { revokedAt: new Date() },
        });
        return;
      }
    }
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        appleUserId: true,
        googleUserId: true,
        createdAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return {
      ...user,
      hasApple: !!user.appleUserId,
      hasGoogle: !!user.googleUserId,
      appleUserId: undefined,
      googleUserId: undefined,
    };
  }

  private async generateTokens(
    userId: string,
    email: string | null,
    deviceName?: string,
  ): Promise<AuthResponseDto> {
    const accessToken = this.jwtService.sign(
      { sub: userId, email },
      { expiresIn: this.configService.get('JWT_ACCESS_EXPIRY', '15m') },
    );

    const rawRefreshToken = uuidv4();
    const tokenFamily = rawRefreshToken.substring(0, 8);
    const tokenHash = await bcrypt.hash(rawRefreshToken, 10);
    const refreshExpiryDays = this.configService.get<number>(
      'JWT_REFRESH_EXPIRY_DAYS',
      30,
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + refreshExpiryDays);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        tokenFamily,
        deviceName: deviceName || null,
        expiresAt,
      },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }
}
