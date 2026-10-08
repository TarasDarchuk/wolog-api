jest.mock('uuid', () => ({
  v4: jest.fn(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { UsersController } from './users.controller';
import { TrainingProfileService } from './training-profile.service';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  createMockPrismaService,
  createMockStorageService,
  MockPrismaService,
  USER_ID,
} from '../__mocks__/prisma.mock';

const SECRET = 'test-secret';

const FULL_PROFILE = {
  goals: ['getStronger', 'gainMuscle'],
  level: 'intermediate',
  equipment: 'dumbbells',
  daysPerWeek: 4,
  useMetric: false,
  starterProgramId: 'beginner-full-body',
  onboardingCompletedAt: '2026-10-08T10:00:00.000Z',
};

/**
 * Real controller, services, ValidationPipe and JWT guard over HTTP. Prisma
 * is mocked with an in-memory TrainingProfile table so PUT → GET round-trips.
 */
describe('UsersController — training profile (HTTP)', () => {
  let app: INestApplication;
  let prisma: MockPrismaService;
  let token: string;
  let profiles: Map<string, Record<string, unknown>>;

  const put = (body: unknown) =>
    request(app.getHttpServer())
      .put('/users/me/training-profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const getMe = () =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    prisma = createMockPrismaService();
    profiles = new Map();

    const strip = (row: Record<string, unknown>) => {
      const { userId: _u, createdAt: _c, ...rest } = row;
      return rest;
    };
    prisma.trainingProfile.upsert.mockImplementation(
      async ({ where, create, update }: any) => {
        const existing = profiles.get(where.userId);
        const row = {
          ...(existing ?? create),
          ...(existing ? update : {}),
          updatedAt: new Date(),
        };
        profiles.set(where.userId, row);
        return strip(row);
      },
    );
    prisma.trainingProfile.findUnique.mockImplementation(
      async ({ where }: any) => {
        const row = profiles.get(where.userId);
        return row ? strip(row) : null;
      },
    );
    prisma.user.findUnique.mockImplementation(async () => {
      const row = profiles.get(USER_ID);
      return {
        id: USER_ID,
        email: 'test@example.com',
        displayName: 'Test',
        appleUserId: 'apple-1',
        googleUserId: null,
        isPro: false,
        createdAt: new Date(),
        trainingProfile: row ? strip(row) : null,
      };
    });

    const config = {
      get: jest.fn((key: string, def?: unknown) =>
        key === 'JWT_SECRET' ? SECRET : def,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [UsersController],
      providers: [
        AuthService,
        TrainingProfileService,
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: createMockStorageService() },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    token = moduleRef.get(JwtService).sign({ sub: USER_ID });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns trainingProfile: null on GET /users/me before any PUT', async () => {
    const res = await getMe().expect(200);
    expect(res.body.trainingProfile).toBeNull();
    expect(res.body.id).toBe(USER_ID);
    expect(res.body.hasApple).toBe(true);
  });

  it('round-trips PUT → GET /users/me', async () => {
    const putRes = await put(FULL_PROFILE).expect(200);
    expect(putRes.body).toMatchObject(FULL_PROFILE);
    expect(putRes.body.updatedAt).toEqual(expect.any(String));
    expect(putRes.body.userId).toBeUndefined();

    const res = await getMe().expect(200);
    expect(res.body.trainingProfile).toMatchObject(FULL_PROFILE);
    expect(res.body.trainingProfile.updatedAt).toEqual(expect.any(String));
  });

  it('stores onboardingCompletedAt as a Date', async () => {
    await put(FULL_PROFILE).expect(200);
    expect(profiles.get(USER_ID)!.onboardingCompletedAt).toEqual(
      new Date(FULL_PROFILE.onboardingCompletedAt),
    );
  });

  it('full replace: omitted fields become null (goals → [])', async () => {
    await put(FULL_PROFILE).expect(200);

    const res = await put({ level: 'advanced', useMetric: null }).expect(200);

    expect(res.body).toMatchObject({
      goals: [],
      level: 'advanced',
      equipment: null,
      daysPerWeek: null,
      useMetric: null,
      starterProgramId: null,
      onboardingCompletedAt: null,
    });
    expect((await getMe()).body.trainingProfile).toMatchObject({
      goals: [],
      level: 'advanced',
      equipment: null,
    });
  });

  it('accepts an empty body and explicit nulls', async () => {
    await put({}).expect(200);
    await put({
      goals: null,
      level: null,
      equipment: null,
      daysPerWeek: null,
      useMetric: null,
      starterProgramId: null,
      onboardingCompletedAt: null,
    }).expect(200);
  });

  it.each([
    ['unknown goal', { goals: ['getRipped'] }],
    ['three goals', { goals: ['gainMuscle', 'getStronger', 'loseWeight'] }],
    ['duplicate goal', { goals: ['gainMuscle', 'gainMuscle'] }],
    ['goals not an array', { goals: 'gainMuscle' }],
    ['bad level', { level: 'expert' }],
    ['bad equipment', { equipment: 'kettlebells' }],
    ['1 day per week', { daysPerWeek: 1 }],
    ['7 days per week', { daysPerWeek: 7 }],
    ['fractional days', { daysPerWeek: 3.5 }],
    ['useMetric not boolean', { useMetric: 'yes' }],
    ['bad date', { onboardingCompletedAt: 'yesterday' }],
    ['unknown field', { weightUnit: 'kg' }],
  ])('400 on %s', async (_name, body) => {
    await put(body).expect(400);
    expect(prisma.trainingProfile.upsert).not.toHaveBeenCalled();
  });

  it('accepts the edges of daysPerWeek (2 and 6)', async () => {
    await put({ daysPerWeek: 2 }).expect(200);
    await put({ daysPerWeek: 6 }).expect(200);
  });

  it('401 without a token', async () => {
    await request(app.getHttpServer())
      .put('/users/me/training-profile')
      .send(FULL_PROFILE)
      .expect(401);
    await request(app.getHttpServer()).get('/users/me').expect(401);
    expect(prisma.trainingProfile.upsert).not.toHaveBeenCalled();
  });

  it('401 with a token signed by another secret', async () => {
    const forged = new JwtService({ secret: 'other' }).sign({ sub: USER_ID });
    await request(app.getHttpServer())
      .put('/users/me/training-profile')
      .set('Authorization', `Bearer ${forged}`)
      .send(FULL_PROFILE)
      .expect(401);
  });
});

describe('TrainingProfile schema', () => {
  // Account deletion is `prisma.user.delete`; the profile goes with it via
  // the FK cascade (also verified against Postgres for the migration).
  it('cascades on user delete', () => {
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const model = schema.match(/model TrainingProfile \{[\s\S]*?\n\}/)![0];
    expect(model).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
    );
    const migration = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261008160000_add_training_profile/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/,
    );
  });
});
