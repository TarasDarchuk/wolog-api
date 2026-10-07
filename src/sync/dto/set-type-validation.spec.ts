import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TemplateSetPushDto } from './sync-push.dto';
import { RoutineSetDto } from '../../routines/dto/routine.dto';

const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

describe.each([
  ['TemplateSetPushDto (sync push)', TemplateSetPushDto],
  ['RoutineSetDto (connector)', RoutineSetDto],
])('%s set type', (_name, Dto: any) => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    setNumber: 1,
    targetReps: 8,
  };

  it('accepts a set without type (older clients)', async () => {
    expect(await validate(plainToInstance(Dto, base), OPTIONS)).toHaveLength(0);
  });

  it.each(['normal', 'warmup', 'dropset', 'failure'])(
    'accepts type "%s"',
    async (type) => {
      const errors = await validate(
        plainToInstance(Dto, { ...base, type }),
        OPTIONS,
      );
      expect(errors).toHaveLength(0);
    },
  );

  it('rejects an unknown type', async () => {
    const errors = await validate(
      plainToInstance(Dto, { ...base, type: 'superset' }),
      OPTIONS,
    );
    expect(errors.map((e) => e.property)).toEqual(['type']);
  });
});
