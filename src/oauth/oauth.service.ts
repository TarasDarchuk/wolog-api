import {
  BadRequestException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { OAuthClient } from '../generated/prisma/client.js';
import { OAuthClientService } from './oauth-client.service.js';
import {
  OAuthTokenService,
  randomToken,
  sha256,
} from './oauth-token.service.js';
import { ALL_SCOPES, parseScopes } from './scopes.js';

const AUTH_CODE_PREFIX = 'wlgc_';
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

export interface AuthorizeParams {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export interface ValidatedAuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  scopes: string[];
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

/** Thrown when the error must be shown to the user (bad client/redirect). */
export class AuthorizePageError extends Error {}

/** Thrown when the error can safely be returned to the client's redirect URI. */
export class AuthorizeRedirectError extends Error {
  constructor(
    public readonly redirectUri: string,
    public readonly errorCode: string,
    public readonly description: string,
    public readonly state?: string,
  ) {
    super(description);
  }

  toRedirectUrl(): string {
    const url = new URL(this.redirectUri);
    url.searchParams.set('error', this.errorCode);
    url.searchParams.set('error_description', this.description);
    if (this.state) url.searchParams.set('state', this.state);
    return url.toString();
  }
}

class TokenEndpointError extends HttpException {
  constructor(error: string, description: string, status = 400) {
    super({ error, error_description: description }, status);
  }
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly clients: OAuthClientService,
    private readonly tokens: OAuthTokenService,
    private readonly authService: AuthService,
  ) {}

  get publicBaseUrl(): string {
    return (
      this.config.get<string>('PUBLIC_BASE_URL') || 'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  get devLoginEnabled(): boolean {
    return (
      this.config.get('OAUTH_DEV_LOGIN') === 'true' &&
      this.config.get('NODE_ENV') !== 'production'
    );
  }

  // ─── Authorize ────────────────────────────────────────────────────────────

  async validateAuthorizeRequest(
    params: AuthorizeParams,
  ): Promise<ValidatedAuthorizeRequest> {
    const client = await this.clients.getClient(params.client_id || '');
    if (!client) {
      throw new AuthorizePageError('Unknown OAuth client (client_id)');
    }

    const redirectUri = params.redirect_uri || '';
    if (!this.clients.isRedirectUriAllowed(client, redirectUri)) {
      throw new AuthorizePageError(
        'redirect_uri is not registered for this client',
      );
    }

    if (params.response_type !== 'code') {
      throw new AuthorizeRedirectError(
        redirectUri,
        'unsupported_response_type',
        'Only response_type=code is supported',
        params.state,
      );
    }

    const requested = parseScopes(params.scope);
    const scopes = requested.length > 0 ? requested : [...ALL_SCOPES];
    const unknown = scopes.filter((s) => !ALL_SCOPES.includes(s));
    if (unknown.length > 0) {
      throw new AuthorizeRedirectError(
        redirectUri,
        'invalid_scope',
        `Unknown scope(s): ${unknown.join(' ')}`,
        params.state,
      );
    }

    const isPublicClient = !client.secretHash;
    if (params.code_challenge) {
      if ((params.code_challenge_method || 'plain') !== 'S256') {
        throw new AuthorizeRedirectError(
          redirectUri,
          'invalid_request',
          'Only code_challenge_method=S256 is supported',
          params.state,
        );
      }
    } else if (isPublicClient) {
      throw new AuthorizeRedirectError(
        redirectUri,
        'invalid_request',
        'PKCE (code_challenge) is required for public clients',
        params.state,
      );
    }

    return {
      client,
      redirectUri,
      scopes,
      state: params.state,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge ? 'S256' : undefined,
    };
  }

  // ─── Consent ──────────────────────────────────────────────────────────────

  /**
   * Handles the consent form POST: verifies the user's identity credential,
   * then issues an authorization code and returns the redirect URL.
   */
  async handleConsent(body: {
    decision?: string;
    provider?: string;
    credential?: string;
    authorize: AuthorizeParams;
  }): Promise<{ redirect: string }> {
    const validated = await this.validateAuthorizeRequest(body.authorize);

    if (body.decision !== 'allow') {
      const err = new AuthorizeRedirectError(
        validated.redirectUri,
        'access_denied',
        'The user denied the request',
        validated.state,
      );
      return { redirect: err.toRedirectUrl() };
    }

    const userId = await this.authenticateConsentUser(
      body.provider,
      body.credential,
    );

    const code = randomToken(AUTH_CODE_PREFIX);
    await this.prisma.oAuthAuthorizationCode.create({
      data: {
        codeHash: sha256(code),
        clientId: validated.client.id,
        userId,
        redirectUri: validated.redirectUri,
        scopes: validated.scopes,
        codeChallenge: validated.codeChallenge ?? null,
        codeChallengeMethod: validated.codeChallengeMethod ?? null,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
      },
    });

    const url = new URL(validated.redirectUri);
    url.searchParams.set('code', code);
    if (validated.state) url.searchParams.set('state', validated.state);
    return { redirect: url.toString() };
  }

  private async authenticateConsentUser(
    provider?: string,
    credential?: string,
  ): Promise<string> {
    if (!credential) {
      throw new UnauthorizedException('Missing sign-in credential');
    }

    if (provider === 'apple') {
      const audiences = [
        this.config.get<string>('APPLE_CLIENT_ID'),
        this.config.get<string>('APPLE_WEB_CLIENT_ID'),
      ].filter((a): a is string => !!a);
      const user = await this.authService.findOrCreateAppleUser(
        credential,
        audiences,
      );
      return user.id;
    }

    if (provider === 'google') {
      const user = await this.authService.findOrCreateGoogleUser(credential);
      return user.id;
    }

    if (provider === 'dev') {
      if (!this.devLoginEnabled) {
        throw new UnauthorizedException('Dev login is not enabled');
      }
      const email = credential.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new BadRequestException('Invalid email');
      }
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) return existing.id;
      const created = await this.prisma.user.create({ data: { email } });
      return created.id;
    }

    throw new BadRequestException('Unknown sign-in provider');
  }

  // ─── Token endpoint ───────────────────────────────────────────────────────

  async token(
    body: Record<string, string | undefined>,
    basicAuth?: { clientId: string; clientSecret: string },
  ) {
    const clientId = basicAuth?.clientId || body.client_id || '';
    const clientSecret = basicAuth?.clientSecret || body.client_secret;

    const client = await this.clients.getClient(clientId);
    if (!client) {
      throw new TokenEndpointError('invalid_client', 'Unknown client', 401);
    }
    if (!this.clients.verifySecret(client, clientSecret)) {
      throw new TokenEndpointError(
        'invalid_client',
        'Client authentication failed',
        401,
      );
    }

    switch (body.grant_type) {
      case 'authorization_code':
        return this.exchangeAuthorizationCode(client, body);
      case 'refresh_token':
        return this.refreshGrant(client, body);
      default:
        throw new TokenEndpointError(
          'unsupported_grant_type',
          'grant_type must be authorization_code or refresh_token',
        );
    }
  }

  private async exchangeAuthorizationCode(
    client: OAuthClient,
    body: Record<string, string | undefined>,
  ) {
    if (!body.code) {
      throw new TokenEndpointError('invalid_request', 'code is required');
    }

    const code = await this.prisma.oAuthAuthorizationCode.findUnique({
      where: { codeHash: sha256(body.code) },
    });

    if (!code || code.clientId !== client.id) {
      throw new TokenEndpointError(
        'invalid_grant',
        'Authorization code is invalid',
      );
    }
    if (code.usedAt) {
      // Code replay — revoke anything issued from it as a precaution.
      await this.tokens.revokeAllForUserClient(code.userId, client.id);
      throw new TokenEndpointError(
        'invalid_grant',
        'Authorization code already used',
      );
    }
    if (code.expiresAt <= new Date()) {
      throw new TokenEndpointError(
        'invalid_grant',
        'Authorization code expired',
      );
    }
    if (body.redirect_uri && body.redirect_uri !== code.redirectUri) {
      throw new TokenEndpointError(
        'invalid_grant',
        'redirect_uri does not match the authorization request',
      );
    }

    if (code.codeChallenge) {
      if (!body.code_verifier) {
        throw new TokenEndpointError(
          'invalid_request',
          'code_verifier is required',
        );
      }
      const computed = createHash('sha256')
        .update(body.code_verifier)
        .digest('base64url');
      if (computed !== code.codeChallenge) {
        throw new TokenEndpointError(
          'invalid_grant',
          'PKCE verification failed',
        );
      }
    }

    await this.prisma.oAuthAuthorizationCode.update({
      where: { id: code.id },
      data: { usedAt: new Date() },
    });

    const pair = await this.tokens.issueTokenPair(
      code.userId,
      client.id,
      code.scopes,
    );
    return this.tokenResponse(pair);
  }

  private async refreshGrant(
    client: OAuthClient,
    body: Record<string, string | undefined>,
  ) {
    if (!body.refresh_token) {
      throw new TokenEndpointError(
        'invalid_request',
        'refresh_token is required',
      );
    }
    const pair = await this.tokens.rotateRefreshToken(
      body.refresh_token,
      client.id,
    );
    if (!pair) {
      throw new TokenEndpointError(
        'invalid_grant',
        'Refresh token is invalid, expired, or revoked',
      );
    }
    return this.tokenResponse(pair);
  }

  private tokenResponse(pair: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    scopes: string[];
  }) {
    return {
      access_token: pair.accessToken,
      token_type: 'Bearer',
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
      scope: pair.scopes.join(' '),
    };
  }

  // ─── Revocation ───────────────────────────────────────────────────────────

  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.tokens.revokeToken(token);
  }

  // ─── Discovery metadata ───────────────────────────────────────────────────

  authorizationServerMetadata() {
    const base = this.publicBaseUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      revocation_endpoint: `${base}/oauth/revoke`,
      registration_endpoint: `${base}/oauth/register`,
      scopes_supported: ALL_SCOPES,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: [
        'none',
        'client_secret_post',
        'client_secret_basic',
      ],
    };
  }

  protectedResourceMetadata() {
    const base = this.publicBaseUrl;
    return {
      resource: base,
      authorization_servers: [base],
      scopes_supported: ALL_SCOPES,
      bearer_methods_supported: ['header'],
    };
  }
}
