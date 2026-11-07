import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PaywallCohort, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdaptyApiService } from './adapty-api.service.js';
import {
  ACCESS_SELECT,
  computeAccess,
  PREMIUM_ACCESS_LEVEL,
  type Access,
  type AccessFields,
} from './access.js';

/**
 * A NULL-cohort account may still become NEW right after sign-up (the app
 * reports the cohort after creating the account). Older accounts can't: they
 * belong to people who used the app before the hard paywall.
 */
export const NEW_COHORT_MAX_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

export type CohortValue = 'legacy' | 'new';

export interface CohortState {
  paywallCohort: CohortValue | null;
  access: Access;
}

/** Shape of an Adapty webhook body; every field is optional on purpose. */
export interface AdaptyWebhookEvent {
  profile_id?: string;
  customer_user_id?: string | null;
  event_type?: string;
  event_datetime?: string;
  event_properties?: Record<string, unknown>;
}

export type WebhookOutcome =
  | 'handshake'
  | 'duplicate'
  | 'stored'
  | 'applied'
  | 'ignored';

export function cohortToApi(c: PaywallCohort | null): CohortValue | null {
  if (c === PaywallCohort.LEGACY) return 'legacy';
  if (c === PaywallCohort.NEW) return 'new';
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pro per the stored (webhook) state, without the expiry grace period. */
function webhookSaysPro(user: AccessFields, now = Date.now()): boolean {
  if (!user.isPro) return false;
  return !user.proExpiresAt || user.proExpiresAt.getTime() > now;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapty: AdaptyApiService,
  ) {}

  /**
   * Sets the hard-paywall cohort. The account's cohort is final once set:
   * LEGACY never becomes NEW, and NEW never becomes LEGACY (a reinstall
   * leaves the session in the Keychain, so the device reports legacy — that
   * must not free a hard-paywall account). Only a NULL account changes: to
   * LEGACY always, to NEW only while it is brand new and has no workouts.
   */
  async setCohort(userId: string, cohort: CohortValue): Promise<CohortState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        paywallCohort: true,
        isPro: true,
        proExpiresAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    let next: PaywallCohort;
    if (user.paywallCohort === PaywallCohort.NEW) {
      next = PaywallCohort.NEW;
    } else if (cohort === 'legacy') {
      next = PaywallCohort.LEGACY;
    } else if (user.paywallCohort === PaywallCohort.LEGACY) {
      throw new ConflictException(
        'A legacy account cannot join the new cohort',
      );
    } else {
      const age = Date.now() - user.createdAt.getTime();
      const workouts = await this.prisma.workout.count({
        where: { userId, deletedAt: null },
      });
      if (age > NEW_COHORT_MAX_ACCOUNT_AGE_MS || workouts > 0) {
        throw new ConflictException(
          'An existing account cannot join the new cohort',
        );
      }
      next = PaywallCohort.NEW;
    }

    if (next !== user.paywallCohort) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { paywallCohort: next },
      });
    }
    return {
      paywallCohort: cohortToApi(next),
      access: computeAccess({ ...user, paywallCohort: next }),
    };
  }

  /**
   * Handles one Adapty webhook delivery. Never throws for bad or unknown
   * payloads: Adapty pauses delivery after repeated failures, so the
   * controller always answers 200.
   */
  async handleAdaptyEvent(event: AdaptyWebhookEvent): Promise<WebhookOutcome> {
    // Adapty sends `{}` when the webhook is saved in the dashboard.
    if (!event || typeof event !== 'object' || !event.event_type) {
      return 'handshake';
    }

    const props = event.event_properties ?? {};
    const profileEventId = str(props.profile_event_id);
    const customerUserId = str(event.customer_user_id);
    const userId =
      customerUserId && isUUID(customerUserId)
        ? ((
            await this.prisma.user.findUnique({
              where: { id: customerUserId },
              select: { id: true },
            })
          )?.id ?? null)
        : null;

    const expiresAt =
      parseDate(props.subscription_expires_at) ?? parseDate(props.expires_at);

    try {
      await this.prisma.subscriptionEvent.create({
        data: {
          profileEventId,
          userId,
          adaptyProfileId: str(event.profile_id),
          eventType: event.event_type,
          environment: str(props.environment),
          productId: str(props.vendor_product_id),
          expiresAt,
          abTestName: str(props.ab_test_name),
          variationId: str(props.variation_id),
          paywallName: str(props.paywall_name),
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return 'duplicate';
      }
      throw err;
    }

    if (!userId) {
      // Purchase before Adapty.identify, or an unknown user: kept for
      // analysis only. The app still reports Pro via PUT /users/me/pro.
      return 'stored';
    }

    const update = this.accessUpdate(event.event_type, props, expiresAt);
    if (!update) return 'stored';
    await this.prisma.user.update({ where: { id: userId }, data: update });
    return 'applied';
  }

  /**
   * `access_level_updated` is the authoritative snapshot of the premium level;
   * other events carry `profile_has_access_level`. Events without access info
   * change nothing.
   */
  private accessUpdate(
    eventType: string,
    props: Record<string, unknown>,
    expiresAt: Date | null,
  ): Prisma.UserUpdateInput | null {
    if (eventType === 'access_level_updated') {
      const level = str(props.access_level_id);
      if (level && level !== PREMIUM_ACCESS_LEVEL) return null;
      if (typeof props.is_active !== 'boolean') return null;
      return {
        isPro: props.is_active,
        proExpiresAt: props.is_lifetime === true ? null : expiresAt,
      };
    }
    if (typeof props.profile_has_access_level !== 'boolean') return null;
    return {
      isPro: props.profile_has_access_level,
      ...(expiresAt ? { proExpiresAt: expiresAt } : {}),
    };
  }

  /**
   * `PUT /users/me/pro`: the app reports its subscription state. For a
   * hard-paywall (NEW) account the Adapty webhook already reports for this
   * user, so the webhook wins over the client:
   *  - `isPro: true` is applied only if Adapty's server API confirms an
   *    active premium level (if Adapty can't answer, the claim is trusted
   *    and a warning logged — a paying user must not get locked out);
   *  - `isPro: false` is ignored while the webhook says Pro is active.
   * Legacy and null-cohort accounts, and NEW accounts the webhook hasn't
   * reported yet (purchase before Adapty.identify), keep trusting the app.
   */
  async setProFromClient(
    userId: string,
    isPro: boolean,
  ): Promise<{ isPro: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ACCESS_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');

    const webhookKnowsUser =
      user.paywallCohort === PaywallCohort.NEW &&
      !!(await this.prisma.subscriptionEvent.findFirst({
        where: { userId },
        select: { id: true },
      }));
    if (!webhookKnowsUser) return this.applyClientPro(userId, isPro, user);

    const webhookActive = webhookSaysPro(user);
    if (!isPro) {
      if (webhookActive) {
        this.logger.warn(
          `Ignored isPro=false from the app for ${userId}: webhook says Pro is active`,
        );
        return { isPro: true };
      }
      return this.applyClientPro(userId, false, user);
    }
    if (webhookActive) return { isPro: true };

    const premium = await this.adapty.premiumStatus(userId);
    if (!premium) {
      this.logger.warn(
        `Could not verify isPro=true for ${userId} with Adapty` +
          (this.adapty.isConfigured ? '' : ' (ADAPTY_SECRET_KEY not set)') +
          '; trusting the app',
      );
      return this.applyClientPro(userId, true, user);
    }
    if (!premium.active) {
      this.logger.warn(
        `Rejected isPro=true from the app for ${userId}: Adapty has no active premium`,
      );
      return { isPro: false };
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPro: true, proExpiresAt: premium.expiresAt },
    });
    return { isPro: true };
  }

  /** Pre-webhook behaviour: the app's word is taken as is. */
  private async applyClientPro(
    userId: string,
    isPro: boolean,
    user: AccessFields,
  ): Promise<{ isPro: boolean }> {
    // The app reads the live Adapty profile, so "Pro now" beats an expiry
    // date that a missed renewal webhook left in the past.
    const staleExpiry =
      isPro && !!user.proExpiresAt && user.proExpiresAt.getTime() < Date.now();
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPro, ...(staleExpiry ? { proExpiresAt: null } : {}) },
    });
    return { isPro };
  }

  /** Current access for a user (MCP connector, RequiresAccessGuard). */
  async accessFor(userId: string): Promise<Access> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ACCESS_SELECT,
    });
    return user ? computeAccess(user) : 'full';
  }
}
