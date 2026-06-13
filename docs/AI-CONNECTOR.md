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
- **Tokens**: opaque (`wlga_` access / `wlgr_` refresh), SHA-256-hashed at
  rest, rotating refresh with replay detection, revocable via `/oauth/revoke`
  (revocation is immediate). Default TTLs: access 60 min, refresh 30 days.
- **PATCH semantics**: id-keyed merge — rows with known ids update in place
  (UUIDs survive, phone-side tweaks aren't clobbered), rows without ids
  insert, rows missing from the payload delete. `baseUpdatedAt` gives
  optimistic concurrency (409 + current routine on conflict).
- **Name resolution**: create/update accept exercises by name; the server
  resolves (exact → normalized → fuzzy with synonyms like ohp/rdl/db) against
  the seeded library + the user's customs, and creates a custom exercise when
  nothing matches confidently. Every response carries a resolution report.
- **History**: only completed, non-deleted workouts are returned (soft-deleted
  `deletedAt` rows are excluded), matching what the user sees in the app.
- **Free tier**: routine creation is limited to 5 routines (`User.isPro`
  lifts it); a 6th create returns 403 with `code: "PRO_REQUIRED"`.
  Resolver-created custom exercises are not gated.

## Endpoints

Root-level (no `/api/v1` prefix — see the `exclude` list in `main.ts`):

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
| `GET /favicon.ico`, `/icon-{192,512}.png`, `/apple-icon.png` | Brand icon |

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
`update_routine`, `get_workout_history` — same services underneath. Each tool
carries annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`).

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `PUBLIC_BASE_URL` | **yes** | Public URL of this deployment, e.g. `https://api.wolog.app`. Drives OAuth discovery, the Apple `redirectURI`, OpenAPI `servers`, and the `WWW-Authenticate` pointer. **If unset it falls back to `http://localhost:3000` and the whole flow breaks** — set it per environment. |
| `JWT_SECRET` | yes | Also verifies connector-accepted app JWTs. Use a distinct, unshared secret per environment. |
| `APPLE_CLIENT_ID` | yes (Apple) | The iOS **bundle id** (`com.tarasdarchuk.wolog`) — verifies app-issued Apple tokens. |
| `APPLE_WEB_CLIENT_ID` | yes (Apple web) | The Apple **Services ID** (`com.taras.wolog.signin`) — the consent screen's `clientId` and a second accepted audience. |
| `GOOGLE_CLIENT_ID` | yes (Google) | The **iOS** Google client — verifies app-issued Google tokens. |
| `GOOGLE_WEB_CLIENT_ID` | yes (Google web) | A **Web-application** Google client — renders the consent-screen GSI button. The backend verifies app + web Google tokens against **both** ids. |
| `OAUTH_STATIC_CLIENTS` | for ChatGPT | JSON array of pre-registered clients (see ChatGPT section). |
| `CONNECTOR_ACCESS_TTL_MINUTES` / `CONNECTOR_REFRESH_TTL_DAYS` | no | Token lifetimes (default 60 / 30). |
| `OAUTH_DEV_LOGIN` | no | `true` shows an email-only login on the consent screen for local testing. **Double-gated**: only active when `OAUTH_DEV_LOGIN==='true'` AND `NODE_ENV!=='production'`. Never set in production. |
| `APPLE_DOMAIN_ASSOCIATION` | no | Legacy. Apple no longer requires the domain-association file for SIWA JS; leave empty. |

## One-time provider setup

### Apple — Sign in with Apple (web)

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → **＋ →
   Services IDs**. Identifier becomes `APPLE_WEB_CLIENT_ID` (must differ from
   the bundle id — e.g. `com.taras.wolog.signin`).
2. Enable **Sign in with Apple** → **Configure**:
   - **Primary App ID**: the app's App ID (`…com.tarasdarchuk.wolog`).
   - **Domains and Subdomains**: every host that serves the consent page
     (comma-separated), e.g. `api.wolog.app, wolog-api-production.up.railway.app`.
   - **Return URLs**: `https://<host>/oauth/authorize` for each host.
3. **No domain-association file is needed** — Apple dropped that requirement
   for SIWA JS; registering the Services ID + domain + return URL is enough.
4. Set `APPLE_WEB_CLIENT_ID` to the Services ID.

The consent page loads Apple's JS SDK in popup mode and posts the returned
`id_token` back to `/oauth/consent`. Popup mode needs
`Cross-Origin-Opener-Policy: same-origin-allow-popups` (set on the authorize
response in `oauth.controller.ts` — helmet's default `same-origin` breaks the
popup callback).

### Google — Sign in with Google (web)

1. console.cloud.google.com → same project as the iOS client → APIs & Services
   → Credentials → **Create Credentials → OAuth client ID → Web application**.
2. **Authorized JavaScript origins**: each consent-page host
   (`https://api.wolog.app`, …). No redirect URI needed (GSI returns the token
   to JS).
3. No client secret is used (GSI credential flow). Set `GOOGLE_WEB_CLIENT_ID`
   to the new web client id; leave `GOOGLE_CLIENT_ID` as the iOS client.
4. If the OAuth consent screen is in **Testing**, add testers or publish it.

## Connecting Claude (remote MCP)

1. Deploy with `PUBLIC_BASE_URL` + Apple/Google web sign-in configured.
2. claude.ai → Settings → Connectors → **Add custom connector** → `https://<host>/mcp`.
   Leave OAuth client id/secret blank — Claude discovers the auth server from
   the 401 challenge + well-known metadata and self-registers via
   `/oauth/register` (PKCE public client).
3. Sign in (Apple/Google) on the consent screen, grant the three scopes, done.

Because the Apple Services ID / Google web client share the app's identity
team/account, signing in resolves to the **same user** as the iOS app, so
created routines appear on the phone after the next sync.

## Connecting ChatGPT (GPT Action)

1. Pre-register a confidential client via `OAUTH_STATIC_CLIENTS` (JSON array):
   ```
   OAUTH_STATIC_CLIENTS='[{"id":"chatgpt-action","name":"ChatGPT","secret":"<random>","redirectUris":["https://chat.openai.com/aip/<gpt-id>/oauth/callback"]}]'
   ```
   The exact callback URL is shown by the GPT builder after you create the
   Action — add it to `redirectUris` and redeploy.
2. In the GPT builder, add an Action importing `https://<host>/openapi.json`,
   auth type **OAuth**, with the client id/secret and the authorize/token URLs
   (they're in the spec / discovery metadata).

## Deploying (Railway)

Environments: **dev** = `wolog-api-local.up.railway.app`, **prod** =
`wolog-api-production.up.railway.app` (custom domain `api.wolog.app`). Each is a
separate Railway environment with its own variables and Postgres.

Checklist per environment:
1. Set the env vars above. **Railway bakes env at deploy time — adding or
   changing a variable requires a redeploy to take effect** (a running instance
   keeps its old values until restarted).
2. The migration applies automatically (`prisma migrate deploy` in the
   Dockerfile). **Seed the exercise catalog** or the resolver matches nothing:
   `node prisma/seed.mjs` against that environment's `DATABASE_URL`.
3. Production must run `NODE_ENV=production` and **must not** set
   `OAUTH_DEV_LOGIN`.
4. Verify discovery points at the right host:
   `curl https://<host>/.well-known/oauth-authorization-server` → `issuer`
   should be `https://<host>`, not `localhost`.

### Custom domain (and the connector icon)

claude.ai derives a custom connector's icon from the host's favicon. On a
`*.up.railway.app` host it resolves to **Railway's** icon (the app's own
`/favicon.ico` serves the Wolog mark, but claude.ai's favicon lookup keys on
the `railway.app` domain). Fixes:
- **Custom domain** (`api.wolog.app`): Railway service → add domain → set the
  CNAME it provides on the DNS host → update `PUBLIC_BASE_URL`, add the domain
  to the Apple Services ID + Google origins, re-add the connector. The favicon
  then resolves to the Wolog mark.
- **Connectors Directory** submission: you upload the icon; guaranteed, but a
  public listing + review.

## Testing

`scripts/connector-smoke.mjs` exercises the whole surface against any
deployment (discovery → dynamic registration → consent → PKCE token exchange →
create/patch/409 → MCP → revocation):

```bash
node scripts/connector-smoke.mjs https://<host> you@example.com
```

It uses dev email login, so it requires `OAUTH_DEV_LOGIN=true` on the target —
i.e. it works on dev, **not** on production. Test prod via the real Claude
connector with Apple/Google sign-in. Connector endpoints also accept a
first-party app JWT (full scopes) for testing before OAuth is wired.

## Decisions taken (spec §11)

- **Concurrency**: optimistic — `baseUpdatedAt` → 409 with current routine.
  Without `baseUpdatedAt` it's last-write-wins and the response always carries
  the fresh `updatedAt`.
- **Provenance marker**: none for now (routine `notes` can carry it if wanted).
- **Resolver-created customs**: not counted against any custom-exercise limit.
