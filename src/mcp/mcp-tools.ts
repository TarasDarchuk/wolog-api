/**
 * MCP tool definitions for the Wolog connector (§9). Descriptions carry the
 * contract the model must follow: weights are kg; read a routine via
 * get_routine before update_routine and preserve all ids; prefer names and
 * trust server-side resolution.
 */

const SET_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Set id — keep when updating, omit for new sets',
    },
    setNumber: { type: 'integer', minimum: 1 },
    targetWeight: { type: 'number', description: 'Target weight in KILOGRAMS' },
    targetReps: { type: 'integer' },
    targetDuration: {
      type: 'number',
      description: 'Target duration in seconds',
    },
    targetDistance: {
      type: 'number',
      description: 'Target distance in meters',
    },
  },
  additionalProperties: false,
};

const EXERCISE_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description:
        'Routine-exercise row id — keep when updating, omit for new exercises',
    },
    exerciseId: {
      type: 'string',
      description:
        'Catalog exercise UUID. Optional — when absent the server resolves by name.',
    },
    name: {
      type: 'string',
      description:
        'Exercise name, e.g. "Bench Press (Barbell)". The server resolves names against the catalog and the user\'s custom exercises.',
    },
    targetSets: { type: 'integer', minimum: 1 },
    targetReps: { type: 'integer' },
    notes: { type: 'string' },
    restTimerSeconds: { type: 'integer' },
    sets: {
      type: 'array',
      items: SET_SCHEMA,
      description:
        'Optional per-set targets. Omit on update to leave existing sets untouched; omit on create to materialize targetSets × targetReps.',
    },
  },
  additionalProperties: false,
};

const ROUTINE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    notes: { type: 'string' },
    items: {
      type: 'array',
      description:
        'Ordered routine items. Each item is EXACTLY ONE of "exercise" or "superset".',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Item id — keep when updating, omit for new items',
          },
          exercise: EXERCISE_SCHEMA,
          superset: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              supersetColorIndex: { type: 'integer' },
              exercises: { type: 'array', items: EXERCISE_SCHEMA },
            },
            required: ['exercises'],
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
}

export const MCP_SERVER_INSTRUCTIONS = `Wolog workout connector. Rules:
- ALL weights are kilograms, durations seconds, distances meters. Never send pounds — convert first.
- Before update_routine, ALWAYS call get_routine and edit the returned structure, preserving every id (routine, item, exercise, set). Only change the fields you mean to change.
- Prefer referencing exercises by name and trust server resolution; check the resolution report in the response and tell the user about low-confidence or created-custom matches.
- Use get_workout_history (optionally per exercise) to ground progression decisions; it includes per-session best sets and estimated 1RM.`;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_exercises',
    description:
      "Search the exercise catalog (library + the user's custom exercises). Use to discover exact exercise names/ids. Returns id, name, muscleGroup, equipment, exerciseType.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring name filter' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        offset: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    scope: null,
  },
  {
    name: 'list_routines',
    description:
      "List the user's workout routines (summaries: id, name, notes, exerciseCount, updatedAt).",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    scope: 'routines:read',
  },
  {
    name: 'get_routine',
    description:
      'Read one routine in full, including every id and the current updatedAt. ALWAYS call this before update_routine.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Routine id' } },
      required: ['id'],
      additionalProperties: false,
    },
    scope: 'routines:read',
  },
  {
    name: 'create_routine',
    description:
      "Create a new routine in the user's Wolog app (appears on next app sync). Weights kg. Reference exercises by name (server resolves) or exerciseId. Returns the created routine with all ids plus a per-exercise resolution report — surface low-confidence or created-custom resolutions to the user.",
    inputSchema: {
      type: 'object',
      properties: {
        routine: { ...ROUTINE_SCHEMA, required: ['name', 'items'] },
      },
      required: ['routine'],
      additionalProperties: false,
    },
    scope: 'routines:write',
  },
  {
    name: 'update_routine',
    description:
      'Update an existing routine with an id-keyed merge (rows with ids are updated in place; rows without ids are inserted; rows missing from the payload are deleted). Send back the structure from get_routine with ids preserved, mutating only what changed. Pass baseUpdatedAt from get_routine for conflict detection; on 409 re-read and retry.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Routine id' },
        routine: ROUTINE_SCHEMA,
        baseUpdatedAt: {
          type: 'string',
          description:
            'The updatedAt value last read via get_routine (ISO 8601)',
        },
      },
      required: ['id', 'routine'],
      additionalProperties: false,
    },
    scope: 'routines:write',
  },
  {
    name: 'get_workout_history',
    description:
      'Read recent completed workouts (weights kg). With exerciseId, returns per-session sets for that exercise plus derived best set and estimated 1RM (Epley) — use this to plan progressive overload.',
    inputSchema: {
      type: 'object',
      properties: {
        exerciseId: {
          type: 'string',
          description:
            'Focus on one exercise (returns sets + e1RM per session)',
        },
        since: { type: 'string', description: 'ISO 8601 lower bound' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    scope: 'history:read',
  },
];
