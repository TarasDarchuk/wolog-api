import { ExercisesService } from './exercises.service';
import { createMockPrismaService } from '../__mocks__/prisma.mock';

describe('ExercisesService', () => {
  let service: ExercisesService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new ExercisesService(prisma as any);
  });

  it('returns paginated exercises with defaults', async () => {
    const exercises = [{ id: '1', name: 'Bench Press' }];
    prisma.exercise.findMany.mockResolvedValue(exercises);
    prisma.exercise.count.mockResolvedValue(100);

    const result = await service.list({ limit: 50, offset: 0 });

    expect(result).toEqual({ exercises, total: 100, limit: 50, offset: 0 });
    expect(prisma.exercise.findMany).toHaveBeenCalledWith({
      where: { isCustom: false, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 50,
      skip: 0,
    });
  });

  it('passes custom limit and offset', async () => {
    prisma.exercise.findMany.mockResolvedValue([]);
    prisma.exercise.count.mockResolvedValue(0);

    const result = await service.list({ limit: 10, offset: 20 });

    expect(result).toEqual({ exercises: [], total: 0, limit: 10, offset: 20 });
    expect(prisma.exercise.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 }),
    );
  });
});
