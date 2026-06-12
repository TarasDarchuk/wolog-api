import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { OAuthClient } from '../generated/prisma/client.js';
import { sha256 } from './oauth-token.service.js';

interface StaticClientConfig {
  id: string;
  name: string;
  secret?: string;
  redirectUris: string[];
}

/**
 * OAuth client registry. Two ways clients exist:
 *  - Static clients from the OAUTH_STATIC_CLIENTS env var (JSON array),
 *    upserted at boot — use this for the ChatGPT Action (confidential) and
 *    a pre-registered Claude connector.
 *  - Dynamic registration (RFC 7591) at POST /oauth/register — Claude's
 *    remote MCP connector flow registers itself this way (public + PKCE).
 */
@Injectable()
export class OAuthClientService implements OnModuleInit {
  private readonly logger = new Logger(OAuthClientService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const raw = this.config.get<string>('OAUTH_STATIC_CLIENTS');
    if (!raw) return;

    let clients: StaticClientConfig[];
    try {
      clients = JSON.parse(raw);
    } catch {
      this.logger.error('OAUTH_STATIC_CLIENTS is not valid JSON — ignoring');
      return;
    }

    for (const c of clients) {
      if (!c.id || !c.name || !Array.isArray(c.redirectUris)) {
        this.logger.error(
          `Static OAuth client entry missing id/name/redirectUris — skipping`,
        );
        continue;
      }
      try {
        await this.prisma.oAuthClient.upsert({
          where: { id: c.id },
          create: {
            id: c.id,
            name: c.name,
            secretHash: c.secret ? sha256(c.secret) : null,
            redirectUris: c.redirectUris,
          },
          update: {
            name: c.name,
            secretHash: c.secret ? sha256(c.secret) : null,
            redirectUris: c.redirectUris,
          },
        });
        this.logger.log(`Registered static OAuth client "${c.id}"`);
      } catch (error) {
        this.logger.error(`Failed to upsert OAuth client "${c.id}"`, error);
      }
    }
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    if (!clientId) return null;
    return this.prisma.oAuthClient.findUnique({ where: { id: clientId } });
  }

  isRedirectUriAllowed(client: OAuthClient, redirectUri: string): boolean {
    return client.redirectUris.includes(redirectUri);
  }

  verifySecret(client: OAuthClient, secret: string | undefined): boolean {
    if (!client.secretHash) return true; // public client — PKCE instead
    if (!secret) return false;
    const a = Buffer.from(client.secretHash, 'hex');
    const b = Buffer.from(sha256(secret), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** RFC 7591 dynamic client registration (public clients only). */
  async registerClient(body: {
    client_name?: string;
    redirect_uris?: string[];
    token_endpoint_auth_method?: string;
  }) {
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      throw new BadRequestException({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required',
      });
    }
    for (const uri of redirectUris) {
      if (!this.isAcceptableRedirectUri(uri)) {
        throw new BadRequestException({
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri must be https (or localhost for development): ${uri}`,
        });
      }
    }

    const authMethod = body.token_endpoint_auth_method ?? 'none';
    const secret =
      authMethod === 'none' ? null : randomBytes(32).toString('base64url');

    const client = await this.prisma.oAuthClient.create({
      data: {
        id: 'wlg_' + randomBytes(16).toString('base64url'),
        name: (body.client_name || 'Unnamed connector').slice(0, 120),
        secretHash: secret ? sha256(secret) : null,
        redirectUris,
      },
    });

    return {
      client_id: client.id,
      ...(secret ? { client_secret: secret } : {}),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: secret ? 'client_secret_post' : 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }

  private isAcceptableRedirectUri(uri: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return false;
    }
    if (parsed.protocol === 'https:') return true;
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    );
  }
}
