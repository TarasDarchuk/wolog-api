import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import {
  ACCESS_TOKEN_PREFIX,
  OAuthTokenService,
} from '../../oauth/oauth-token.service.js';
import { ALL_SCOPES } from '../../oauth/scopes.js';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator.js';

export interface ConnectorRequest extends Request {
  user?: { id: string; email?: string };
  authScopes?: string[];
  oauthClientId?: string | null;
}

function extractBearer(req: Request): string | undefined {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return undefined;
  if (!header.toLowerCase().startsWith('bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

/**
 * Authenticates AI-connector endpoints. Accepts either:
 *  - an opaque connector access token (wlga_…) issued by the OAuth provider,
 *    carrying explicit scopes, or
 *  - a first-party app JWT, which implicitly carries all scopes (the app
 *    user has full rights over their own data).
 *
 * Apply together with @Public() so the global JwtAuthGuard steps aside, and
 * declare scopes with @RequireScopes(...).
 */
@Injectable()
export class ConnectorAuthGuard implements CanActivate {
  constructor(
    protected readonly reflector: Reflector,
    protected readonly tokens: OAuthTokenService,
    protected readonly jwtService: JwtService,
    protected readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ConnectorRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const authenticated = await this.tryAuthenticate(req);
    if (!authenticated) {
      this.setChallengeHeader(res);
      throw new UnauthorizedException('Missing or invalid bearer token');
    }

    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const granted = req.authScopes ?? [];
    const missing = required.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Insufficient scope — requires: ${missing.join(', ')}`,
      );
    }
    return true;
  }

  protected async tryAuthenticate(req: ConnectorRequest): Promise<boolean> {
    const token = extractBearer(req);
    if (!token) return false;

    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const principal = await this.tokens.validateAccessToken(token);
      if (!principal) return false;
      req.user = { id: principal.userId };
      req.authScopes = principal.scopes;
      req.oauthClientId = principal.clientId;
      return true;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; email?: string }>(
        token,
        { secret: this.config.get('JWT_SECRET') },
      );
      req.user = { id: payload.sub, email: payload.email };
      req.authScopes = [...ALL_SCOPES];
      req.oauthClientId = null;
      return true;
    } catch {
      return false;
    }
  }

  protected setChallengeHeader(res: Response): void {
    const base = (
      this.config.get<string>('PUBLIC_BASE_URL') || 'http://localhost:3000'
    ).replace(/\/$/, '');
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    );
  }
}

/**
 * Like ConnectorAuthGuard, but never rejects — used on public endpoints
 * (e.g. the exercise catalog) that include the caller's private data only
 * when a valid token happens to be present.
 */
@Injectable()
export class OptionalConnectorAuthGuard extends ConnectorAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ConnectorRequest>();
    await this.tryAuthenticate(req);
    return true;
  }
}
