import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator.js';
import { OAuthService } from './oauth.service.js';

/**
 * OAuth discovery metadata (RFC 8414 / RFC 9728). MCP clients use these to
 * find the authorization server from a 401 on /mcp.
 */
@Public()
@Controller('.well-known')
export class WellKnownController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Apple domain verification for Sign in with Apple JS. Paste the file Apple
   * generates (Certificates, IDs & Profiles → your Services ID → Domains) into
   * the APPLE_DOMAIN_ASSOCIATION env var; Apple fetches this URL to verify.
   */
  @Get('apple-developer-domain-association.txt')
  @Header('Content-Type', 'text/plain')
  appleDomainAssociation(@Res({ passthrough: true }) res: Response) {
    const content = this.config.get<string>('APPLE_DOMAIN_ASSOCIATION');
    if (!content) {
      throw new NotFoundException('Apple domain association not configured');
    }
    res.send(content);
  }

  @Get('oauth-authorization-server')
  authorizationServer() {
    return this.oauth.authorizationServerMetadata();
  }

  // Some clients probe the OIDC discovery path; serve the same metadata.
  @Get('openid-configuration')
  openidConfiguration() {
    return this.oauth.authorizationServerMetadata();
  }

  @Get('oauth-protected-resource')
  protectedResource() {
    return this.oauth.protectedResourceMetadata();
  }

  // Resource-specific variant for the MCP endpoint (RFC 9728 path form).
  @Get('oauth-protected-resource/mcp')
  protectedResourceMcp() {
    const metadata = this.oauth.protectedResourceMetadata();
    return { ...metadata, resource: `${metadata.resource}/mcp` };
  }
}
