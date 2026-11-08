import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import {
  SubscriptionsService,
  type AdaptyWebhookEvent,
} from './subscriptions.service.js';

function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Adapty server-to-server webhook (Integrations → Webhook). The dashboard's
 * "Authorization header value" must equal ADAPTY_WEBHOOK_SECRET; sandbox and
 * production endpoints each get their own server, so one secret per server.
 */
@Public()
@SkipThrottle()
@Controller('webhooks')
export class AdaptyWebhookController {
  private readonly logger = new Logger(AdaptyWebhookController.name);

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  @Post('adapty')
  @HttpCode(200)
  async adapty(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: AdaptyWebhookEvent,
  ): Promise<Record<string, never>> {
    const secret = this.config.get<string>('ADAPTY_WEBHOOK_SECRET');
    if (!secret || !secretMatches(authorization, secret)) {
      throw new UnauthorizedException();
    }
    try {
      const outcome = await this.subscriptions.handleAdaptyEvent(body);
      this.logger.log(`Adapty ${body?.event_type ?? 'handshake'}: ${outcome}`);
    } catch (err) {
      // Answer 200 anyway: Adapty pauses delivery after repeated failures.
      this.logger.error('Adapty webhook failed', err);
    }
    return {};
  }
}
