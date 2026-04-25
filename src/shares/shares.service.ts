import {
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateShareDto } from './dto/create-share.dto.js';

const SHARE_ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const SHARE_ID_LENGTH = 10;
const RATE_LIMIT_PER_24H = 30;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BASE_URL = 'https://wolog.app/s/';
const SHARE_CLEANUP_GRACE_DAYS = 7;
const DEFAULT_TTL_DAYS = 90;
const MAX_PAYLOAD_BYTES = 256 * 1024;

export class ShareRateLimitedException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Share creation rate limit exceeded',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class SharesService {
  private readonly logger = new Logger(SharesService.name);
  private readonly defaultTtlDays: number;
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const raw = config.get<string>('SHARE_DEFAULT_TTL_DAYS');
    const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      this.defaultTtlDays = parsed;
    } else {
      if (raw !== undefined) {
        this.logger.warn(
          `SHARE_DEFAULT_TTL_DAYS=${raw} is invalid; falling back to ${DEFAULT_TTL_DAYS}`,
        );
      }
      this.defaultTtlDays = DEFAULT_TTL_DAYS;
    }

    const baseUrl = config.get<string>('SHARE_BASE_URL') ?? DEFAULT_BASE_URL;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  async create(userId: string, dto: CreateShareDto) {
    const serialized = JSON.stringify(dto);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `Share payload exceeds ${MAX_PAYLOAD_BYTES} bytes`,
      );
    }

    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.prisma.share.count({
      where: { ownerUserId: userId, createdAt: { gte: windowStart } },
    });

    if (recentCount >= RATE_LIMIT_PER_24H) {
      const oldestInWindow = await this.prisma.share.findFirst({
        where: { ownerUserId: userId, createdAt: { gte: windowStart } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const retryAfterSeconds = oldestInWindow
        ? Math.max(
            1,
            Math.ceil(
              (oldestInWindow.createdAt.getTime() +
                RATE_LIMIT_WINDOW_MS -
                Date.now()) /
                1000,
            ),
          )
        : Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

      throw new ShareRateLimitedException(retryAfterSeconds);
    }

    const id = this.generateId();
    const expiresAt = new Date(
      Date.now() + this.defaultTtlDays * 24 * 60 * 60 * 1000,
    );

    const share = await this.prisma.share.create({
      data: {
        id,
        ownerUserId: userId,
        payloadJson: dto as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });

    this.logger.log(
      `Share created share_id=${share.id} owner_user_id=${userId}`,
    );

    return {
      id: share.id,
      expiresAt: share.expiresAt.toISOString(),
      url: `${this.baseUrl}${share.id}`,
    };
  }

  async fetch(id: string) {
    const share = await this.prisma.share.findUnique({ where: { id } });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    if (share.expiresAt.getTime() <= Date.now()) {
      this.logger.log(
        `Share fetch (expired) share_id=${share.id} owner_user_id=${share.ownerUserId}`,
      );
      throw new GoneException('Share has expired');
    }

    this.logger.log(
      `Share fetched share_id=${share.id} owner_user_id=${share.ownerUserId}`,
    );

    return {
      id: share.id,
      payload: share.payloadJson,
      createdAt: share.createdAt.toISOString(),
      expiresAt: share.expiresAt.toISOString(),
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupExpired() {
    const cutoff = new Date(
      Date.now() - SHARE_CLEANUP_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
    const { count } = await this.prisma.share.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired share(s)`);
    }
    return { deleted: count };
  }

  private generateId(): string {
    const bytes = randomBytes(SHARE_ID_LENGTH);
    let id = '';
    for (let i = 0; i < SHARE_ID_LENGTH; i++) {
      id += SHARE_ID_ALPHABET[bytes[i] % SHARE_ID_ALPHABET.length];
    }
    return id;
  }
}
