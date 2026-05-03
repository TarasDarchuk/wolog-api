import { Reflector } from '@nestjs/core';
import { SharesController } from './shares.controller';
import {
  SharesService,
  ShareRateLimitedException,
} from './shares.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { USER_ID } from '../__mocks__/prisma.mock';

function createController(serviceOverrides: Partial<SharesService> = {}) {
  const service = {
    create: jest.fn(),
    fetch: jest.fn(),
    ...serviceOverrides,
  } as unknown as SharesService;
  return { controller: new SharesController(service), service };
}

describe('SharesController', () => {
  it('GET /:id is marked @Public (no auth required)', () => {
    const reflector = new Reflector();
    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      SharesController.prototype.fetch,
    );
    expect(isPublic).toBe(true);
  });

  it('POST is NOT marked @Public (auth required)', () => {
    const reflector = new Reflector();
    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      SharesController.prototype.create,
    );
    expect(isPublic).toBeUndefined();
  });

  it('sets Retry-After header when service throws ShareRateLimitedException', async () => {
    const { controller } = createController({
      create: jest
        .fn()
        .mockRejectedValue(new ShareRateLimitedException(3600)) as any,
    });
    const setHeader = jest.fn();
    const res = { setHeader } as any;

    await expect(
      controller.create(USER_ID, {} as any, res),
    ).rejects.toBeInstanceOf(ShareRateLimitedException);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '3600');
  });

  it('forwards userId and dto to the service', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'abc',
      url: 'https://wolog.app/s/abc',
      expiresAt: '2026-07-22T10:00:00.000Z',
    });
    const { controller } = createController({ create: create as any });

    const dto = { hello: 'world' } as any;
    const res = { setHeader: jest.fn() } as any;

    await controller.create(USER_ID, dto, res);

    expect(create).toHaveBeenCalledWith(USER_ID, dto);
  });
});
