jest.mock('uuid', () => ({
  v4: jest.fn(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
}));

import { INestApplication, Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PaywallCohort } from '../generated/prisma/client';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
} from '../__mocks__/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OAuthTokenService } from '../oauth/oauth-token.service';
import { RoutinesController } from '../routines/routines.controller';
import { FoldersController } from '../routines/folders.controller';
import { RoutinesService } from '../routines/routines.service';
import { FoldersService } from '../routines/folders.service';
import { ExercisesController } from '../exercises/exercises.controller';
import { ExercisesService } from '../exercises/exercises.service';
import { CustomExercisesService } from '../exercises/custom-exercises.service';
import { SharesController } from '../shares/shares.controller';
import { SharesService } from '../shares/shares.service';
import { SyncController } from '../sync/sync.controller';
import { PhotosController } from '../photos/photos.controller';
import { UsersController } from '../users/users.controller';
import { TrainingProfileController } from '../users/training-profile.controller';
import { AuthController } from '../auth/auth.controller';
import {
  ExerciseHistoryController,
  PersonalRecordsController,
  WorkoutsController,
} from '../workouts/workouts.controller';
import { AdaptyWebhookController } from './adapty-webhook.controller';
import { AdaptyApiService } from './adapty-api.service';
import { SubscriptionsService } from './subscriptions.service';
import { RequiresAccessGuard } from './requires-access.guard';

const SECRET = 'test-secret';
const ROUTINE_ID = '11111111-1111-4111-8111-111111111111';
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

/**
 * Real controllers, auth guards and SubscriptionsService over HTTP; the
 * data services behind the controllers are stubs, and there is no
 * ValidationPipe (empty bodies reach the stubs — this is about the guard).
 */
describe('RequiresAccessGuard (HTTP)', () => {
  let app: INestApplication;
  let prisma: MockPrismaService;
  let token: string;

  const as = (user: Record<string, unknown>) =>
    prisma.user.findUnique.mockResolvedValue({
      isPro: false,
      proExpiresAt: null,
      paywallCohort: null,
      ...user,
    });
  const locked = () => as({ paywallCohort: PaywallCohort.NEW });

  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`)
      .send(method === 'get' ? undefined : { name: 'Test' });

  const ok = jest.fn();

  beforeEach(async () => {
    ok.mockReset().mockResolvedValue({ ok: true });
    prisma = createMockPrismaService();
    const config = {
      get: jest.fn((key: string, def?: unknown) =>
        key === 'JWT_SECRET' ? SECRET : def,
      ),
    };
    // Any method resolves; not a thenable and without lifecycle hooks.
    const stub = new Proxy(
      {},
      {
        get: (_t, prop) =>
          typeof prop === 'string' && !prop.startsWith('on') && prop !== 'then'
            ? ok
            : undefined,
      },
    );

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [
        RoutinesController,
        FoldersController,
        ExercisesController,
        SharesController,
      ],
      providers: [
        SubscriptionsService,
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: AdaptyApiService, useValue: {} },
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: OAuthTokenService, useValue: {} },
        { provide: RoutinesService, useValue: stub },
        { provide: FoldersService, useValue: stub },
        { provide: ExercisesService, useValue: stub },
        { provide: CustomExercisesService, useValue: stub },
        { provide: SharesService, useValue: stub },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    token = moduleRef.get(JwtService).sign({ sub: USER_ID });
  });

  afterEach(async () => {
    await app.close();
  });

  const writes: ['post' | 'patch' | 'delete', string][] = [
    ['post', '/routines'],
    ['post', '/routines/programs'],
    ['patch', `/routines/${ROUTINE_ID}`],
    ['delete', `/routines/${ROUTINE_ID}`],
    ['post', '/folders'],
    ['patch', `/folders/${ROUTINE_ID}`],
    ['delete', `/folders/${ROUTINE_ID}`],
    ['post', '/exercises'],
    ['patch', `/exercises/${ROUTINE_ID}`],
    ['delete', `/exercises/${ROUTINE_ID}`],
    ['post', '/shares'],
  ];

  it.each(writes)(
    'answers 402 subscription_required to a locked user: %s %s',
    async (method, path) => {
      locked();
      const res = await call(method, path).expect(402);
      const body = res.body as { error: string; message: string };
      expect(Object.keys(body).sort()).toEqual(['error', 'message']);
      expect(body.error).toBe('subscription_required');
      expect(body.message).toContain('subscription');
      expect(ok).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/routines'],
    [`/routines/${ROUTINE_ID}`],
    ['/folders'],
    ['/exercises'],
  ])('keeps reads open for a locked user: GET %s', async (path) => {
    locked();
    await call('get', path).expect(200);
  });

  it.each([
    ['legacy', { paywallCohort: PaywallCohort.LEGACY }],
    ['null cohort', { paywallCohort: null }],
    [
      'new cohort with Pro',
      { paywallCohort: PaywallCohort.NEW, isPro: true, proExpiresAt: FUTURE },
    ],
  ])('lets a %s user write', async (_label, user) => {
    as(user);
    for (const [method, path] of writes) {
      const res = await call(method, path);
      expect([method, path, res.status]).toEqual([
        method,
        path,
        method === 'post' && path !== '/shares' ? 201 : 200,
      ]);
    }
  });

  it('still answers 401 (not 402) without a token', async () => {
    locked();
    await request(app.getHttpServer()).post('/exercises').expect(401);
    await request(app.getHttpServer()).post('/shares').expect(401);
  });
});

describe('RequiresAccessGuard placement', () => {
  const guarded = (controller: Type, method: string): boolean => {
    const handler = (controller.prototype as Record<string, unknown>)[method];
    const guards = [
      ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ??
        []),
      ...((Reflect.getMetadata(GUARDS_METADATA, handler as object) as
        | unknown[]
        | undefined) ?? []),
    ];
    return guards.includes(RequiresAccessGuard);
  };

  const handlers = (controller: Type) =>
    Object.getOwnPropertyNames(controller.prototype).filter(
      (name) =>
        name !== 'constructor' &&
        Reflect.getMetadata(
          METHOD_METADATA,
          (controller.prototype as Record<string, object>)[name],
        ) !== undefined,
    );

  it('never closes sync, photos, users, auth, webhooks or history', () => {
    for (const controller of [
      SyncController,
      PhotosController,
      UsersController,
      TrainingProfileController,
      AuthController,
      AdaptyWebhookController,
      WorkoutsController,
      ExerciseHistoryController,
      PersonalRecordsController,
    ]) {
      for (const method of handlers(controller)) {
        expect([controller.name, method, guarded(controller, method)]).toEqual([
          controller.name,
          method,
          false,
        ]);
      }
    }
  });

  it('closes every write and no read on the guarded controllers', () => {
    for (const controller of [
      RoutinesController,
      FoldersController,
      ExercisesController,
      SharesController,
    ]) {
      for (const method of handlers(controller)) {
        const verb = Reflect.getMetadata(
          METHOD_METADATA,
          (controller.prototype as Record<string, object>)[method],
        ) as RequestMethod;
        const isWrite = verb !== RequestMethod.GET;
        expect([controller.name, method, guarded(controller, method)]).toEqual([
          controller.name,
          method,
          isWrite,
        ]);
      }
    }
  });
});
