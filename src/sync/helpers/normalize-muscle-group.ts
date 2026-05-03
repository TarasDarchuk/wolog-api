/**
 * Maps display-name strings (sent by older iOS app versions) to MuscleGroup enum values.
 * Multi-word display names need explicit mapping; single-word names just lowercase.
 */
const DISPLAY_NAME_TO_ENUM: Record<string, string> = {
  'Lower Back': 'lowerBack',
  'Upper Back': 'upperBack',
  'Full Body': 'fullBody',
  // Identity mappings so camelCase enum values survive toLowerCase()
  lowerBack: 'lowerBack',
  upperBack: 'upperBack',
  fullBody: 'fullBody',
};

export function normalizeMuscleGroup(value: string): string {
  return DISPLAY_NAME_TO_ENUM[value] ?? value.toLowerCase();
}

export function normalizeMuscleGroups(values: string[]): string[] {
  return values.map(normalizeMuscleGroup);
}
