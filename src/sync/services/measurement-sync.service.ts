import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MeasurementPushDto } from '../dto/sync-push.dto.js';
import { PushResult } from '../interfaces/push-result.interface.js';
import { StorageService, photoKey } from '../../storage/storage.service.js';

@Injectable()
export class MeasurementSyncService {
  private readonly logger = new Logger(MeasurementSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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

        if (m.photo) {
          const photo = await this.prisma.photo.findUnique({
            where: { id: m.photo.id },
            select: { userId: true },
          });
          if (photo && photo.userId !== userId) {
            result.rejected.push({ id: m.id, reason: 'forbidden' });
            continue;
          }
        }

        // undefined = client predates photos: leave photoId untouched
        const photoId =
          m.photo === undefined ? undefined : (m.photo?.id ?? null);
        let orphanedPhotoId: string | null = null;

        await this.prisma.$transaction(async (tx) => {
          if (m.photo) {
            // Several measurements saved together share one photo row.
            await tx.photo.upsert({
              where: { id: m.photo.id },
              create: {
                id: m.photo.id,
                userId,
                width: m.photo.width,
                height: m.photo.height,
              },
              update: { width: m.photo.width, height: m.photo.height },
            });
          }

          await tx.bodyMeasurement.upsert({
            where: { id: m.id },
            create: {
              id: m.id,
              userId,
              date: new Date(m.date),
              type: m.type as any,
              value: m.value,
              photoUrl: m.photoUrl || null,
              photoId: photoId ?? null,
              deletedAt: m.deletedAt ? new Date(m.deletedAt) : null,
            },
            update: {
              date: new Date(m.date),
              type: m.type as any,
              value: m.value,
              photoUrl: m.photoUrl || null,
              ...(photoId !== undefined ? { photoId } : {}),
              deletedAt: m.deletedAt ? new Date(m.deletedAt) : null,
            },
          });

          const oldPhotoId = existing?.photoId;
          if (photoId !== undefined && oldPhotoId && oldPhotoId !== photoId) {
            orphanedPhotoId = await this.deleteIfOrphaned(tx, oldPhotoId);
          }
        });

        if (orphanedPhotoId) {
          await this.storage.deleteQuietly([photoKey(userId, orphanedPhotoId)]);
        }

        result.accepted.push(m.id);
      } catch (error) {
        this.logger.error(`Failed to push measurement ${m.id}`, error);
        result.rejected.push({ id: m.id, reason: 'error' });
      }
    }

    return result;
  }

  /**
   * Deletes a progress photo nothing references any more (no measurement,
   * no workout). Returns its id if deleted, so the object can be removed
   * after the transaction commits.
   */
  private async deleteIfOrphaned(
    tx: Prisma.TransactionClient,
    photoId: string,
  ): Promise<string | null> {
    const references = await tx.bodyMeasurement.count({ where: { photoId } });
    if (references > 0) return null;
    const { count } = await tx.photo.deleteMany({
      where: { id: photoId, workoutId: null },
    });
    return count > 0 ? photoId : null;
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
    const page = hasMore ? measurements.slice(0, limit) : measurements;

    const photoIds = [
      ...new Set(page.map((m) => m.photoId).filter((id) => id != null)),
    ];
    const photos = new Map(
      (photoIds.length
        ? await this.prisma.photo.findMany({
            where: { id: { in: photoIds }, userId },
          })
        : []
      ).map((p) => [p.id, p]),
    );
    const data = page.map(({ photoId, ...m }) => {
      const photo = photoId ? photos.get(photoId) : undefined;
      return {
        ...m,
        photo: photo
          ? {
              id: photo.id,
              width: photo.width,
              height: photo.height,
              uploaded: photo.uploadedAt != null,
            }
          : null,
      };
    });
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
