import { PaywallCohort } from '../generated/prisma/client.js';

/**
 * Grace after `proExpiresAt` before a hard-paywall user is locked. Covers a
 * renewal webhook that arrives late (Adapty retries for up to 24 h).
 */
export const PRO_EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

/** Adapty access level that unlocks Pro (see SubscriptionManager on iOS). */
export const PREMIUM_ACCESS_LEVEL = 'premium';

export type Access = 'full' | 'locked';

export interface AccessFields {
  isPro: boolean;
  proExpiresAt: Date | null;
  paywallCohort: PaywallCohort | null;
}

export function hasActivePro(user: AccessFields, now = new Date()): boolean {
  if (!user.isPro) return false;
  if (!user.proExpiresAt) return true;
  return user.proExpiresAt.getTime() + PRO_EXPIRY_GRACE_MS > now.getTime();
}

/**
 * `locked` only for hard-paywall (NEW) users without an active subscription.
 * Legacy and null-cohort accounts always keep full (free-tier) access.
 */
export function computeAccess(user: AccessFields, now = new Date()): Access {
  if (user.paywallCohort !== PaywallCohort.NEW) return 'full';
  return hasActivePro(user, now) ? 'full' : 'locked';
}

export const ACCESS_SELECT = {
  isPro: true,
  proExpiresAt: true,
  paywallCohort: true,
} as const;
