import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkoutExercisePushDto } from './sync-push.dto';

const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

describe('WorkoutExercisePushDto restTimerSeconds', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    exerciseId: '00000000-0000-4000-8000-000000000002',
    sortOrder: 0,
    sets: [],
  };

  async function errorsFor(extra: Record<string, unknown>) {
    const errors = await validate(
      plainToInstance(WorkoutExercisePushDto, { ...base, ...extra }),
      OPTIONS,
    );
    return errors.map((e) => e.property);
  }

  it('accepts an exercise without rest (1.4.1 and older)', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts whole seconds', async () => {
    expect(await errorsFor({ restTimerSeconds: 90 })).toEqual([]);
    expect(await errorsFor({ restTimerSeconds: 0 })).toEqual([]);
  });

  it('rejects negative or fractional rest', async () => {
    expect(await errorsFor({ restTimerSeconds: -5 })).toEqual([
      'restTimerSeconds',
    ]);
    expect(await errorsFor({ restTimerSeconds: 1.5 })).toEqual([
      'restTimerSeconds',
    ]);
  });
});
