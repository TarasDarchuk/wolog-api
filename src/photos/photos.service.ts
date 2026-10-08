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
  workoutPhotoKey,
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
        workoutPhotoKey(userId, photoId),
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
      this.storage.head(workoutPhotoKey(userId, photoId)),
    );
    if (!object) {
      throw new ConflictException('Photo has not been uploaded yet');
    }

    await this.prisma.$transaction(async (tx) => {
      // Guarded on uploadedAt so concurrent completes bump only once.
      const { count } = await tx.workoutPhoto.updateMany({
        where: { id: photoId, uploadedAt: null },
        data: { uploadedAt: new Date(), byteSize: object.contentLength },
      });
      if (count > 0) {
        // Other devices re-pull the workout and see `uploaded: true`.
        await tx.workout.update({
          where: { id: photo.workoutId },
          data: { updatedAt: new Date() },
        });
      }
    });
  }

  async createDownloadUrl(userId: string, photoId: string) {
    const photo = await this.findOwnedPhoto(userId, photoId);
    if (!photo.uploadedAt) throw new NotFoundException('Photo not found');
    const url = await this.withStorage(() =>
      this.storage.presignGet(workoutPhotoKey(userId, photoId)),
    );
    return { url };
  }

  /**
   * Deletes photo rows whose bytes never arrived. Gated on the workout's
   * updatedAt as well, because createdAt is a client value: a photo taken
   * offline long ago and pushed just now must get its chance to upload.
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async cleanupAbandonedUploads() {
    const cutoff = new Date(
      Date.now() - ABANDONED_UPLOAD_DAYS * 24 * 60 * 60 * 1000,
    );
    const abandoned = await this.prisma.workoutPhoto.findMany({
      where: {
        uploadedAt: null,
        createdAt: { lt: cutoff },
        workout: { updatedAt: { lt: cutoff } },
      },
      select: { id: true, workout: { select: { userId: true } } },
    });
    if (!abandoned.length) return { deleted: 0 };

    const ids = abandoned.map((p) => p.id);
    const { count } = await this.prisma.workoutPhoto.deleteMany({
      where: { id: { in: ids }, uploadedAt: null },
    });
    // Skip any photo completed between the two queries.
    const survivors = new Set(
      (
        await this.prisma.workoutPhoto.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    // Partial uploads may have left an object behind.
    await this.storage.deleteQuietly(
      abandoned
        .filter((p) => !survivors.has(p.id))
        .map((p) => workoutPhotoKey(p.workout.userId, p.id)),
    );
    this.logger.log(`Cleaned up ${count} abandoned photo upload(s)`);
    return { deleted: count };
  }

  /**
   * 404 both when the photo doesn't exist and when its workout belongs to
   * someone else — the client treats 404 as "server never got this photo's
   * metadata" and re-pushes the workout.
   */
  private async findOwnedPhoto(userId: string, photoId: string) {
    const photo = await this.prisma.workoutPhoto.findFirst({
      where: { id: photoId, workout: { userId } },
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
