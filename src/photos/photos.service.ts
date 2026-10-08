import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  StorageNotConfiguredError,
  StorageService,
  photoKey,
} from '../storage/storage.service.js';
import { PhotoUploadUrlDto } from './dto/upload-url.dto.js';

const ABANDONED_UPLOAD_DAYS = 7;

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createUploadUrl(
    userId: string,
    photoId: string,
    dto: PhotoUploadUrlDto,
  ) {
    await this.findOwnedPhoto(userId, photoId);
    const { url, headers } = await this.withStorage(() =>
      this.storage.presignPut(
        photoKey(userId, photoId),
        dto.contentType,
        dto.byteSize,
      ),
    );
    return { uploadUrl: url, headers };
  }

  async complete(userId: string, photoId: string): Promise<void> {
    const photo = await this.findOwnedPhoto(userId, photoId);
    if (photo.uploadedAt) return;

    const object = await this.withStorage(() =>
      this.storage.head(photoKey(userId, photoId)),
    );
    if (!object) {
      throw new ConflictException('Photo has not been uploaded yet');
    }

    await this.prisma.$transaction(async (tx) => {
      // Guarded on uploadedAt so concurrent completes bump only once.
      const { count } = await tx.photo.updateMany({
        where: { id: photoId, uploadedAt: null },
        data: { uploadedAt: new Date(), byteSize: object.contentLength },
      });
      if (count === 0) return;
      // Bump the owner so other devices re-pull it and see `uploaded: true`.
      if (photo.workoutId) {
        await tx.workout.update({
          where: { id: photo.workoutId },
          data: { updatedAt: new Date() },
        });
      } else {
        await tx.bodyMeasurement.updateMany({
          where: { userId, photoId },
          data: { updatedAt: new Date() },
        });
      }
    });
  }

  async createDownloadUrl(userId: string, photoId: string) {
    const photo = await this.findOwnedPhoto(userId, photoId);
    if (!photo.uploadedAt) throw new NotFoundException('Photo not found');
    const url = await this.withStorage(() =>
      this.storage.presignGet(photoKey(userId, photoId)),
    );
    return { url };
  }

  /**
   * Deletes photo rows whose bytes never arrived. Also gated on the owner's
   * updatedAt: a workout photo's createdAt is a client value, so a photo
   * taken offline long ago and pushed just now must get its chance to
   * upload; likewise for a measurement that was just re-pushed. If the
   * device uploads later anyway, upload-url 404s and it re-pushes the owner.
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async cleanupAbandonedUploads() {
    const cutoff = new Date(
      Date.now() - ABANDONED_UPLOAD_DAYS * 24 * 60 * 60 * 1000,
    );
    const candidates = await this.prisma.photo.findMany({
      where: {
        uploadedAt: null,
        createdAt: { lt: cutoff },
        OR: [{ workoutId: null }, { workout: { updatedAt: { lt: cutoff } } }],
      },
      select: { id: true, userId: true, workoutId: true },
    });
    // Measurement photos have no FK to their owners — check them separately.
    const measurementPhotoIds = candidates
      .filter((p) => !p.workoutId)
      .map((p) => p.id);
    const recentlyTouched = new Set(
      measurementPhotoIds.length
        ? (
            await this.prisma.bodyMeasurement.findMany({
              where: {
                photoId: { in: measurementPhotoIds },
                updatedAt: { gte: cutoff },
              },
              select: { photoId: true },
            })
          ).map((m) => m.photoId)
        : [],
    );
    const abandoned = candidates.filter((p) => !recentlyTouched.has(p.id));
    if (!abandoned.length) return { deleted: 0 };

    const ids = abandoned.map((p) => p.id);
    const { count } = await this.prisma.photo.deleteMany({
      where: { id: { in: ids }, uploadedAt: null },
    });
    // Skip any photo completed between the two queries.
    const survivors = new Set(
      (
        await this.prisma.photo.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    // Partial uploads may have left an object behind.
    await this.storage.deleteQuietly(
      abandoned
        .filter((p) => !survivors.has(p.id))
        .map((p) => photoKey(p.userId, p.id)),
    );
    this.logger.log(`Cleaned up ${count} abandoned photo upload(s)`);
    return { deleted: count };
  }

  /**
   * 404 both when the photo doesn't exist and when it belongs to someone
   * else — the client treats 404 as "server never got this photo's
   * metadata" and re-pushes the owner.
   */
  private async findOwnedPhoto(userId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, userId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    return photo;
  }

  private async withStorage<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        throw new ServiceUnavailableException('Photo storage unavailable');
      }
      throw error;
    }
  }
}
