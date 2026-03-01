import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { createMockPrismaService } from '../__mocks__/prisma.mock';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    controller = new HealthController(prisma as any);
  });

  it('returns ok when DB is connected', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const result = await controller.check();

    expect(result).toEqual({ status: 'ok', database: 'connected' });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('throws 503 when DB is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
