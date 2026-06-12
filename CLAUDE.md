# Wolog API

Backend for the Wolog iOS workout logger app. Provides user accounts, authentication, and cloud sync.

## Stack

- **Runtime**: NestJS (Node.js 22 LTS)
- **Database**: PostgreSQL + Prisma 7 ORM
- **Auth**: Sign in with Apple (Google planned), JWT access tokens + rotating refresh tokens
- **Sync**: Offline-first push/pull with last-write-wins conflict resolution
- **Hosting**: Railway (auto-deploy from main)

## Project Structure

```
src/
├── main.ts                 # Bootstrap: /api/v1 prefix, validation pipes, CORS
├── app.module.ts           # Root module: global JWT guard + throttler
├── generated/prisma/       # Prisma 7 generated client (gitignored, generated via prisma generate)
├── common/                 # @CurrentUser, @Public decorators, JwtAuthGuard
├── config/                 # Global ConfigModule (.env)
├── prisma/                 # Global PrismaService (uses @prisma/adapter-pg driver)
├── auth/                   # Apple/Google auth, JWT, refresh tokens, account deletion
├── users/                  # GET /users/me
├── exercises/              # Public exercises list endpoint
├── sync/                   # Push/pull sync engine with conflict resolution
├── shares/                 # Link-based template sharing (POST auth, GET public)
├── oauth/                  # OAuth 2.0 provider for AI connectors (consent, PKCE, scoped tokens)
├── routines/               # AI-facing routines REST (create + id-keyed merge PATCH)
├── workouts/               # AI-facing history read (workouts, per-exercise e1RM)
├── mcp/                    # Remote MCP server for Claude (stateless JSON-RPC at /mcp)
├── openapi/                # OpenAPI 3.1 spec for the ChatGPT Action (/openapi.json)
└── health/                 # GET /health
prisma/
├── schema.prisma           # Database schema (no url — Prisma 7 uses prisma.config.ts)
├── seed.mjs                # Exercise seeder (plain JS, no ts-node needed)
├── exercises.json          # ~800 seeded exercises
└── migrations/
prisma.config.ts            # Prisma 7 config: datasource URL, migration path, seed command
```

## Important: Prisma 7 Setup

Prisma 7 does NOT use `url` in `schema.prisma`. Connection config lives in `prisma.config.ts` at the project root using `env('DATABASE_URL')`.

The generated client outputs to `src/generated/prisma/` (custom output path). Because `prisma.config.ts` exists at root, TypeScript compiles `src/` into `dist/src/`. The NestJS assets config in `nest-cli.json` copies the generated client to `dist/src/generated/` to match.

**Key files for this setup:**
- `prisma.config.ts` — datasource URL + seed config
- `nest-cli.json` — `assets` copies generated client with `outDir: dist/src`
- `tsconfig.build.json` — excludes `prisma/` directory from compilation
- `Dockerfile` — sets dummy `DATABASE_URL` for `prisma generate` at build time

## Commands

**Before pushing:** Always run tests first: `npm test`

```bash
nvm use 22                     # Required: Node 22 LTS
npm run start:dev              # Dev server with watch mode
npm run build                  # Production build (outputs to dist/src/)
npm run start:prod             # Run production build
npx prisma generate            # Regenerate client after schema changes
npx prisma migrate dev         # Create/apply migrations (local dev)
npx prisma studio              # Visual DB browser
node prisma/seed.mjs           # Seed exercises (needs DATABASE_URL)
docker compose up -d postgres  # Start local PostgreSQL
```

## API Routes

All routes prefixed with `/api/v1`. All routes require JWT auth except those marked `@Public`.

### Auth (public)
- `POST /auth/apple` — Sign in with Apple identity token
- `POST /auth/google` — Sign in with Google ID token (not configured yet)
- `POST /auth/refresh` — Refresh access token (rotates refresh token)

### Auth (authenticated)
- `POST /auth/logout` — Revoke refresh token
- `DELETE /auth/account` — Delete account + all data (cascade)

### Users
- `GET /users/me` — Current user profile

### Exercises (public)
- `GET /exercises` — List seeded exercises (params: `limit`, `offset`)

### Sync
- `POST /sync/push` — Push changed entities (workouts, exercises, templates, measurements)
- `POST /sync/pull` — Pull changed entities since cursor (paginated)
- `GET /sync/status` — Last sync timestamps per entity type

### Shares
- `POST /shares` — Create a share (auth required). Body: opaque payload (template + exercises). Returns `{id, url, expiresAt}`. Rate-limited to 30 per user per 24h (returns 429 + `Retry-After`). Payloads > 256 KB return 413. TTL configurable via `SHARE_DEFAULT_TTL_DAYS` (default 90). Share URL prefix configurable via `SHARE_BASE_URL` (default `https://wolog.app/s/`).
- `GET /shares/:id` — Fetch a share (public). Returns 404 if missing, 410 if expired (kept for grace window). Expired shares are deleted daily after a 7-day grace window.

