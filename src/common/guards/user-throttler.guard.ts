import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  ConnectorAuthGuard,
  type ConnectorRequest,
} from './connector-auth.guard.js';

/**
 * Rate-limits per user instead of per IP wherever the caller can be
 * identified. AI-connector traffic (Claude, ChatGPT) arrives from a handful
 * of shared provider IPs, so IP buckets would let one busy user throttle
 * everyone else.
 *
 * Runs after the global JwtAuthGuard, so first-party routes already have
 * req.user. Connector routes are @Public and authenticate in a controller
 * guard that runs later — for those we resolve the bearer token here (the
 * result is cached on the request, so ConnectorAuthGuard doesn't repeat the
 * lookup). Invalid or missing tokens fall back to the client IP, so a junk
 * bearer can't buy a fresh bucket.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly connectorAuth: ConnectorAuthGuard,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: ConnectorRequest): Promise<string> {
    if (!req.user && req.headers?.authorization) {
      await this.connectorAuth.authenticate(req);
    }
    if (req.user?.id) return `user:${req.user.id}`;
    return req.ip ?? 'unknown';
  }
}
