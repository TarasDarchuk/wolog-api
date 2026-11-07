import { ConflictException } from '@nestjs/common';
import { PaywallCohort, Prisma } from '../generated/prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
} from '../__mocks__/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { computeAccess, PRO_EXPIRY_GRACE_MS } from './access';
import { SubscriptionsService } from './subscriptions.service';
import { AdaptyApiService } from './adapty-api.service';

const HOUR = 60 * 60 * 1000;
// Adapty customer_user_id = Wolog user id, a UUID in production.
const USER_UUID = '7d3f0c2e-8a41-4c55-9e2b-1f6a0b9c4d21';

describe('computeAccess', () => {
  const now = new Date('2026-11-05T12:00:00Z');

  it('never locks legacy or null-cohort accounts', () => {
    for (const paywallCohort of [PaywallCohort.LEGACY, null]) {
      expect(
        computeAccess({ isPro: false, proExpiresAt: null, paywallCohort }, now),
      ).toBe('full');
    }
  });

  it('locks a new-cohort account without Pro', () => {
    expect(
      computeAccess(
        { isPro: false, proExpiresAt: null, paywallCohort: PaywallCohort.NEW },
        now,
      ),
    ).toBe('locked');
  });

  it('keeps access during the grace period after expiry, then locks', () => {
    const user = (expiredAgoMs: number) => ({
      isPro: true,
      proExpiresAt: new Date(now.getTime() - expiredAgoMs),
      paywallCohort: PaywallCohort.NEW,
    });
    expect(computeAccess(user(HOUR), now)).toBe('full');
    expect(computeAccess(user(PRO_EXPIRY_GRACE_MS + HOUR), now)).toBe('locked');
  });

  it('treats Pro without an expiry as active', () => {
    expect(
      computeAccess(
        { isPro: true, proExpiresAt: null, paywallCohort: PaywallCohort.NEW },
        now,
      ),
    ).toBe('full');
  });
});

