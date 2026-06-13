jest.mock('uuid', () => ({
  v4: jest.fn(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
}));

import { createHash } from 'node:crypto';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../__mocks__/prisma.mock.js';
import {
  AuthorizePageError,
  AuthorizeRedirectError,
  OAuthService,
} from './oauth.service.js';
import { OAuthClientService } from './oauth-client.service.js';
import { OAuthTokenService, sha256 } from './oauth-token.service.js';
import { ALL_SCOPES } from './scopes.js';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);

const CONFIG_VALUES: Record<string, string> = {
  JWT_SECRET: 'test-secret',
  NODE_ENV: 'test',
  OAUTH_DEV_LOGIN: 'true',
  PUBLIC_BASE_URL: 'https://api.example.com',
};

function makeConfig() {
  return {
    get: jest.fn((key: string, def?: unknown) => CONFIG_VALUES[key] ?? def),
  } as any;
}

const PUBLIC_CLIENT = {
  id: 'client-claude',
  name: 'Claude',
  secretHash: null,
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  createdAt: new Date(),
};

const VERIFIER = 'a'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

function makeAuthorizeQuery(overrides: Record<string, string> = {}) {
  return {
    client_id: 'client-claude',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    response_type: 'code',
    scope: 'routines:read routines:write history:read',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  };
}

function makeCodeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'code-row-1',
    codeHash: sha256('rawcode'),
    clientId: 'client-claude',
    userId: 'user-1',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    scopes: [...ALL_SCOPES],
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    expiresAt: FUTURE,
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('OAuthService', () => {
  let prisma: MockPrismaService;
  let service: OAuthService;
  let authService: {
    findOrCreateAppleUser: jest.Mock;
    findOrCreateGoogleUser: jest.Mock;
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    const config = makeConfig();
    const tokenService = new OAuthTokenService(prisma as any, config);
    const clientService = new OAuthClientService(prisma as any, config);
    authService = {
      findOrCreateAppleUser: jest.fn(),
      findOrCreateGoogleUser: jest.fn(),
    };
    service = new OAuthService(
      prisma as any,
      config,
      clientService,
      tokenService,
      authService as any,
    );

    prisma.oAuthClient.findUnique.mockResolvedValue(PUBLIC_CLIENT);
    prisma.oAuthToken.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'token-row', ...data }),
    );
  });

  describe('validateAuthorizeRequest', () => {
    it('rejects an unknown client with a page error (no redirect)', async () => {
      prisma.oAuthClient.findUnique.mockResolvedValue(null);
      await expect(
        service.validateAuthorizeRequest(makeAuthorizeQuery()),
      ).rejects.toThrow(AuthorizePageError);
    });

    it('rejects an unregistered redirect_uri with a page error', async () => {
      await expect(
        service.validateAuthorizeRequest(
          makeAuthorizeQuery({ redirect_uri: 'https://evil.example.com/cb' }),
        ),
      ).rejects.toThrow(AuthorizePageError);
    });

    it('requires PKCE for public clients', async () => {
      await expect(
        service.validateAuthorizeRequest(
          makeAuthorizeQuery({ code_challenge: '' }),
        ),
      ).rejects.toThrow(AuthorizeRedirectError);
    });

    it('rejects unknown scopes via redirect error', async () => {
      await expect(
        service.validateAuthorizeRequest(
          makeAuthorizeQuery({ scope: 'routines:read admin:everything' }),
        ),
      ).rejects.toThrow(AuthorizeRedirectError);
    });

    it('defaults to all scopes when scope is omitted', async () => {
      const result = await service.validateAuthorizeRequest(
        makeAuthorizeQuery({ scope: '' }),
      );
      expect(result.scopes).toEqual(ALL_SCOPES);
    });
  });

  describe('handleConsent', () => {
    it('returns access_denied redirect on deny without authenticating', async () => {
      const result = await service.handleConsent({
        decision: 'deny',
        provider: 'dev',
        credential: 'a@b.co',
        authorize: makeAuthorizeQuery(),
      });
      expect(result.redirect).toContain('error=access_denied');
      expect(result.redirect).toContain('state=xyz');
      expect(prisma.oAuthAuthorizationCode.create).not.toHaveBeenCalled();
    });

    it('issues a code on allow with dev login', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-9' });
      prisma.oAuthAuthorizationCode.create.mockResolvedValue({});

      const result = await service.handleConsent({
        decision: 'allow',
        provider: 'dev',
        credential: 'dev@example.com',
        authorize: makeAuthorizeQuery(),
      });

      expect(result.redirect).toMatch(/code=wlgc_/);
      expect(result.redirect).toContain('state=xyz');
      expect(prisma.oAuthAuthorizationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-9',
            clientId: 'client-claude',
            codeChallenge: CHALLENGE,
          }),
        }),
      );
    });

    it('refuses dev login when disabled', async () => {
      CONFIG_VALUES.OAUTH_DEV_LOGIN = 'false';
      try {
        await expect(
          service.handleConsent({
            decision: 'allow',
            provider: 'dev',
            credential: 'dev@example.com',
            authorize: makeAuthorizeQuery(),
          }),
        ).rejects.toThrow('Dev login is not enabled');
      } finally {
        CONFIG_VALUES.OAUTH_DEV_LOGIN = 'true';
      }
    });
  });

  describe('token — authorization_code', () => {
    beforeEach(() => {
      prisma.oAuthAuthorizationCode.findUnique.mockResolvedValue(makeCodeRow());
      prisma.oAuthAuthorizationCode.update.mockResolvedValue({});
    });

    it('exchanges a valid code + verifier for a token pair', async () => {
      const response = await service.token({
        grant_type: 'authorization_code',
        code: 'rawcode',
        client_id: 'client-claude',
        code_verifier: VERIFIER,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      });

      expect(response.access_token).toMatch(/^wlga_/);
      expect(response.refresh_token).toMatch(/^wlgr_/);
      expect(response.token_type).toBe('Bearer');
      expect(response.scope).toBe(ALL_SCOPES.join(' '));
      // The code is single-use.
      expect(prisma.oAuthAuthorizationCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ usedAt: expect.any(Date) }),
        }),
      );
      // Tokens are stored hashed, never raw.
      const stored = prisma.oAuthToken.create.mock.calls[0][0].data;
      expect(stored.accessTokenHash).toBe(sha256(response.access_token));
      expect(stored.accessTokenHash).not.toContain('wlga_');
    });

    it('rejects a wrong PKCE verifier', async () => {
      await expect(
        service.token({
          grant_type: 'authorization_code',
          code: 'rawcode',
          client_id: 'client-claude',
          code_verifier: 'b'.repeat(43),
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'invalid_grant' }),
      });
    });

    it('rejects a replayed code and revokes issued tokens', async () => {
      prisma.oAuthAuthorizationCode.findUnique.mockResolvedValue(
        makeCodeRow({ usedAt: new Date() }),
      );
      await expect(
        service.token({
          grant_type: 'authorization_code',
          code: 'rawcode',
          client_id: 'client-claude',
          code_verifier: VERIFIER,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'invalid_grant' }),
      });
      expect(prisma.oAuthToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('rejects an unknown client with 401 invalid_client', async () => {
      prisma.oAuthClient.findUnique.mockResolvedValue(null);
      await expect(
        service.token({ grant_type: 'authorization_code', code: 'rawcode' }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ error: 'invalid_client' }),
      });
    });
  });

  describe('token — refresh_token', () => {
    it('rotates: revokes the old pair and issues a new one', async () => {
      prisma.oAuthToken.findUnique.mockResolvedValue({
        id: 'token-row-1',
        userId: 'user-1',
        clientId: 'client-claude',
        scopes: [...ALL_SCOPES],
        revokedAt: null,
        refreshExpiresAt: FUTURE,
      });
      prisma.oAuthToken.update.mockResolvedValue({});

      const response = await service.token({
        grant_type: 'refresh_token',
        refresh_token: 'wlgr_old',
        client_id: 'client-claude',
      });

      expect(prisma.oAuthToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'token-row-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
      expect(response.access_token).toMatch(/^wlga_/);
    });

    it('revokes the whole grant when a revoked refresh token is replayed', async () => {
      prisma.oAuthToken.findUnique.mockResolvedValue({
        id: 'token-row-1',
        userId: 'user-1',
        clientId: 'client-claude',
        scopes: [...ALL_SCOPES],
        revokedAt: new Date(),
        refreshExpiresAt: FUTURE,
      });

      await expect(
        service.token({
          grant_type: 'refresh_token',
          refresh_token: 'wlgr_stolen',
          client_id: 'client-claude',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'invalid_grant' }),
      });
      expect(prisma.oAuthToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            clientId: 'client-claude',
          }),
        }),
      );
    });
  });

  describe('revoke', () => {
    it('revokes by token hash', async () => {
      await service.revoke('wlga_sometoken');
      expect(prisma.oAuthToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { accessTokenHash: sha256('wlga_sometoken') },
              { refreshTokenHash: sha256('wlga_sometoken') },
            ],
          }),
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('validateAccessToken (guard path)', () => {
    it('rejects revoked tokens', async () => {
      const config = makeConfig();
      const tokens = new OAuthTokenService(prisma as any, config);
      prisma.oAuthToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-claude',
        scopes: [...ALL_SCOPES],
        revokedAt: new Date(),
        accessExpiresAt: FUTURE,
      });
      expect(await tokens.validateAccessToken('wlga_x')).toBeNull();
    });

    it('rejects expired tokens', async () => {
      const config = makeConfig();
      const tokens = new OAuthTokenService(prisma as any, config);
      prisma.oAuthToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-claude',
        scopes: [...ALL_SCOPES],
        revokedAt: null,
        accessExpiresAt: new Date(Date.now() - 1000),
      });
      expect(await tokens.validateAccessToken('wlga_x')).toBeNull();
    });

    it('returns the principal for a live token', async () => {
      const config = makeConfig();
      const tokens = new OAuthTokenService(prisma as any, config);
      prisma.oAuthToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-claude',
        scopes: ['routines:read'],
        revokedAt: null,
        accessExpiresAt: FUTURE,
      });
      expect(await tokens.validateAccessToken('wlga_x')).toEqual({
        userId: 'user-1',
        clientId: 'client-claude',
        scopes: ['routines:read'],
      });
    });
  });
});
