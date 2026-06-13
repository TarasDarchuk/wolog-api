# Wolog AI Connector

Lets an external AI assistant (Claude via remote MCP, ChatGPT via a GPT Action)
read a user's workout history and routines and create/update routines on their
behalf. The user authorizes once via an OAuth consent screen; created/updated
routines reach the phone through the existing pull sync — no iOS changes.

## Architecture

```
Claude / ChatGPT
   │  OAuth 2.0 (authorization code + PKCE)
   ▼
/oauth/*  ──────────────  consent screen (Apple/Google web sign-in)
   │  opaque scoped bearer token (wlga_…)
   ▼
/mcp (Claude, JSON-RPC)        /api/v1/* REST (ChatGPT Action, openapi.json)
   └──────────────┬────────────┘
                  ▼
   RoutinesService / WorkoutsService / ExerciseResolverService
                  ▼
   WorkoutTemplate rows (same tables the sync layer reads)
                  ▼
   iOS app pulls on next sync (updatedAt cursor)
```

- **Units**: weights kg, durations seconds, distances meters — always.
- **Scopes**: `routines:read`, `routines:write`, `history:read`, enforced
  per endpoint/tool. First-party app JWTs implicitly carry all scopes.
- **Tokens**: opaque, SHA-256-hashed at rest, rotating refresh with replay
  detection, revocable via `/oauth/revoke` (revocation is immediate).
- **PATCH semantics**: id-keyed merge — rows with known ids update in place
  (UUIDs survive, phone-side tweaks aren't clobbered), rows without ids
  insert, rows missing from the payload delete. `baseUpdatedAt` gives
  optimistic concurrency (409 + current routine on conflict).
- **Name resolution**: create/update accept exercises by name; the server
  resolves (exact → normalized → fuzzy with synonyms like ohp/rdl/db) against
  the seeded library + the user's customs, and creates a custom exercise when
  nothing matches confidently. Every response carries a resolution report.
- **Free tier**: routine creation is limited to 5 routines (`User.isPro`
  lifts it); a 6th create returns 403 with `code: "PRO_REQUIRED"`.
  Resolver-created custom exercises are not gated.

## Endpoints

Root-level (no `/api/v1` prefix):

| Route | Purpose |
|---|---|
| `GET /oauth/authorize` | Consent screen (sign-in + Allow/Cancel) |
| `POST /oauth/consent` | Consent form submit (issues auth code) |
| `POST /oauth/token` | Code exchange + refresh (form or JSON body) |
| `POST /oauth/revoke` | RFC 7009 revocation |
| `POST /oauth/register` | RFC 7591 dynamic client registration (Claude) |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `GET /.well-known/oauth-protected-resource[/mcp]` | RFC 9728 metadata |
| `POST /mcp` | Remote MCP server (stateless streamable HTTP) |
| `GET /openapi.json` | OpenAPI 3.1 spec for the GPT Action |

Under `/api/v1` (connector token or app JWT):

| Route | Scope | Purpose |
|---|---|---|
| `GET /exercises?query=` | — (public; token merges customs) | Catalog search |
| `GET /routines` | routines:read | Summaries |
| `GET /routines/:id` | routines:read | Full routine with ids + updatedAt |
| `POST /routines` | routines:write | Create (resolution report, Pro gate) |
| `PATCH /routines/:id` | routines:write | Id-keyed merge, 409 on stale baseUpdatedAt |
| `GET /workouts?since=&exerciseId=&limit=` | history:read | Completed workouts |
| `GET /exercises/:id/history?limit=` | history:read | Per-session sets + best set + Epley e1RM |

MCP tools: `list_exercises`, `list_routines`, `get_routine`, `create_routine`,
`update_routine`, `get_workout_history` — same services underneath.

## Connecting Claude (remote MCP)

1. Deploy with `PUBLIC_BASE_URL` set; configure `APPLE_WEB_CLIENT_ID` (an Apple
   *Services ID* with the API domain registered) and/or `GOOGLE_CLIENT_ID` so
   the consent screen has a sign-in method.
2. In Claude → Settings → Connectors → Add custom connector, enter
   `https://<host>/mcp`. Claude discovers the OAuth server via the 401
   challenge + well-known metadata and self-registers through
   `/oauth/register` (PKCE public client).
3. User signs in on the consent screen, grants the three scopes, done.

## Connecting ChatGPT (GPT Action)

1. Register a confidential client via `OAUTH_STATIC_CLIENTS` (generate a
   random secret). Leave `redirectUris` empty at first — the GPT builder shows
   the callback URL (`https://chat.openai.com/aip/<gpt-id>/oauth/callback`)
   after you create the action; then add it and redeploy.
2. In the GPT builder, add an Action importing `https://<host>/openapi.json`,
   auth type OAuth, with the client id/secret and the authorize/token URLs
   from the spec.

## Testing on staging / locally without Apple/Google web sign-in

Set `OAUTH_DEV_LOGIN=true` (non-production only): the consent screen shows an
email field that signs in/creates a user directly. Connector endpoints also
accept a first-party app JWT with full scopes, so the round-trip can be tested
with a normal app login before OAuth is configured.

`scripts/connector-smoke.mjs` runs the whole surface against any deployment
(discovery → DCR → consent → PKCE → create/patch/409 → MCP → revocation):

```bash
node scripts/connector-smoke.mjs https://<staging-host> you@example.com
```

Using the same email/account you signed into the iOS app with lets you watch
the created routine arrive on the phone after the next sync.

## Decisions taken (spec §11)

- **Concurrency**: optimistic — `baseUpdatedAt` → 409 with current routine.
  Without `baseUpdatedAt` it's last-write-wins and the response always carries
  the fresh `updatedAt`.
- **Provenance marker**: none for now (routine `notes` can carry it if wanted).
- **Resolver-created customs**: not counted against any custom-exercise limit.