describe('SubscriptionsService', () => {
  let prisma: MockPrismaService;
  let service: SubscriptionsService;
  let adapty: { premiumStatus: jest.Mock; isConfigured: boolean };

  beforeEach(() => {
    prisma = createMockPrismaService();
    adapty = { premiumStatus: jest.fn(), isConfigured: true };
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      adapty as unknown as AdaptyApiService,
    );
  });

  describe('setProFromClient', () => {
    const FUTURE = new Date(Date.now() + 30 * 24 * HOUR);
    const user = (over: Record<string, unknown> = {}) => ({
      isPro: false,
      proExpiresAt: null,
      paywallCohort: PaywallCohort.NEW,
      ...over,
    });
    const webhookReported = (yes: boolean) =>
      prisma.subscriptionEvent.findFirst.mockResolvedValue(
        yes ? { id: 'evt' } : null,
      );

    beforeEach(() => prisma.user.update.mockResolvedValue({}));

    it('trusts the app for legacy accounts without asking Adapty', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({ paywallCohort: PaywallCohort.LEGACY }),
      );
      webhookReported(true);

      await expect(service.setProFromClient(USER_ID, true)).resolves.toEqual({
        isPro: true,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: true },
      });
      expect(adapty.premiumStatus).not.toHaveBeenCalled();
    });

    it('trusts the app for legacy accounts turning Pro off', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({
          paywallCohort: PaywallCohort.LEGACY,
          isPro: true,
          proExpiresAt: FUTURE,
        }),
      );
      await service.setProFromClient(USER_ID, false);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: false },
      });
    });

    it('trusts the app for a new account the webhook has not reported yet', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      webhookReported(false);

      await service.setProFromClient(USER_ID, true);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: true },
      });
      expect(adapty.premiumStatus).not.toHaveBeenCalled();
    });

    it('drops a stale webhook expiry when trusting the app', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({
          paywallCohort: null,
          isPro: true,
          proExpiresAt: new Date(Date.now() - HOUR),
        }),
      );
      await service.setProFromClient(USER_ID, true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: true, proExpiresAt: null },
      });
    });

    it('does not unlock a forged isPro=true when Adapty has no active premium', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      webhookReported(true);
      adapty.premiumStatus.mockResolvedValue({
        active: false,
        expiresAt: null,
      });

      await expect(service.setProFromClient(USER_ID, true)).resolves.toEqual({
        isPro: false,
      });
      expect(adapty.premiumStatus).toHaveBeenCalledWith(USER_ID);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('applies isPro=true with the expiry Adapty confirms', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      webhookReported(true);
      adapty.premiumStatus.mockResolvedValue({
        active: true,
        expiresAt: FUTURE,
      });

      await expect(service.setProFromClient(USER_ID, true)).resolves.toEqual({
        isPro: true,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: true, proExpiresAt: FUTURE },
      });
    });

    it('falls back to trusting the app when Adapty is unreachable', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      webhookReported(true);
      adapty.premiumStatus.mockResolvedValue(null);

      await expect(service.setProFromClient(USER_ID, true)).resolves.toEqual({
        isPro: true,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: true },
      });
    });

    it('skips Adapty when the webhook already says Pro is active', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({ isPro: true, proExpiresAt: FUTURE }),
      );
      webhookReported(true);

      await expect(service.setProFromClient(USER_ID, true)).resolves.toEqual({
        isPro: true,
      });
      expect(adapty.premiumStatus).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ignores isPro=false while the webhook says Pro is active', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({ isPro: true, proExpiresAt: FUTURE }),
      );
      webhookReported(true);

      await expect(service.setProFromClient(USER_ID, false)).resolves.toEqual({
        isPro: true,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('applies isPro=false once the webhook expiry has passed', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({ isPro: true, proExpiresAt: new Date(Date.now() - HOUR) }),
      );
      webhookReported(true);

      await service.setProFromClient(USER_ID, false);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isPro: false },
      });
    });
  });

  describe('setCohort', () => {
    const user = (over: Record<string, unknown>) => ({
      paywallCohort: null,
      isPro: false,
      proExpiresAt: null,
      createdAt: new Date(),
      ...over,
    });

    it('rejects legacy → new', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({ paywallCohort: PaywallCohort.LEGACY }),
      );
      await expect(service.setCohort(USER_ID, 'new')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('keeps a new account new when the app reports legacy', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({ paywallCohort: PaywallCohort.NEW }),
      );
      await expect(service.setCohort(USER_ID, 'legacy')).resolves.toEqual({
        paywallCohort: 'new',
        access: 'locked',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lets a null-cohort account become legacy', async () => {
      prisma.user.findUnique.mockResolvedValue(user({}));
      await expect(service.setCohort(USER_ID, 'legacy')).resolves.toEqual({
        paywallCohort: 'legacy',
        access: 'full',
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { paywallCohort: PaywallCohort.LEGACY },
      });
    });

    it('lets a brand-new account without workouts join the new cohort', async () => {
      prisma.user.findUnique.mockResolvedValue(user({}));
      prisma.workout.count.mockResolvedValue(0);
      await expect(service.setCohort(USER_ID, 'new')).resolves.toEqual({
        paywallCohort: 'new',
        access: 'locked',
      });
    });

    it('keeps old null-cohort accounts out of the new cohort', async () => {
      prisma.user.findUnique.mockResolvedValue(
        user({ createdAt: new Date(Date.now() - 48 * HOUR) }),
      );
      prisma.workout.count.mockResolvedValue(0);
      await expect(service.setCohort(USER_ID, 'new')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('keeps null-cohort accounts with workouts out of the new cohort', async () => {
      prisma.user.findUnique.mockResolvedValue(user({}));
      prisma.workout.count.mockResolvedValue(3);
      await expect(service.setCohort(USER_ID, 'new')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('handleAdaptyEvent', () => {
    const event = (
      eventType: string,
      props: Record<string, unknown>,
      customerUserId: string | null = USER_UUID,
    ) => ({
      profile_id: 'adapty-profile',
      customer_user_id: customerUserId,
      event_type: eventType,
      event_datetime: '2026-11-05T12:00:00.000000+0000',
      event_properties: { profile_event_id: `evt-${eventType}`, ...props },
    });

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: USER_UUID });
      prisma.subscriptionEvent.create.mockResolvedValue({});
    });

    it('answers the dashboard handshake ({}) without storing anything', async () => {
      await expect(service.handleAdaptyEvent({})).resolves.toBe('handshake');
      expect(prisma.subscriptionEvent.create).not.toHaveBeenCalled();
    });

    it('stores trial_started and turns Pro on with the expiry', async () => {
      const outcome = await service.handleAdaptyEvent(
        event('trial_started', {
          vendor_product_id: 'pro_yearly_2499_t7',
          subscription_expires_at: '2026-11-12T12:00:00.000000+0000',
          profile_has_access_level: true,
          ab_test_name: 'hard_offer_r1_2026_11',
          variation_id: 'var-1',
          paywall_name: 'hard_trial7',
          environment: 'Sandbox',
        }),
      );
      expect(outcome).toBe('applied');
      expect(prisma.subscriptionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          profileEventId: 'evt-trial_started',
          userId: USER_UUID,
          eventType: 'trial_started',
          productId: 'pro_yearly_2499_t7',
          abTestName: 'hard_offer_r1_2026_11',
          paywallName: 'hard_trial7',
          environment: 'Sandbox',
        }),
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_UUID },
        data: {
          isPro: true,
          proExpiresAt: new Date('2026-11-12T12:00:00Z'),
        },
      });
    });

    it('turns Pro off on subscription_expired', async () => {
      await service.handleAdaptyEvent(
        event('subscription_expired', { profile_has_access_level: false }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_UUID },
        data: { isPro: false },
      });
    });

    it('applies access_level_updated for premium only', async () => {
      await service.handleAdaptyEvent(
        event('access_level_updated', {
          access_level_id: 'other',
          is_active: true,
        }),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();

      await service.handleAdaptyEvent(
        event('access_level_updated', {
          access_level_id: 'premium',
          is_active: false,
          expires_at: '2026-11-05T10:00:00.000000+0000',
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_UUID },
        data: { isPro: false, proExpiresAt: new Date('2026-11-05T10:00:00Z') },
      });
    });

    it('skips duplicates by profile_event_id', async () => {
      prisma.subscriptionEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.handleAdaptyEvent(
          event('trial_started', { profile_has_access_level: true }),
        ),
      ).resolves.toBe('duplicate');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('stores events of anonymous profiles without touching users', async () => {
      await expect(
        service.handleAdaptyEvent(
          event('trial_started', { profile_has_access_level: true }, null),
        ),
      ).resolves.toBe('stored');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
