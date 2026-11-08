import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service.js';

export const SUBSCRIPTION_REQUIRED_ERROR = 'subscription_required';

/** 402 for hard-paywall users without an active subscription. */
export class SubscriptionRequiredException extends HttpException {
  constructor() {
    super(
      {
        error: SUBSCRIPTION_REQUIRED_ERROR,
        message:
          'A Wolog Pro subscription is required to make changes. Subscribe in the Wolog iOS app; your history stays available read-only.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Rejects writes (402) from users whose `access` is `locked`. Reads, sync
 * and photos stay open — never put this on those routes, or the app loses
 * data. Runs after authentication: needs `req.user.id` from the global
 * JwtAuthGuard or ConnectorAuthGuard, and fails closed without it.
 */
@Injectable()
export class RequiresAccessGuard implements CanActivate {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    if ((await this.subscriptions.accessFor(userId)) === 'locked') {
      throw new SubscriptionRequiredException();
    }
    return true;
  }
}

/**
 * Marks a write endpoint as closed to locked (hard-paywall, unpaid) users.
 * Guards run in declaration order, so on a method that also has
 * `@UseGuards(ConnectorAuthGuard)` put `@RequiresAccess()` ABOVE it.
 */
export const RequiresAccess = () => UseGuards(RequiresAccessGuard);