### Health (public)
- `GET /health` — DB connectivity check

### AI Connector (see `docs/AI-CONNECTOR.md`)
Lets Claude (remote MCP at `/mcp`) and ChatGPT (GPT Action via `/openapi.json`) read history/routines and create/update routines for a user, authorized through an OAuth consent screen (`/oauth/*`, root-level — excluded from the `/api/v1` prefix). Scopes: `routines:read`, `routines:write`, `history:read`.
- `GET /routines`, `GET /routines/:id` — read (scope `routines:read`)
- `POST /routines` — create; server resolves exercise names → catalog UUIDs, returns a resolution report; free tier capped at 5 routines (403 `PRO_REQUIRED`, `User.isPro` lifts it)
- `PATCH /routines/:id` — **id-keyed merge** (never delete-and-replace); `baseUpdatedAt` → 409 with current routine on conflict; bumps `updatedAt` so the change reaches the phone via pull sync
- `GET /workouts`, `GET /exercises/:id/history` — history + Epley e1RM (scope `history:read`)
- All weights kg, durations seconds, distances meters
- Connector endpoints accept scoped OAuth tokens (`wlga_…`) or first-party app JWTs (full scopes)

## Architecture Decisions

- **Global JWT guard**: Every route requires auth by default. Use `@Public()` decorator to opt out.
- **Atomic aggregates**: Workout + children (exercises, sets, supersets) sync as one unit in a transaction. On update, children are deleted and re-inserted.
- **Last-write-wins**: `updatedAt` comparison. Server-newer entities are rejected back to client.
- **Soft deletes**: Top-level entities (Workout, Exercise, WorkoutTemplate, BodyMeasurement) have `deletedAt`. Children cascade-delete with their parent.
- **Seeded exercises**: `userId = null` means seeded (bundled in app). `userId` set means custom. Only custom exercises sync.
- **Refresh token rotation**: Each refresh issues a new token and revokes the old one. Tokens are bcrypt-hashed in DB.
- **Google auth**: Code exists but is gated — returns 401 if `GOOGLE_CLIENT_ID` env var is not set.

## Prisma Schema

14 models, 5 enums mirrored from iOS `SharedEnums.swift`:
- **Enums**: ExerciseType (8), MuscleGroup (21), Equipment (10), SetType (4), MeasurementType (15)
- **Auth**: User, RefreshToken
- **Workouts**: Workout → WorkoutExercise → ExerciseSet, WorkoutSuperset
- **Templates**: WorkoutTemplate → TemplateItem → TemplateExercise → TemplateSet, TemplateSuperset
- **Other**: Exercise, BodyMeasurement

All IDs are client-generated UUIDs. All syncable entities have `updatedAt` + `deletedAt`.

## Deployment

- **Railway**: Auto-deploys from `main` branch
- **URL**: `https://wolog-api-local.up.railway.app`
- **Dockerfile**: Multi-stage build → `prisma migrate deploy` → `node dist/src/main.js`
- Seed runs separately (one-time via adding `node prisma/seed.mjs` to Dockerfile CMD, then removing)

## Environment Variables

See `.env.example`. Required for production:
- `DATABASE_URL` — PostgreSQL connection string (Railway: `${{Postgres.DATABASE_URL}}`)
- `JWT_SECRET` — Random secret for signing tokens
- `JWT_ACCESS_EXPIRY` — Access token TTL (default: `15m`)
- `JWT_REFRESH_EXPIRY_DAYS` — Refresh token TTL in days (default: `30`)
- `APPLE_CLIENT_ID` — iOS app bundle ID (`com.tarasdarchuk.wolog`)
- `GOOGLE_CLIENT_ID` — Optional, Google OAuth web client ID
- `PORT` — Server port (default: `3000`)
- `NODE_ENV` — `development` or `production`
- `SHARE_DEFAULT_TTL_DAYS` — TTL for share links in days (default: `90`)
- `SHARE_BASE_URL` — URL prefix for share links (default: `https://wolog.app/s/`)
- `PUBLIC_BASE_URL` — Public API URL, used in OAuth discovery + OpenAPI spec
- `APPLE_WEB_CLIENT_ID` — Apple Services ID for web sign-in on the OAuth consent screen
- `OAUTH_STATIC_CLIENTS` — Optional JSON array of pre-registered OAuth clients (ChatGPT Action)
- `CONNECTOR_ACCESS_TTL_MINUTES` / `CONNECTOR_REFRESH_TTL_DAYS` — Connector token lifetimes (60 / 30)
- `OAUTH_DEV_LOGIN` — `true` enables email dev sign-in on the consent screen (non-production only)

## Related Repo

iOS app: `../wolog/` (SwiftUI + SwiftData)
- Exercises JSON seed data: `../wolog/wolog/Resources/exercises.json` (also copied to `prisma/exercises.json`)
- Enum definitions: `../wolog/wolog/Shared/SharedEnums.swift`
