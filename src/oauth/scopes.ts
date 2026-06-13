/**
 * OAuth scopes for the AI connector authorization layer.
 */
export const SCOPE_ROUTINES_READ = 'routines:read';
export const SCOPE_ROUTINES_WRITE = 'routines:write';
export const SCOPE_HISTORY_READ = 'history:read';

export const ALL_SCOPES = [
  SCOPE_ROUTINES_READ,
  SCOPE_ROUTINES_WRITE,
  SCOPE_HISTORY_READ,
];

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [SCOPE_ROUTINES_READ]: 'Read your workout routines',
  [SCOPE_ROUTINES_WRITE]: 'Create and update workout routines',
  [SCOPE_HISTORY_READ]: 'Read your workout history',
};

export function parseScopes(scope: string | undefined | null): string[] {
  if (!scope) return [];
  return scope
    .split(/[\s+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
