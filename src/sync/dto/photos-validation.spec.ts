import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MeasurementPushDto, WorkoutPushDto } from './sync-push.dto';
import {
  makeMeasurementPushDto,
  makeWorkoutPushDto,
  PAST,
} from '../../__mocks__/prisma.mock';

const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };
const UUID = '00000000-0000-4000-8000-000000000001';

function photo(i = 0) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    sortOrder: i,
    width: 1536,
    height: 2048,
    createdAt: PAST,
  };
}

async function errorsFor(overrides: Record<string, unknown>) {
  const dto = plainToInstance(WorkoutPushDto, {
    ...makeWorkoutPushDto(),
    id: UUID,
    exercises: [],
    ...overrides,
  });
  return validate(dto, OPTIONS);
}

describe('WorkoutPushDto photos', () => {
  it('accepts a workout without the photos key (older clients)', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('accepts an empty list and up to 10 photos', async () => {
    expect(await errorsFor({ photos: [] })).toHaveLength(0);
    expect(
      await errorsFor({
        photos: Array.from({ length: 10 }, (_, i) => photo(i)),
      }),
    ).toHaveLength(0);
  });

  it('rejects more than 10 photos', async () => {
    const errors = await errorsFor({
      photos: Array.from({ length: 11 }, (_, i) => photo(i)),
    });
    expect(errors.map((e) => e.property)).toEqual(['photos']);
  });

  it.each([
    ['non-UUID id', { id: 'photo-1' }],
    ['fractional width', { width: 10.5 }],
    ['missing createdAt', { createdAt: undefined }],
    ['unknown field', { uploaded: true }],
  ])('rejects a photo with %s', async (_name, override) => {
    const errors = await errorsFor({ photos: [{ ...photo(), ...override }] });
    expect(errors.map((e) => e.property)).toEqual(['photos']);
  });
});

describe('MeasurementPushDto photo', () => {
  async function measurementErrors(overrides: Record<string, unknown>) {
    const dto = plainToInstance(MeasurementPushDto, {
      ...makeMeasurementPushDto(),
      id: UUID,
      ...overrides,
    });
    return validate(dto, OPTIONS);
  }

  it('accepts a missing photo key, null, and a photo object', async () => {
    expect(await measurementErrors({})).toHaveLength(0);
    expect(await measurementErrors({ photo: null })).toHaveLength(0);
    expect(
      await measurementErrors({
        photo: { id: UUID, width: 1536, height: 2048 },
      }),
    ).toHaveLength(0);
  });

  it('keeps missing and null distinguishable', () => {
    const missing = plainToInstance(
      MeasurementPushDto,
      makeMeasurementPushDto(),
    );
    const cleared = plainToInstance(MeasurementPushDto, {
      ...makeMeasurementPushDto(),
      photo: null,
    });
    expect(missing.photo).toBeUndefined();
    expect(cleared.photo).toBeNull();
  });

  it.each([
    ['non-UUID id', { id: 'photo-1', width: 1, height: 1 }],
    ['missing width', { id: UUID, height: 1 }],
    ['unknown field', { id: UUID, width: 1, height: 1, uploaded: true }],
  ])('rejects a photo with %s', async (_name, photo) => {
    const errors = await measurementErrors({ photo });
    expect(errors.map((e) => e.property)).toEqual(['photo']);
  });
});
