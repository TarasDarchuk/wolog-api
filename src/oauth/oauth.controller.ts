import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import {
  AuthorizePageError,
  AuthorizeRedirectError,
  OAuthService,
} from './oauth.service.js';
import type { AuthorizeParams } from './oauth.service.js';
import { OAuthClientService } from './oauth-client.service.js';
import {
  CONSENT_PAGE_CSP,
  renderConsentPage,
  renderErrorPage,
} from './consent-page.js';

function parseBasicAuth(
  header: string | undefined,
): { clientId: string; clientSecret: string } | undefined {
  if (!header?.startsWith('Basic ')) return undefined;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return undefined;
    return {
      clientId: decodeURIComponent(decoded.slice(0, idx)),
      clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
    };
  } catch {
    return undefined;
  }
}

/**
 * OAuth 2.0 provider for AI connectors (Claude remote MCP, ChatGPT Action).
 * Routes live at the root (no /api/v1 prefix — see main.ts exclusions).
 */
@Public()
@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly clients: OAuthClientService,
    private readonly config: ConfigService,
  ) {}

  @Get('authorize')
  async authorize(@Query() query: AuthorizeParams, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const validated = await this.oauth.validateAuthorizeRequest(query);
      res.setHeader('Content-Security-Policy', CONSENT_PAGE_CSP);
      res
        .status(200)
        .type('html')
        .send(
          renderConsentPage({
            clientName: validated.client.name,
            scopes: validated.scopes,
            params: {
              client_id: query.client_id,
              redirect_uri: query.redirect_uri,
              response_type: query.response_type,
              scope: validated.scopes.join(' '),
              state: query.state,
              code_challenge: query.code_challenge,
              code_challenge_method: query.code_challenge_method,
            },
            appleWebClientId: this.config.get('APPLE_WEB_CLIENT_ID'),
            googleClientId: this.config.get('GOOGLE_CLIENT_ID'),
            devLoginEnabled: this.oauth.devLoginEnabled,
            baseUrl: this.oauth.publicBaseUrl,
          }),
        );
    } catch (error) {
      if (error instanceof AuthorizeRedirectError) {
        res.redirect(302, error.toRedirectUrl());
        return;
      }
      const message =
        error instanceof AuthorizePageError
          ? error.message
          : 'Unexpected error';
      res.status(400).type('html').send(renderErrorPage(message));
    }
  }

  @Post('consent')
  @HttpCode(200)
  async consent(
    @Body()
    body: {
      decision?: string;
      provider?: string;
      credential?: string;
      authorize?: AuthorizeParams;
    },
  ) {
    try {
      return await this.oauth.handleConsent({
        decision: body.decision,
        provider: body.provider,
        credential: body.credential,
        authorize: body.authorize ?? {},
      });
    } catch (error) {
      if (error instanceof AuthorizeRedirectError) {
        return { redirect: error.toRedirectUrl() };
      }
      throw error;
    }
  }

  @Post('token')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async token(
    @Body() body: Record<string, string | undefined>,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return this.oauth.token(body ?? {}, parseBasicAuth(authorization));
  }

  @Post('revoke')
  @HttpCode(200)
  async revoke(@Body() body: Record<string, string | undefined>) {
    await this.oauth.revoke(body?.token);
    return {};
  }

  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body()
    body: {
      client_name?: string;
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
    },
  ) {
    return this.clients.registerClient(body ?? {});
  }
}
