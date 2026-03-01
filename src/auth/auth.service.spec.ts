import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  makeExistingUser,
} from '../__mocks__/prisma.mock';

// ─── External library mocks ─────────────────────────────────────────────────

jest.mock('apple-signin-auth', () => ({
  verifyIdToken: jest.fn(),
}));

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-token'),
  compare: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
}));

import * as appleSignin from 'apple-signin-auth';
import * as bcrypt from 'bcrypt';

// ─── Helper: build AuthService with mocked deps ─────────────────────────────

function createAuthService(prisma: MockPrismaService, opts: { googleClientId?: string } = {}) {
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('jwt-access-token'),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        APPLE_CLIENT_ID: 'com.tarasdarchuk.wolog',
        JWT_ACCESS_EXPIRY: '15m',
        JWT_REFRESH_EXPIRY_DAYS: 30,
      };
      if (opts.googleClientId) {
        config['GOOGLE_CLIENT_ID'] = opts.googleClientId;
      }
      return config[key] ?? defaultValue;
    }),
  };

  // Stub user lookup for generateTokens()
  prisma.user.findUniqueOrThrow.mockResolvedValue(
    makeExistingUser(),
  );
  prisma.refreshToken.create.mockResolvedValue({});

  return new AuthService(prisma as any, mockJwtService as any, mockConfigService as any);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    jest.clearAllMocks();
    // Re-set default for uuid and bcrypt after clearAllMocks
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-token');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const uuid = require('uuid');
    uuid.v4.mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  // ─── Sign in with Apple ────────────────────────────────────────────────

  describe('signInWithApple', () => {
    it('creates a new user on first sign-in', async () => {
      const service = createAuthService(prisma);
      (appleSignin.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-new',
        email: 'new@test.com',
      });
      prisma.user.findUnique.mockResolvedValue(null); // no existing by appleUserId or email
      prisma.user.create.mockResolvedValue(
        makeExistingUser({ appleUserId: 'apple-new', email: 'new@test.com', displayName: 'New User' }),
      );

      const result = await service.signInWithApple({
        identityToken: 'valid-token',
        displayName: 'New User',
      });

      expect(result.accessToken).toBe('jwt-access-token');
      expect(result.refreshToken).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          appleUserId: 'apple-new',
          email: 'new@test.com',
          displayName: 'New User',
        }),
      });
    });

    it('returns tokens for existing user', async () => {
      const service = createAuthService(prisma);
      (appleSignin.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-sub-123',
        email: 'test@example.com',
      });
      prisma.user.findUnique.mockResolvedValue(makeExistingUser());

      const result = await service.signInWithApple({
        identityToken: 'valid-token',
      });

      expect(result.accessToken).toBe('jwt-access-token');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('links Apple ID to existing email account', async () => {
      const service = createAuthService(prisma);
      (appleSignin.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-new-sub',
        email: 'existing@test.com',
      });
      // First call: findUnique by appleUserId → null
      // Second call: findUnique by email → existing user without appleUserId
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeExistingUser({ appleUserId: null, email: 'existing@test.com' }),
        );
      prisma.user.update.mockResolvedValue(
        makeExistingUser({ appleUserId: 'apple-new-sub' }),
      );

      const result = await service.signInWithApple({
        identityToken: 'valid-token',
      });

      expect(result.accessToken).toBe('jwt-access-token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { appleUserId: 'apple-new-sub' },
      });
    });

    it('throws ConflictException when email already linked to another Apple account', async () => {
      const service = createAuthService(prisma);
      (appleSignin.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-different',
        email: 'taken@test.com',
      });
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeExistingUser({ appleUserId: 'apple-other', email: 'taken@test.com' }),
        );

      await expect(
        service.signInWithApple({ identityToken: 'valid-token' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws UnauthorizedException on invalid token', async () => {
      const service = createAuthService(prisma);
      (appleSignin.verifyIdToken as jest.Mock).mockRejectedValue(
        new Error('invalid'),
      );

      await expect(
        service.signInWithApple({ identityToken: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('creates user without email when Apple token has no email', async () => {
      const service = createAuthService(prisma);
      (appleSignin.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-no-email',
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(
        makeExistingUser({ email: null, appleUserId: 'apple-no-email' }),
      );

      const result = await service.signInWithApple({
        identityToken: 'valid-token',
      });

      expect(result.accessToken).toBe('jwt-access-token');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          appleUserId: 'apple-no-email',
          email: null,
        }),
      });
    });
  });

  // ─── Sign in with Google ───────────────────────────────────────────────

  describe('signInWithGoogle', () => {
    it('throws UnauthorizedException when Google is not configured', async () => {
      const service = createAuthService(prisma); // no googleClientId

      await expect(
        service.signInWithGoogle({ idToken: 'google-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    // Note: Full Google sign-in tests would require mocking OAuth2Client.verifyIdToken,
    // which is instantiated in the constructor. Testing the "not configured" path
    // validates the guard logic. Integration tests are better for the full flow.
  });

  // ─── Refresh Access Token ─────────────────────────────────────────────

  describe('refreshAccessToken', () => {
    it('rotates refresh token (revoke old + issue new)', async () => {
      const service = createAuthService(prisma);
      const candidateToken = {
        id: 'rt-1',
        tokenHash: 'hashed',
        tokenFamily: 'aaaaaaaa',
        revokedAt: null,
        expiresAt: new Date('2099-01-01'),
        deviceName: 'iPhone',
        user: makeExistingUser(),
      };
      prisma.refreshToken.findMany.mockResolvedValue([candidateToken]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.refreshAccessToken({
        refreshToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      });

      expect(result.accessToken).toBe('jwt-access-token');
      // Old token revoked
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      // New token created
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('throws UnauthorizedException when no token matches', async () => {
      const service = createAuthService(prisma);
      prisma.refreshToken.findMany.mockResolvedValue([]);

      await expect(
        service.refreshAccessToken({
          refreshToken: 'aaaaaaaa-invalid',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when bcrypt does not match', async () => {
      const service = createAuthService(prisma);
      prisma.refreshToken.findMany.mockResolvedValue([
        {
          id: 'rt-1',
          tokenHash: 'hashed',
          tokenFamily: 'aaaaaaaa',
          revokedAt: null,
          expiresAt: new Date('2099-01-01'),
          user: makeExistingUser(),
        },
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.refreshAccessToken({
          refreshToken: 'aaaaaaaa-wrong-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('uses tokenFamily (first 8 chars) for lookup', async () => {
      const service = createAuthService(prisma);
      prisma.refreshToken.findMany.mockResolvedValue([]);

      try {
        await service.refreshAccessToken({
          refreshToken: '12345678-rest-of-token',
        });
      } catch {
        // expected to throw
      }

      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: {
          tokenFamily: '12345678',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        include: { user: true },
      });
    });
  });

  // ─── Logout ────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revokes the matching refresh token', async () => {
      const service = createAuthService(prisma);
      prisma.refreshToken.findMany.mockResolvedValue([
        { id: 'rt-1', tokenHash: 'hashed', tokenFamily: 'aaaaaaaa', revokedAt: null },
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.logout('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does nothing when token not found (no error)', async () => {
      const service = createAuthService(prisma);
      prisma.refreshToken.findMany.mockResolvedValue([]);

      // Should not throw
      await expect(service.logout('aaaaaaaa-not-found')).resolves.toBeUndefined();
    });
  });

  // ─── Delete Account ───────────────────────────────────────────────────

  describe('deleteAccount', () => {
    it('deletes the user', async () => {
      const service = createAuthService(prisma);
      prisma.user.delete.mockResolvedValue({});

      await service.deleteAccount(USER_ID);

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: USER_ID },
      });
    });
  });

  // ─── Get User Profile ─────────────────────────────────────────────────

  describe('getUserProfile', () => {
    it('returns profile with hasApple/hasGoogle flags', async () => {
      const service = createAuthService(prisma);
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        email: 'test@example.com',
        displayName: 'Test User',
        appleUserId: 'apple-123',
        googleUserId: null,
        createdAt: new Date(),
      });

      const result = await service.getUserProfile(USER_ID);

      expect(result.hasApple).toBe(true);
      expect(result.hasGoogle).toBe(false);
      expect(result.appleUserId).toBeUndefined();
      expect(result.googleUserId).toBeUndefined();
    });

    it('throws UnauthorizedException when user not found', async () => {
      const service = createAuthService(prisma);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserProfile(USER_ID)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
