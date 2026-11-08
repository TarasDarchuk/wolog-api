import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PREMIUM_ACCESS_LEVEL } from './access.js';

export const ADAPTY_PROFILE_URL =
  'https://api.adapty.io/api/v2/server-side-api/profile/';
const TIMEOUT_MS = 5000;

/** Premium access level as Adapty's server API sees it right now. */
export interface AdaptyPremium {
  active: boolean;
  /** null = lifetime (or inactive without a date). */
  expiresAt: Date | null;
}

interface AdaptyAccessLevel {
  access_level_id?: string;
  expires_at?: string | null;
  is_lifetime?: boolean;
}

interface AdaptyProfileResponse {
  data?: { access_levels?: AdaptyAccessLevel[] };
  error_code?: string;
}

/**
 * Adapty server-side API (secret key, `ADAPTY_SECRET_KEY`). Used to check a
 * client's "I'm Pro" claim against Adapty instead of trusting it.
 */
@Injectable()
export class AdaptyApiService {
  private readonly logger = new Logger(AdaptyApiService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return !!this.config.get<string>('ADAPTY_SECRET_KEY');
  }

  /**
   * Premium status of the profile identified with `customerUserId` (the
   * Wolog user id). Returns null when Adapty can't answer — no key, network
   * error, timeout, unexpected status — so the caller can fall back.
   * An unknown profile is a definite answer: no access.
   */
  async premiumStatus(customerUserId: string): Promise<AdaptyPremium | null> {
    const key = this.config.get<string>('ADAPTY_SECRET_KEY');
    if (!key) return null;

    let res: Response;
    try {
      res = await fetch(ADAPTY_PROFILE_URL, {
        headers: {
          Authorization: `Api-Key ${key}`,
          'adapty-customer-user-id': customerUserId,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `Adapty profile lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const body = (await res
      .json()
      .catch(() => null)) as AdaptyProfileResponse | null;
    if (!res.ok) {
      if (body?.error_code === 'profile_does_not_exist') {
        return { active: false, expiresAt: null };
      }
      this.logger.warn(`Adapty profile lookup returned HTTP ${res.status}`);
      return null;
    }

    const level = body?.data?.access_levels?.find(
      (l) => l.access_level_id === PREMIUM_ACCESS_LEVEL,
    );
    if (!level) return { active: false, expiresAt: null };

    const expiresAt = level.expires_at ? new Date(level.expires_at) : null;
    if (level.is_lifetime === true || !level.expires_at) {
      return { active: true, expiresAt: null };
    }
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      this.logger.warn('Adapty premium level has an unreadable expires_at');
      return null;
    }
    return { active: expiresAt.getTime() > Date.now(), expiresAt };
  }
}
