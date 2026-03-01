import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MeasurementPushDto } from '../dto/sync-push.dto.js';
import { PushResult } from '../interfaces/push-result.interface.js';

@Injectable()
export class MeasurementSyncService {
  private readonly logger = new Logger(MeasurementSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async push(
    userId: string,
    measurements: MeasurementPushDto[],
  ): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };

    for (const m of measurements) {
      try {
        const existing = await this.prisma.bodyMeasurement.findUnique({
          where: { id: m.id },
        });

        const clientUpdatedAt = new Date(m.updatedAt);

        if (existing && existing.userId !== userId) {
          result.rejected.push({ id: m.id, reason: 'forbidden' });
          continue;
        }

        if (existing && existing.updatedAt > clientUpdatedAt) {
          result.rejected.push({ id: m.id, reason: 'server_newer' });
          continue;
        }

        await this.prisma.bodyMeasurement.upsert({
          where: { id: m.id },
          create: {
            id: m.id,
            userId,
            date: new Date(m.date),
            type: m.type as any,
            value: m.value,
            photoUrl: m.photoUrl || null,
            deletedAt: m.deletedAt ? new Date(m.deletedAt) : null,
          },
          update: {
            date: new Date(m.date),
            type: m.type as any,
            value: m.value,
            photoUrl: m.photoUrl || null,
            deletedAt: m.deletedAt ? new Date(m.deletedAt) : null,
          },
        });

        result.accepted.push(m.id);
      } catch (error) {
        this.logger.error(`Failed to push measurement ${m.id}`, error);
        result.rejected.push({ id: m.id, reason: 'error' });
      }
    }

    return result;
  }

  async pull(userId: string, since: string | undefined, limit: number) {
    const where: Prisma.BodyMeasurementWhereInput = {
      userId,
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    };

    const measurements = await this.prisma.bodyMeasurement.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: limit + 1,
    });

    const hasMore = measurements.length > limit;
    const data = hasMore ? measurements.slice(0, limit) : measurements;
    const cursor =
      data.length > 0
        ? data[data.length - 1].updatedAt.toISOString()
        : since || null;

    return { data, cursor, hasMore };
  }

  async getLatestTimestamp(userId: string): Promise<string | null> {
    const latest = await this.prisma.bodyMeasurement.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return latest?.updatedAt.toISOString() || null;
  }
}
