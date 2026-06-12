/**
 * OpenAPI 3.1 spec for the ChatGPT GPT Action wrapper (§9). Same REST surface
 * and OAuth provider the Claude MCP connector uses — this is just the spec
 * file the GPT builder points at.
 */

const SET_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Keep on update; omit for new sets' },
    setNumber: { type: 'integer' },
    targetWeight: {
      type: ['number', 'null'],
      description: 'Target weight in KILOGRAMS (never pounds)',
    },
    targetReps: { type: ['integer', 'null'] },
    targetDuration: { type: ['number', 'null'], description: 'Seconds' },
    targetDistance: { type: ['number', 'null'], description: 'Meters' },
  },
};

const EXERCISE_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Routine-exercise row id — keep on update, omit when adding',
    },
    exerciseId: {
      type: 'string',
      description: 'Catalog exercise UUID; optional when "name" is given',
    },
    name: {
      type: 'string',
      description:
        'Exercise name — the server resolves it against the catalog and the user’s custom exercises',
    },
    targetSets: { type: 'integer' },
    targetReps: { type: 'integer' },
    notes: { type: ['string', 'null'] },
    restTimerSeconds: { type: ['integer', 'null'] },
    sets: { type: 'array', items: SET_SCHEMA },
  },
};

const ITEM_SCHEMA = {
  type: 'object',
  description: 'Exactly one of "exercise" or "superset"',
  properties: {
    id: { type: 'string', description: 'Keep on update; omit for new items' },
    exercise: EXERCISE_SCHEMA,
    superset: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        supersetColorIndex: { type: 'integer' },
        exercises: { type: 'array', items: EXERCISE_SCHEMA },
      },
      required: ['exercises'],
    },
  },
};

const RESOLUTION_SCHEMA = {
  type: 'object',
  description:
    'How a requested exercise was matched. Surface low-confidence or createdCustom entries to the user.',
  properties: {
    requested: { type: 'string' },
    resolvedTo: { type: 'string' },
    id: { type: 'string' },
    method: {
      type: 'string',
      enum: ['id', 'exact', 'normalized', 'fuzzy', 'created_custom'],
    },
    confidence: { type: 'number' },
    createdCustom: { type: 'boolean' },
  },
};

const ROUTINE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Pass back as baseUpdatedAt when updating',
    },
    items: { type: 'array', items: ITEM_SCHEMA },
  },
};

export function buildConnectorOpenApiSpec(publicBaseUrl: string) {
  const base = publicBaseUrl.replace(/\/$/, '');
  return {
    openapi: '3.1.0',
    info: {
      title: 'Wolog AI Connector',
      version: '1.0.0',
      description:
        'Read workout history and routines, and create/update routines, in a Wolog user’s account. ' +
        'ALL weights are kilograms, durations seconds, distances meters. ' +
        'Always GET a routine before PATCHing it and preserve every id in the structure you send back.',
    },
    servers: [{ url: `${base}/api/v1` }],
    security: [{ oauth2: ['routines:read', 'routines:write', 'history:read'] }],
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: `${base}/oauth/authorize`,
              tokenUrl: `${base}/oauth/token`,
              refreshUrl: `${base}/oauth/token`,
              scopes: {
                'routines:read': 'Read your workout routines',
                'routines:write': 'Create and update workout routines',
                'history:read': 'Read your workout history',
              },
            },
          },
        },
      },
      schemas: {
        Routine: ROUTINE_RESPONSE_SCHEMA,
        RoutineItem: ITEM_SCHEMA,
        Resolution: RESOLUTION_SCHEMA,
      },
    },
    paths: {
      '/exercises': {
        get: {
          operationId: 'listExercises',
          summary:
            'Search the exercise catalog (library + user customs) to find exact names/ids',
          parameters: [
            { name: 'query', in: 'query', schema: { type: 'string' } },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', maximum: 200 },
            },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'Catalog page',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      exercises: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            muscleGroup: { type: 'string' },
                            equipment: { type: 'string' },
                            exerciseType: { type: 'string' },
                            isCustom: { type: 'boolean' },
                          },
                        },
                      },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/routines': {
        get: {
          operationId: 'listRoutines',
          summary: 'List routine summaries',
          responses: {
            '200': {
              description: 'Routine summaries',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      routines: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            notes: { type: ['string', 'null'] },
                            exerciseCount: { type: 'integer' },
                            updatedAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createRoutine',
          summary:
            'Create a routine (appears in the user’s app on next sync). Weights in kg.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'items'],
                  properties: {
                    name: { type: 'string' },
                    notes: { type: 'string' },
                    items: { type: 'array', items: ITEM_SCHEMA },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created routine + exercise resolution report',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      routine: { $ref: '#/components/schemas/Routine' },
                      resolutions: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Resolution' },
                      },
                    },
                  },
                },
              },
            },
            '403': {
              description:
                'Free-tier routine limit reached (code PRO_REQUIRED) — tell the user to upgrade to Wolog Pro',
            },
          },
        },
      },
      '/routines/{id}': {
        get: {
          operationId: 'getRoutine',
          summary:
            'Read a routine in full (always do this before updating; preserve all ids)',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Full routine',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Routine' },
                },
              },
            },
            '404': { description: 'Not found' },
          },
        },
        patch: {
          operationId: 'updateRoutine',
          summary:
            'Id-keyed merge update: rows with ids update in place, rows without ids insert, rows missing from the payload delete. Send back the structure from getRoutine with ids preserved.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    notes: { type: 'string' },
                    items: { type: 'array', items: ITEM_SCHEMA },
                    baseUpdatedAt: {
                      type: 'string',
                      format: 'date-time',
                      description:
                        'updatedAt from getRoutine; mismatch returns 409 with the current routine',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated routine + resolution report',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      routine: { $ref: '#/components/schemas/Routine' },
                      resolutions: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Resolution' },
                      },
                    },
                  },
                },
              },
            },
            '409': {
              description:
                'Routine changed since baseUpdatedAt — body contains the current routine; re-read and retry',
            },
          },
        },
      },
      '/workouts': {
        get: {
          operationId: 'getWorkoutHistory',
          summary: 'Recent completed workouts, newest first (weights kg)',
          parameters: [
            {
              name: 'since',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
            },
            { name: 'exerciseId', in: 'query', schema: { type: 'string' } },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', maximum: 100 },
            },
          ],
          responses: {
            '200': { description: 'Workouts with exercises and sets' },
          },
        },
      },
      '/exercises/{id}/history': {
        get: {
          operationId: 'getExerciseHistory',
          summary:
            'Per-session sets for one exercise with derived best set and estimated 1RM (Epley) — use for progressive overload',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', maximum: 50, default: 10 },
            },
          ],
          responses: {
            '200': { description: 'Sessions with sets, best set, e1RM' },
          },
        },
      },
    },
  };
}
