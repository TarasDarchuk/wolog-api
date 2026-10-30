jest.mock('uuid', () => ({
  v4: jest.fn(() => '33333333-0000-4000-8000-000000000001'),
}));

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomExercisesService } from './custom-exercises.service';
import {
  CreateCustomExerciseDto,
  UpdateCustomExerciseDto,
} from './dto/custom-exercise.dto';
import { createMockPrismaService, USER_ID } from '../__mocks__/prisma.mock';

const EX_ID = '22222222-0000-4000-8000-000000000001';
const OTHER_USER = '99999999-0000-4000-8000-000000000009';

function exercise(overrides: Record<string, unknown> = {}) {
  return {
    id: EX_ID,
    userId: USER_ID,
    name: 'Landmine Press',
    muscleGroup: 'shoulders',
    equipment: 'barbell',
    exerciseType: 'weightReps',
    isCustom: true,
    includesBodyweight: false,
    restDuration: null,
    primaryMuscles: ['shoulders'],
    secondaryMuscles: [],
    updatedAt: new Date('2026-10-30T12:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('CustomExercisesService', () => {
  let service: CustomExercisesService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new CustomExercisesService(prisma as any);
  });

  describe('create', () => {
    const dto = {
      name: 'Landmine Press',
      muscleGroup: 'shoulders',
      equipment: 'barbell',
      exerciseType: 'weightReps',
    } as CreateCustomExerciseDto;

    it('creates a custom exercise owned by the user', async () => {
      prisma.exercise.findMany.mockResolvedValue([]);
      prisma.exercise.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...data, updatedAt: new Date() }),
      );

      const result = await service.create(USER_ID, dto);

      expect(result.created).toBe(true);
      expect(prisma.exercise.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          isCustom: true,
          name: 'Landmine Press',
          primaryMuscles: ['shoulders'],
        }),
      });
    });

    it('returns an existing custom exercise with the same name', async () => {
      prisma.exercise.findMany.mockResolvedValue([exercise()]);

      const result = await service.create(USER_ID, dto);

      expect(result).toEqual({
        exercise: expect.objectContaining({ id: EX_ID }),
        created: false,
      });
      expect(prisma.exercise.create).not.toHaveBeenCalled();
    });

    it('refuses to copy a library exercise', async () => {
      prisma.exercise.findMany.mockResolvedValue([
        exercise({ userId: null, isCustom: false }),
      ]);

      await expect(service.create(USER_ID, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.exercise.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates only the given fields of an own custom exercise', async () => {
      prisma.exercise.findUnique.mockResolvedValue(exercise());
      prisma.exercise.update.mockResolvedValue(
        exercise({ exerciseType: 'repsOnly' }),
      );

      const result = await service.update(USER_ID, EX_ID, {
        exerciseType: 'repsOnly',
      } as UpdateCustomExerciseDto);

      expect(result.exercise.exerciseType).toBe('repsOnly');
      const { data } = prisma.exercise.update.mock.calls[0][0];
      expect(data).toMatchObject({ exerciseType: 'repsOnly' });
      expect(data.name).toBeUndefined();
      expect(data.primaryMuscles).toBeUndefined();
    });

    it('keeps primaryMuscles in step with muscleGroup', async () => {
      prisma.exercise.findUnique.mockResolvedValue(exercise());
      prisma.exercise.update.mockResolvedValue(exercise());

      await service.update(USER_ID, EX_ID, {
        muscleGroup: 'chest',
      } as UpdateCustomExerciseDto);

      expect(prisma.exercise.update.mock.calls[0][0].data).toMatchObject({
        muscleGroup: 'chest',
        primaryMuscles: ['chest'],
      });
    });

    it('refuses library exercises', async () => {
      prisma.exercise.findUnique.mockResolvedValue(
        exercise({ userId: null, isCustom: false }),
      );
      await expect(
        service.update(USER_ID, EX_ID, { name: 'X' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("hides other users' exercises", async () => {
      prisma.exercise.findUnique.mockResolvedValue(
        exercise({ userId: OTHER_USER }),
      );
      await expect(
        service.update(USER_ID, EX_ID, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.exercise.update).not.toHaveBeenCalled();
    });

    it('treats a non-UUID id as not found', async () => {
      await expect(
        service.update(USER_ID, 'bench', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.exercise.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.exercise.findUnique.mockResolvedValue(exercise());
    });

    it('soft-deletes an unused exercise', async () => {
      prisma.workoutExercise.count.mockResolvedValue(0);
      prisma.workoutTemplate.findMany.mockResolvedValue([]);

      await expect(service.remove(USER_ID, EX_ID)).resolves.toEqual({
        deleted: true,
      });
      expect(prisma.exercise.update).toHaveBeenCalledWith({
        where: { id: EX_ID },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('refuses an exercise with logged workouts', async () => {
      prisma.workoutExercise.count.mockResolvedValue(3);
      prisma.workoutTemplate.findMany.mockResolvedValue([]);

      await expect(service.remove(USER_ID, EX_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.exercise.update).not.toHaveBeenCalled();
    });

    it('refuses an exercise used in routines and names them', async () => {
      prisma.workoutExercise.count.mockResolvedValue(0);
      prisma.workoutTemplate.findMany.mockResolvedValue([
        { id: 'r1', name: 'Push' },
      ]);

      const error = await service.remove(USER_ID, EX_ID).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        routines: [{ id: 'r1', name: 'Push' }],
      });
      expect(prisma.exercise.update).not.toHaveBeenCalled();
    });
  });

  describe('DTO validation', () => {
    it('rejects unknown enum values and negative rest', async () => {
      const dto = plainToInstance(CreateCustomExerciseDto, {
        name: '  ',
        muscleGroup: 'legs',
        equipment: 'barbell',
        exerciseType: 'weightReps',
        restDuration: -5,
      });
      const fields = (await validate(dto)).map((e) => e.property);
      expect(fields).toEqual(
        expect.arrayContaining(['name', 'muscleGroup', 'restDuration']),
      );
    });

    it('allows clearing rest with null on update', async () => {
      const dto = plainToInstance(UpdateCustomExerciseDto, {
        restDuration: null,
      });
      expect(await validate(dto)).toHaveLength(0);
    });
  });
});
