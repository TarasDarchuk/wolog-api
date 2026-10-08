jest.mock('uuid', () => ({
  v4: jest.fn(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
}));

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import request from 'supertest';
import { TrainingProfileController } from './training-profile.controller';
import { TrainingProfileService } from './training-profile.service';
import { OAuthTokenService } from '../oauth/oauth-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildConnectorOpenApiSpec } from '../openapi/connector-spec';
import {
  createMockPrismaService,
  MockPrismaService,
  USER_ID,
  NOW,
} from '../__mocks__/prisma.mock';

/** Connector (ChatGPT Action) read with the real ConnectorAuthGuard. */
describe('TrainingProfileController (connector HTTP)', () => {
  let app: INestApplication;
  let prisma: MockPrismaService;
  const tokens = { validateAccessToken: jest.fn() };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    tokens.validateAccessToken.mockImplementation(async (token: string) =>
      token === 'wlga_history'
        ? { userId: USER_ID, scopes: ['history:read'], clientId: 'gpt' }
        : token === 'wlga_routines'
          ? { userId: USER_ID, scopes: ['routines:read'], clientId: 'gpt' }
          : null,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      controllers: [TrainingProfileController],
      providers: [
        TrainingProfileService,
        { provide: PrismaService, useValue: prisma },
        { provide: OAuthTokenService, useValue: tokens },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => undefined) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (token?: string) => {
    const req = request(app.getHttpServer()).get('/training-profile');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('returns the profile for a history:read token', async () => {
    prisma.trainingProfile.findUnique.mockResolvedValue({
      goals: ['loseWeight'],
      level: 'beginner',
      equipment: 'bodyweight',
      daysPerWeek: 3,
      useMetric: true,
      starterProgramId: null,
      onboardingCompletedAt: null,
      updatedAt: new Date(NOW),
    });

    const res = await get('wlga_history').expect(200);

    expect(res.body.trainingProfile).toMatchObject({
      goals: ['loseWeight'],
      equipment: 'bodyweight',
      daysPerWeek: 3,
    });
    expect(prisma.trainingProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
  });

  it('returns trainingProfile: null when never set', async () => {
    prisma.trainingProfile.findUnique.mockResolvedValue(null);
    const res = await get('wlga_history').expect(200);
    expect(res.body).toEqual({ trainingProfile: null });
  });

  it('403 without the history:read scope', async () => {
    await get('wlga_routines').expect(403);
    expect(prisma.trainingProfile.findUnique).not.toHaveBeenCalled();
  });

  it('401 without a valid token', async () => {
    await get().expect(401);
    await get('wlga_bogus').expect(401);
  });

  it('is described in the ChatGPT Action OpenAPI spec', () => {
    const spec = buildConnectorOpenApiSpec('https://api.example.com');
    expect(spec.paths['/training-profile'].get.operationId).toBe(
      'getTrainingProfile',
    );
  });
});
