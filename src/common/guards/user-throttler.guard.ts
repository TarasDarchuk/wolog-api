import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 *
 * The web app (my.wolog.app) calls the API from its own servers, so every
 * web user would share the BFF's IP. The BFF forwards the browser's IP in
 * X-Wolog-Client-IP, trusted only alongside the shared BFF_SHARED_SECRET.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly connectorAuth: ConnectorAuthGuard,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: ConnectorRequest): Promise<string> {
    if (!req.user && req.headers?.authorization) {
      await this.connectorAuth.authenticate(req);
    }
    if (req.user?.id) return `user:${req.user.id}`;
    return this.bffClientIp(req) ?? req.ip ?? 'unknown';
  }

  private bffClientIp(req: ConnectorRequest): string | null {
    const secret = this.config.get<string>('BFF_SHARED_SECRET');
    const sent = req.headers?.['x-wolog-bff-secret'];
    const ip = req.headers?.['x-wolog-client-ip'];
    if (!secret || typeof sent !== 'string' || typeof ip !== 'string' || !ip) {
      return null;
    }
    const a = Buffer.from(sent);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return `bff:${ip}`;
  }
}
