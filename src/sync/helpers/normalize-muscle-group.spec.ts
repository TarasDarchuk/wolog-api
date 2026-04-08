import {
  normalizeMuscleGroup,
  normalizeMuscleGroups,
} from './normalize-muscle-group';

describe('normalizeMuscleGroup', () => {
  it('passes through valid enum values unchanged', () => {
    expect(normalizeMuscleGroup('triceps')).toBe('triceps');
    expect(normalizeMuscleGroup('lowerBack')).toBe('lowerBack');
    expect(normalizeMuscleGroup('upperBack')).toBe('upperBack');
    expect(normalizeMuscleGroup('fullBody')).toBe('fullBody');
  });

  it('lowercases single-word display names', () => {
    expect(normalizeMuscleGroup('Triceps')).toBe('triceps');
    expect(normalizeMuscleGroup('Chest')).toBe('chest');
    expect(normalizeMuscleGroup('Shoulders')).toBe('shoulders');
  });

  it('maps multi-word display names to camelCase enum values', () => {
    expect(normalizeMuscleGroup('Lower Back')).toBe('lowerBack');
    expect(normalizeMuscleGroup('Upper Back')).toBe('upperBack');
    expect(normalizeMuscleGroup('Full Body')).toBe('fullBody');
  });
});

describe('normalizeMuscleGroups', () => {
  it('normalizes an array of mixed formats', () => {
    const input = ['Triceps', 'Lower Back', 'chest', 'Shoulders'];
    expect(normalizeMuscleGroups(input)).toEqual([
      'triceps',
      'lowerBack',
      'chest',
      'shoulders',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeMuscleGroups([])).toEqual([]);
  });
});
