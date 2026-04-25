import {
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  SharesService,
  ShareRateLimitedException,
} from './shares.service';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
} from '../__mocks__/prisma.mock';
import { CreateShareDto } from './dto/create-share.dto';

function createService(
  prisma: MockPrismaService,
  ttlEnv: string | undefined = '90',
  baseUrlEnv: string | undefined = undefined,
) {
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'SHARE_DEFAULT_TTL_DAYS') return ttlEnv;
      if (key === 'SHARE_BASE_URL') return baseUrlEnv;
      return fallback;
    }),
  };
  return new SharesService(prisma as any, config as any);
}

function makeDto(overrides: Partial<CreateShareDto> = {}): CreateShareDto {
  return {
    payloadVersion: 1,
    kind: 'template',
    template: { id: 't1', name: 'Push Day' },
    exercises: [{ id: 'e1', name: 'Bench' }],
    creatorName: 'Taras',
    sourceAppVersion: '1.0.0',
    useMetric: true,
    ...overrides,
  } as CreateShareDto;
}

describe('SharesService', () => {
  let prisma: MockPrismaService;
  let service: SharesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = createService(prisma);
    prisma.share.count.mockResolvedValue(0);
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('persists the share and returns id, url, expiresAt', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      let captured: any;
      prisma.share.create.mockImplementation(async ({ data }: any) => {
        captured = data;
        return {
          ...data,
          createdAt: new Date(now),
        };
      });

      const dto = makeDto();
      const result = await service.create(USER_ID, dto);

      expect(result.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
      expect(result.url).toBe(`https://wolog.app/s/${result.id}`);
      expect(new Date(result.expiresAt).getTime()).toBe(
        now + 90 * 24 * 60 * 60 * 1000,
      );
      expect(captured.ownerUserId).toBe(USER_ID);
      expect(captured.payloadJson).toEqual(dto);
    });

    it('honors SHARE_DEFAULT_TTL_DAYS from config', async () => {
      service = createService(prisma, '30');
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      prisma.share.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(now),
      }));

      const result = await service.create(USER_ID, makeDto());

      expect(new Date(result.expiresAt).getTime()).toBe(
        now + 30 * 24 * 60 * 60 * 1000,
      );
    });

    it('falls back to 90 days when SHARE_DEFAULT_TTL_DAYS is missing', async () => {
      service = createService(prisma, undefined);
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      prisma.share.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(now),
      }));

      const result = await service.create(USER_ID, makeDto());

      expect(new Date(result.expiresAt).getTime()).toBe(
        now + 90 * 24 * 60 * 60 * 1000,
      );
    });

    it.each(['abc', '0', '-1', ''])(
      'falls back to 90 days when SHARE_DEFAULT_TTL_DAYS is invalid (%s)',
      async (ttlEnv) => {
        service = createService(prisma, ttlEnv);
        const now = Date.now();
        jest.spyOn(Date, 'now').mockReturnValue(now);
        prisma.share.create.mockImplementation(async ({ data }: any) => ({
          ...data,
          createdAt: new Date(now),
        }));

        const result = await service.create(USER_ID, makeDto());

        expect(new Date(result.expiresAt).getTime()).toBe(
          now + 90 * 24 * 60 * 60 * 1000,
        );
      },
    );

    it('throws 429 with retryAfterSeconds when over 30 in 24h', async () => {
      prisma.share.count.mockResolvedValue(30);
      const oldest = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      prisma.share.findFirst.mockResolvedValue({ createdAt: oldest });

      let caught: ShareRateLimitedException | undefined;
      try {
        await service.create(USER_ID, makeDto());
      } catch (e) {
        caught = e as ShareRateLimitedException;
      }

      expect(caught).toBeInstanceOf(ShareRateLimitedException);
      expect(caught!.getStatus()).toBe(429);
      // ~23h remaining
      expect(caught!.retryAfterSeconds).toBeGreaterThan(82_000);
      expect(caught!.retryAfterSeconds).toBeLessThanOrEqual(23 * 3600 + 5);
      expect(prisma.share.create).not.toHaveBeenCalled();
    });

    it('allows the 30th create in the window', async () => {
      prisma.share.count.mockResolvedValue(29);
      prisma.share.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
      }));

      await expect(service.create(USER_ID, makeDto())).resolves.toBeDefined();
    });

    it('throws 413 when serialized payload exceeds 256 KB', async () => {
      prisma.share.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
      }));
      const dto = makeDto({
        template: { id: 't1', blob: 'x'.repeat(300 * 1024) },
      });

      await expect(service.create(USER_ID, dto)).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
      expect(prisma.share.count).not.toHaveBeenCalled();
      expect(prisma.share.create).not.toHaveBeenCalled();
    });

    it('honors SHARE_BASE_URL from config (with trailing slash added if missing)', async () => {
      service = createService(prisma, '90', 'https://example.com/x');
      prisma.share.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
      }));

      const result = await service.create(USER_ID, makeDto());

      expect(result.url).toBe(`https://example.com/x/${result.id}`);
    });
  });

  // ─── fetch ─────────────────────────────────────────────────────────────

  describe('fetch', () => {
    it('returns payload, createdAt, expiresAt', async () => {
      const createdAt = new Date('2026-04-23T10:00:00.000Z');
      const expiresAt = new Date('2026-07-22T10:00:00.000Z');
      const payload = {
        kind: 'template',
        template: { id: 't1' },
        useMetric: true,
      };

      prisma.share.findUnique.mockResolvedValue({
        id: 'abc123XYz_',
        ownerUserId: USER_ID,
        payloadJson: payload,
        createdAt,
        expiresAt,
      });

      const result = await service.fetch('abc123XYz_');

      expect(result).toEqual({
        id: 'abc123XYz_',
        payload,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
    });

    it('round-trips useMetric through create -> fetch', async () => {
      let stored: any;
      prisma.share.create.mockImplementation(async ({ data }: any) => {
        stored = { ...data, createdAt: new Date() };
        return stored;
      });
      prisma.share.findUnique.mockImplementation(async () => stored);

      const created = await service.create(USER_ID, makeDto({ useMetric: false }));
      const fetched = await service.fetch(created.id);

      expect((fetched.payload as any).useMetric).toBe(false);
    });

    it('throws NotFoundException when id does not exist', async () => {
      prisma.share.findUnique.mockResolvedValue(null);
      await expect(service.fetch('missing__1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws GoneException when share is expired (not 404)', async () => {
      prisma.share.findUnique.mockResolvedValue({
        id: 'expired__1',
        ownerUserId: USER_ID,
        payloadJson: {},
        createdAt: new Date(Date.now() - 100 * 24 * 3600 * 1000),
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.fetch('expired__1')).rejects.toThrow(GoneException);
    });
  });

  // ─── cleanupExpired ────────────────────────────────────────────────────

  describe('cleanupExpired', () => {
    it('deletes shares older than 7 days past expiry (grace window)', async () => {
      prisma.share.deleteMany.mockResolvedValue({ count: 4 });
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const result = await service.cleanupExpired();

      expect(result).toEqual({ deleted: 4 });
      const arg = prisma.share.deleteMany.mock.calls[0][0];
      const cutoff = (arg.where.expiresAt.lt as Date).getTime();
      expect(now - cutoff).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
