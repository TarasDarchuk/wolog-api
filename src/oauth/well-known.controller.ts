import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { OAuthService } from './oauth.service.js';

/**
 * OAuth discovery metadata (RFC 8414 / RFC 9728). MCP clients use these to
 * find the authorization server from a 401 on /mcp.
 */
@Public()
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly oauth: OAuthService) {}

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
