import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FolderPushDto } from '../dto/sync-push.dto.js';
import { PushResult } from '../interfaces/push-result.interface.js';

@Injectable()
export class FolderSyncService {
  private readonly logger = new Logger(FolderSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async push(userId: string, folders: FolderPushDto[]): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };

    for (const f of folders) {
      try {
        const existing = await this.prisma.routineFolder.findUnique({
          where: { id: f.id },
        });

        const clientUpdatedAt = new Date(f.updatedAt);

        if (existing && existing.userId !== userId) {
          result.rejected.push({ id: f.id, reason: 'forbidden' });
          continue;
        }

        if (existing && existing.updatedAt > clientUpdatedAt) {
          result.rejected.push({ id: f.id, reason: 'server_newer' });
          continue;
        }

        await this.prisma.routineFolder.upsert({
          where: { id: f.id },
          create: {
            id: f.id,
            userId,
            name: f.name,
            sortOrder: f.sortOrder,
            createdAt: new Date(f.createdAt),
            deletedAt: f.deletedAt ? new Date(f.deletedAt) : null,
          },
          update: {
            name: f.name,
            sortOrder: f.sortOrder,
            deletedAt: f.deletedAt ? new Date(f.deletedAt) : null,
          },
        });

        result.accepted.push(f.id);
      } catch (error) {
        this.logger.error(`Failed to push folder ${f.id}`, error);
        result.rejected.push({ id: f.id, reason: 'error' });
      }
    }

    return result;
  }

  async pull(userId: string, since: string | undefined, limit: number) {
    const where: Prisma.RoutineFolderWhereInput = {
      userId,
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    };

    const folders = await this.prisma.routineFolder.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      take: limit + 1,
    });

    const hasMore = folders.length > limit;
    const data = hasMore ? folders.slice(0, limit) : folders;
    const cursor =
      data.length > 0
        ? data[data.length - 1].updatedAt.toISOString()
        : since || null;

    return { data, cursor, hasMore };
  }

  async getLatestTimestamp(userId: string): Promise<string | null> {
    const latest = await this.prisma.routineFolder.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return latest?.updatedAt.toISOString() || null;
  }
}
