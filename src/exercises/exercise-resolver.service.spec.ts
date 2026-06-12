jest.mock('uuid', () => {
  let counter = 0;
  return {
    v4: jest.fn(
      () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    ),
  };
});

import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../__mocks__/prisma.mock.js';
import {
  ExerciseResolverService,
  normalizeTokens,
  tokenScore,
} from './exercise-resolver.service.js';

const LIB = (
  id: string,
  name: string,
  muscleGroup = 'chest',
  equipment = 'barbell',
) => ({
  id,
  name,
  muscleGroup,
  equipment,
  exerciseType: 'weightReps',
  isCustom: false,
});

const CATALOG = [
  LIB('id-bp-bb', 'Bench Press (Barbell)', 'chest', 'barbell'),
  LIB('id-bp-db', 'Bench Press (Dumbbell)', 'chest', 'dumbbell'),
  LIB('id-bp-sm', 'Bench Press (Smith Machine)', 'chest', 'machine'),
  LIB('id-incline-db', 'Incline Bench Press (Dumbbell)', 'chest', 'dumbbell'),
  LIB('id-ohp-bb', 'Overhead Press (Barbell)', 'shoulders', 'barbell'),
  LIB('id-ohp-db', 'Overhead Press (Dumbbell)', 'shoulders', 'dumbbell'),
  LIB('id-rdl', 'Romanian Deadlift (Barbell)', 'hamstrings', 'barbell'),
  LIB('id-latpd', 'Lat Pulldown (Cable)', 'lats', 'cable'),
  LIB('id-squat', 'Squat (Barbell)', 'quadriceps', 'barbell'),
];

describe('ExerciseResolverService', () => {
  let service: ExerciseResolverService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    // Fresh array per query, like real Prisma (the resolver appends created
    // customs to its local copy).
    prisma.exercise.findMany.mockImplementation(() =>
      Promise.resolve(CATALOG.map((e) => ({ ...e }))),
    );
    prisma.exercise.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExerciseResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(ExerciseResolverService);
  });

  describe('normalizeTokens', () => {
    it('strips parenthetical qualifiers into tokens', () => {
      expect(normalizeTokens('Bench Press (Barbell)')).toEqual(
        normalizeTokens('barbell bench press'),
      );
    });

    it('expands abbreviations', () => {
      expect(normalizeTokens('ohp')).toEqual(['overhead', 'press']);
      expect(normalizeTokens('rdl')).toEqual(['deadlift', 'romanian']);
      expect(normalizeTokens('DB Bench')).toEqual(['bench', 'dumbbell']);
    });

    it('singularizes plurals but keeps press', () => {
      expect(normalizeTokens('Bicep Curls')).toEqual(['bicep', 'curl']);
      expect(normalizeTokens('press')).toEqual(['press']);
    });
  });

  describe('tokenScore', () => {
    it('scores exact token sets as 1', () => {
      expect(tokenScore(['bench', 'press'], ['bench', 'press'])).toBe(1);
    });

    it('prefers fewer extra candidate tokens', () => {
      const plain = tokenScore(
        ['bench', 'press'],
        ['barbell', 'bench', 'press'],
      );
      const incline = tokenScore(
        ['bench', 'press'],
        ['barbell', 'bench', 'incline', 'press'],
      );
      expect(plain).toBeGreaterThan(incline);
    });
  });

  describe('resolveAll', () => {
    it('resolves an exact id match', async () => {
      const [r] = await service.resolveAll('user-1', [
        { exerciseId: 'id-squat' },
      ]);
      expect(r).toMatchObject({ id: 'id-squat', method: 'id', confidence: 1 });
    });

    it('resolves exact names case-insensitively', async () => {
      const [r] = await service.resolveAll('user-1', [
        { name: 'bench press (barbell)' },
      ]);
      expect(r).toMatchObject({ id: 'id-bp-bb', method: 'exact' });
    });

    it('resolves "DB Incline Press" to Incline Bench Press (Dumbbell)', async () => {
      const [r] = await service.resolveAll('user-1', [
        { name: 'DB Incline Press' },
      ]);
      expect(r.id).toBe('id-incline-db');
      expect(r.createdCustom).toBe(false);
    });

    it('resolves "ohp" to Overhead Press (Barbell)', async () => {
      const [r] = await service.resolveAll('user-1', [{ name: 'ohp' }]);
      expect(r.id).toBe('id-ohp-bb');
    });

    it('resolves "rdl" to Romanian Deadlift (Barbell)', async () => {
      const [r] = await service.resolveAll('user-1', [{ name: 'rdl' }]);
      expect(r.id).toBe('id-rdl');
    });

    it('resolves "Bench Press" to the barbell variant (equipment priority)', async () => {
      const [r] = await service.resolveAll('user-1', [{ name: 'Bench Press' }]);
      expect(r.id).toBe('id-bp-bb');
    });

    it('resolves "lat pulldown" without the cable qualifier', async () => {
      const [r] = await service.resolveAll('user-1', [
        { name: 'lat pulldown' },
      ]);
      expect(r.id).toBe('id-latpd');
    });

    it('creates a custom exercise for a nonsense name and reports it', async () => {
      const [r] = await service.resolveAll('user-1', [
        { name: 'Blorbo Smash' },
      ]);
      expect(r.createdCustom).toBe(true);
      expect(r.method).toBe('created_custom');
      expect(prisma.exercise.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            name: 'Blorbo Smash',
            isCustom: true,
          }),
        }),
      );
    });

    it('reuses the created custom for a repeated unknown name in one request', async () => {
      const [a, b] = await service.resolveAll('user-1', [
        { name: 'Blorbo Smash' },
        { name: 'Blorbo Smash' },
      ]);
      expect(prisma.exercise.create).toHaveBeenCalledTimes(1);
      expect(b.id).toBe(a.id);
      expect(b.createdCustom).toBe(false);
    });

    it('falls back to name resolution when the id is unknown', async () => {
      const [r] = await service.resolveAll('user-1', [
        { exerciseId: '00000000-0000-0000-0000-000000000000', name: 'Squat' },
      ]);
      expect(r.id).toBe('id-squat');
    });

    it('guesses a sensible classification for created customs', async () => {
      await service.resolveAll('user-1', [{ name: 'Zorblax Cable Curl' }]);
      expect(prisma.exercise.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            muscleGroup: 'biceps',
            equipment: 'cable',
          }),
        }),
      );
    });
  });
});
