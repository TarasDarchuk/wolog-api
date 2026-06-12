import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export const ACCESS_TOKEN_PREFIX = 'wlga_';
export const REFRESH_TOKEN_PREFIX = 'wlgr_';

export interface ConnectorPrincipal {
  userId: string;
  clientId: string;
  scopes: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  scopes: string[];
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(prefix: string): string {
  return prefix + randomBytes(32).toString('base64url');
}

/**
 * Issues and validates the opaque bearer tokens used by AI connectors
 * (Claude MCP / ChatGPT Action). Deliberately separate from the app's own
 * JWT access tokens: connector tokens are scoped, stored hashed, and
 * individually revocable.
 */
@Injectable()
export class OAuthTokenService {
  private readonly logger = new Logger(OAuthTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private accessTtlSeconds(): number {
    const minutes = Number(
      this.config.get('CONNECTOR_ACCESS_TTL_MINUTES', '60'),
    );
    return Math.max(60, Math.floor(minutes * 60));
  }

  private refreshTtlMs(): number {
    const days = Number(this.config.get('CONNECTOR_REFRESH_TTL_DAYS', '30'));
    return Math.max(1, days) * 24 * 60 * 60 * 1000;
  }

  async issueTokenPair(
    userId: string,
    clientId: string,
    scopes: string[],
  ): Promise<TokenPair> {
    const accessToken = randomToken(ACCESS_TOKEN_PREFIX);
    const refreshToken = randomToken(REFRESH_TOKEN_PREFIX);
    const expiresIn = this.accessTtlSeconds();

    await this.prisma.oAuthToken.create({
      data: {
        userId,
        clientId,
        scopes,
        accessTokenHash: sha256(accessToken),
        refreshTokenHash: sha256(refreshToken),
        accessExpiresAt: new Date(Date.now() + expiresIn * 1000),
        refreshExpiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    });

    return { accessToken, refreshToken, expiresIn, scopes };
  }

  async validateAccessToken(
    rawToken: string,
  ): Promise<ConnectorPrincipal | null> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { accessTokenHash: sha256(rawToken) },
    });
    if (!token) return null;
    if (token.revokedAt) return null;
    if (token.accessExpiresAt <= new Date()) return null;
    return {
      userId: token.userId,
      clientId: token.clientId,
      scopes: token.scopes,
    };
  }

  /**
   * Rotates a refresh token: revokes the matched pair and issues a new one.
   * If a revoked refresh token is replayed (theft signal), every token for
   * that user+client is revoked.
   */
  async rotateRefreshToken(
    rawRefreshToken: string,
    clientId: string,
  ): Promise<TokenPair | null> {
    const token = await this.prisma.oAuthToken.findUnique({
      where: { refreshTokenHash: sha256(rawRefreshToken) },
    });
    if (!token || token.clientId !== clientId) return null;

    if (token.revokedAt) {
      this.logger.warn(
        `Revoked refresh token replayed for user ${token.userId}, client ${clientId} — revoking all grants`,
      );
      await this.revokeAllForUserClient(token.userId, clientId);
      return null;
    }

    if (token.refreshExpiresAt <= new Date()) return null;

    await this.prisma.oAuthToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(token.userId, token.clientId, token.scopes);
  }

  /** RFC 7009: revoke by access or refresh token. Unknown tokens are a no-op. */
  async revokeToken(rawToken: string): Promise<void> {
    const hash = sha256(rawToken);
    await this.prisma.oAuthToken.updateMany({
      where: {
        OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }],
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUserClient(
    userId: string,
    clientId: string,
  ): Promise<void> {
    await this.prisma.oAuthToken.updateMany({
      where: { userId, clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
