import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  StorageNotConfiguredError,
  StorageService,
} from '../storage/storage.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import {
  createMockPrismaService,
  createMockStorageService,
  MockPrismaService,
  MockStorageService,
  USER_ID,
  NOW,
  PAST,
} from '../__mocks__/prisma.mock';

const PHOTO_ID = '11111111-1111-4111-8111-111111111111';
const KEY = `photos/${USER_ID}/${PHOTO_ID}.jpg`;

function makePhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: PHOTO_ID,
    userId: USER_ID,
    workoutId: 'workout-1',
    sortOrder: 0,
    width: 1536,
    height: 2048,
    createdAt: new Date(PAST),
    uploadedAt: null,
    byteSize: null,
    ...overrides,
  };
}

/**
 * Runs the real controller + service over HTTP with the production
 * ValidationPipe settings; Prisma and storage are mocked.
 */
describe('PhotosController (HTTP)', () => {
  let app: INestApplication;
  let prisma: MockPrismaService;
  let storage: MockStorageService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();

    const moduleRef = await Test.createTestingModule({
      controllers: [PhotosController],
      providers: [
        PhotosService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { id: USER_ID };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires auth on every route', () => {
    const reflector = new Reflector();
    for (const handler of [
      PhotosController.prototype.uploadUrl,
      PhotosController.prototype.complete,
      PhotosController.prototype.downloadUrl,
    ]) {
      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
    }
  });

  it('scopes every photo lookup to the caller', async () => {
    prisma.photo.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post(`/photos/${PHOTO_ID}/complete`)
      .expect(404);

    expect(prisma.photo.findFirst).toHaveBeenCalledWith({
      where: { id: PHOTO_ID, userId: USER_ID },
    });
  });

  // ─── upload-url ─────────────────────────────────────────────────────────

  describe('POST /photos/:id/upload-url', () => {
    const body = { contentType: 'image/jpeg', byteSize: 412345 };

    it('returns a presigned PUT with its signed headers', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());
      storage.presignPut.mockResolvedValue({
        url: 'https://bucket.example/put',
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '412345' },
      });

      const res = await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/upload-url`)
        .send(body)
        .expect(200);

      expect(res.body).toEqual({
        uploadUrl: 'https://bucket.example/put',
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '412345' },
      });
      expect(storage.presignPut).toHaveBeenCalledWith(
        KEY,
        'image/jpeg',
        412345,
      );
    });

    it('404s for an unknown or foreign photo and creates nothing', async () => {
      prisma.photo.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/upload-url`)
        .send(body)
        .expect(404);

      expect(storage.presignPut).not.toHaveBeenCalled();
      expect(prisma.photo.create).not.toHaveBeenCalled();
      expect(prisma.photo.upsert).not.toHaveBeenCalled();
    });

    it('404s for a malformed id', async () => {
      await request(app.getHttpServer())
        .post('/photos/not-a-uuid/upload-url')
        .send(body)
        .expect(404);
    });

    it.each([
      ['non-JPEG content type', { contentType: 'image/png', byteSize: 1000 }],
      [
        'byteSize over 10 MB',
        { contentType: 'image/jpeg', byteSize: 10 * 1024 * 1024 + 1 },
      ],
      ['zero byteSize', { contentType: 'image/jpeg', byteSize: 0 }],
      ['missing byteSize', { contentType: 'image/jpeg' }],
      ['unknown field', { ...body, foo: 1 }],
    ])('400s for %s', async (_name, badBody) => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/upload-url`)
        .send(badBody)
        .expect(400);

      expect(storage.presignPut).not.toHaveBeenCalled();
    });

    it('accepts exactly 10 MB', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());
      storage.presignPut.mockResolvedValue({ url: 'u', headers: {} });

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/upload-url`)
        .send({ contentType: 'image/jpeg', byteSize: 10 * 1024 * 1024 })
        .expect(200);
    });

    it('503s when storage is not configured', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());
      storage.presignPut.mockRejectedValue(new StorageNotConfiguredError());

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/upload-url`)
        .send(body)
        .expect(503);
    });
  });

  // ─── complete ───────────────────────────────────────────────────────────

  describe('POST /photos/:id/complete', () => {
    it('marks the photo uploaded and bumps the workout updatedAt', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());
      storage.head.mockResolvedValue({ contentLength: 412345 });
      prisma.photo.updateMany.mockResolvedValue({ count: 1 });
      prisma.workout.update.mockResolvedValue({});

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/complete`)
        .expect(204);

      expect(storage.head).toHaveBeenCalledWith(KEY);
      expect(prisma.photo.updateMany).toHaveBeenCalledWith({
        where: { id: PHOTO_ID, uploadedAt: null },
        data: { uploadedAt: expect.any(Date), byteSize: 412345 },
      });
      expect(prisma.workout.update).toHaveBeenCalledWith({
        where: { id: 'workout-1' },
        data: { updatedAt: expect.any(Date) },
      });
    });

    it('bumps every measurement sharing a progress photo', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto({ workoutId: null }));
      storage.head.mockResolvedValue({ contentLength: 512000 });
      prisma.photo.updateMany.mockResolvedValue({ count: 1 });
      prisma.bodyMeasurement.updateMany.mockResolvedValue({ count: 2 });

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/complete`)
        .expect(204);

      expect(prisma.bodyMeasurement.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, photoId: PHOTO_ID },
        data: { updatedAt: expect.any(Date) },
      });
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('409s when the object is not in storage', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());
      storage.head.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/complete`)
        .expect(409);

      expect(prisma.photo.updateMany).not.toHaveBeenCalled();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('is idempotent: already uploaded → 204 without bumping', async () => {
      prisma.photo.findFirst.mockResolvedValue(
        makePhoto({ uploadedAt: new Date(NOW), byteSize: 412345 }),
      );

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/complete`)
        .expect(204);

      expect(storage.head).not.toHaveBeenCalled();
      expect(prisma.photo.updateMany).not.toHaveBeenCalled();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('does not bump when a concurrent complete won the race', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());
      storage.head.mockResolvedValue({ contentLength: 412345 });
      prisma.photo.updateMany.mockResolvedValue({ count: 0 });

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/complete`)
        .expect(204);

      expect(prisma.workout.update).not.toHaveBeenCalled();
      expect(prisma.bodyMeasurement.updateMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown or foreign photo', async () => {
      prisma.photo.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post(`/photos/${PHOTO_ID}/complete`)
        .expect(404);

      expect(storage.head).not.toHaveBeenCalled();
    });
  });

  // ─── download-url ───────────────────────────────────────────────────────

  describe('GET /photos/:id/download-url', () => {
    it('returns a presigned GET for an uploaded photo', async () => {
      prisma.photo.findFirst.mockResolvedValue(
        makePhoto({ uploadedAt: new Date(NOW) }),
      );
      storage.presignGet.mockResolvedValue('https://bucket.example/get');

      const res = await request(app.getHttpServer())
        .get(`/photos/${PHOTO_ID}/download-url`)
        .expect(200);

      expect(res.body).toEqual({ url: 'https://bucket.example/get' });
      expect(storage.presignGet).toHaveBeenCalledWith(KEY);
    });

    it('404s when the photo is not uploaded yet', async () => {
      prisma.photo.findFirst.mockResolvedValue(makePhoto());

      await request(app.getHttpServer())
        .get(`/photos/${PHOTO_ID}/download-url`)
        .expect(404);

      expect(storage.presignGet).not.toHaveBeenCalled();
    });

    it('404s for an unknown or foreign photo', async () => {
      prisma.photo.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/photos/${PHOTO_ID}/download-url`)
        .expect(404);
    });
  });
});

describe('PhotosService.cleanupAbandonedUploads', () => {
  let prisma: MockPrismaService;
  let storage: MockStorageService;
  let service: PhotosService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();
    service = new PhotosService(prisma as any, storage as any);
    prisma.bodyMeasurement.findMany.mockResolvedValue([]);
    prisma.photo.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('deletes stale never-uploaded photos and their objects', async () => {
    prisma.photo.findMany
      .mockResolvedValueOnce([
        { id: 'p1', userId: USER_ID, workoutId: 'workout-1' },
        { id: 'p2', userId: USER_ID, workoutId: 'workout-1' },
      ])
      .mockResolvedValueOnce([{ id: 'p2' }]); // p2 completed meanwhile
    prisma.photo.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.cleanupAbandonedUploads();

    expect(result).toEqual({ deleted: 1 });
    expect(prisma.photo.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        uploadedAt: null,
        createdAt: { lt: expect.any(Date) },
        OR: [
          { workoutId: null },
          { workout: { updatedAt: { lt: expect.any(Date) } } },
        ],
      },
      select: { id: true, userId: true, workoutId: true },
    });
    expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'p2'] }, uploadedAt: null },
    });
    expect(storage.deleteQuietly).toHaveBeenCalledWith([
      `photos/${USER_ID}/p1.jpg`,
    ]);
  });

  it('spares measurement photos whose measurements were recently pushed', async () => {
    prisma.photo.findMany
      .mockResolvedValueOnce([
        { id: 'stale', userId: USER_ID, workoutId: null },
        { id: 'fresh', userId: USER_ID, workoutId: null },
      ])
      .mockResolvedValueOnce([]);
    prisma.bodyMeasurement.findMany.mockResolvedValue([{ photoId: 'fresh' }]);
    prisma.photo.deleteMany.mockResolvedValue({ count: 1 });

    await service.cleanupAbandonedUploads();

    expect(prisma.bodyMeasurement.findMany).toHaveBeenCalledWith({
      where: {
        photoId: { in: ['stale', 'fresh'] },
        updatedAt: { gte: expect.any(Date) },
      },
      select: { photoId: true },
    });
    expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['stale'] }, uploadedAt: null },
    });
    expect(storage.deleteQuietly).toHaveBeenCalledWith([
      `photos/${USER_ID}/stale.jpg`,
    ]);
  });

  it('does nothing when there is nothing to clean', async () => {
    prisma.photo.findMany.mockResolvedValue([]);

    expect(await service.cleanupAbandonedUploads()).toEqual({ deleted: 0 });
    expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
    expect(storage.deleteQuietly).not.toHaveBeenCalled();
  });
});
