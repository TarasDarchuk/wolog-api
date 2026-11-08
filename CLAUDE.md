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
├── users/                  # GET /users/me, Pro + paywall cohort reports
├── subscriptions/          # Hard paywall: cohort, access, Adapty webhook + server API, @RequiresAccess (402)
├── exercises/              # Public exercises list endpoint
├── sync/                   # Push/pull sync engine with conflict resolution
├── storage/                # StorageService: S3-compatible bucket (presigned PUT/GET, head, delete)
├── photos/                 # Photo upload/complete/download-url (workout + measurement) + abandoned-upload cleanup
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
- `GET /users/me` — Current user profile, incl. `trainingProfile` (`null` if never set), `paywallCohort` (`legacy|new|null`) and `access` (`full|locked`) — see Subscriptions
- `PUT /users/me/training-profile` — Onboarding answers, full replace (omitted → `null`, `goals` → `[]`). `goals` ≤2 unique of `gainMuscle|getStronger|loseWeight` (primary first), `level` `beginner|intermediate|advanced`, `equipment` `fullGym|dumbbells|bodyweight`, `daysPerWeek` 2–6, `useMetric`, `starterProgramId`, `onboardingCompletedAt`. Exposed to AI connectors as MCP `get_training_profile` and `GET /training-profile` (scope `history:read`)
- `PUT /users/me/pro` — App reports subscription state (first-party JWT only). For `new`-cohort accounts the Adapty webhook wins — see Subscriptions
- `PUT /users/me/paywall-cohort` — `{cohort: "legacy"|"new"}`, one-way (see Subscriptions)

### Exercises (public)
- `GET /exercises` — List seeded exercises (params: `limit`, `offset`)

### Sync
- `POST /sync/push` — Push changed entities (workouts, exercises, templates, measurements)
- `POST /sync/pull` — Pull changed entities since cursor (paginated)
- `GET /sync/status` — Last sync timestamps per entity type

### Photos (see `../wolog/docs/photo-sync-api.md`)
One `Photo` table for workout photos (`workoutId` set, ≤10 per workout) and measurement progress photos (`workoutId` null, referenced by `BodyMeasurement.photoId` — no FK, shared by measurements saved together). Bytes go straight to the bucket at `photos/{userId}/{photoId}.jpg`, ids lowercased (`photoKey`); iOS sends uppercase `UUID.uuidString` while Postgres returns lowercase, and S3 keys are case-sensitive. Objects uploaded before the fix sit under the uppercase-id key: `complete` and `download-url` look under both (`photoKeys`), deletes remove both.
- Workout push `photos`: missing = untouched, present = full list (upsert, never reset `uploadedAt`; removed ones deleted + objects). Pull always returns `photos` with `uploaded`
- Measurement push `photo`: missing = keep `photoId`, `null` = clear, object = set + upsert row. Unreferenced progress photos are deleted. Pull returns `photo` (`null` or `{id,width,height,uploaded}`)
- `POST /photos/:id/upload-url` — presigned PUT (15 min) + signed headers. Body `{contentType: "image/jpeg", byteSize ≤ 10 MB}`
- `POST /photos/:id/complete` — HEAD the object (409 if missing), set `uploadedAt`, bump owner `updatedAt` (workout, or every measurement with that `photoId`); idempotent → 204
- `GET /photos/:id/download-url` — presigned GET (1 h)
- All return 404 for unknown/foreign photos (client re-pushes the owner on 404 — never 403, never create rows)

### Shares
- `POST /shares` — Create a share (auth required). Body: opaque payload (template + exercises). Returns `{id, url, expiresAt}`. Rate-limited to 30 per user per 24h (returns 429 + `Retry-After`). Payloads > 256 KB return 413. TTL configurable via `SHARE_DEFAULT_TTL_DAYS` (default 90). Share URL prefix configurable via `SHARE_BASE_URL` (default `https://wolog.app/s/`).
- `GET /shares/:id` — Fetch a share (public). Returns 404 if missing, 410 if expired (kept for grace window). Expired shares are deleted daily after a 7-day grace window.

### Subscriptions — hard paywall (`src/subscriptions/`)
New installs get a hard paywall; everyone who existed before it never changes.
- **Cohort** `User.paywallCohort`: migration backfilled `LEGACY` for every existing account; `null` (accounts made by older app versions) counts as legacy. `PUT /users/me/paywall-cohort`: a set cohort is final (`new` stays `new` when the app reports legacy — a reinstall keeps the Keychain session, so the device says legacy; `legacy → new` → 409), `null → legacy` always, `null → new` only while the account is < 24 h old with 0 workouts (else 409)
- **Access** (`computeAccess`): `locked` only for `NEW` without active Pro (`isPro` and `proExpiresAt` + 24 h grace not passed). Legacy/null are always `full` — their free tier is unchanged
- **Locked users**: sync (`/sync/*`) and photos keep working (no data loss); every GET (history, routines, PRs, exercise history, training profile) stays open — the web shows it read-only with export; writes marked `@RequiresAccess()` (`RequiresAccessGuard`) answer **402** `{"error":"subscription_required","message":…}`: `POST/PATCH/DELETE` on `/routines` (+ `/routines/programs`), `/folders`, `/exercises`, and `POST /shares`. Never put it on sync, photos, `/users/me*`, `/auth/*` or webhooks. On a method that also has `@UseGuards(ConnectorAuthGuard)`, put `@RequiresAccess()` above it (guards run in order; it fails closed without `req.user`). MCP is fully locked: every tool returns "subscription required"
- **`POST /webhooks/adapty`** (public, no throttle): `Authorization` must equal `ADAPTY_WEBHOOK_SECRET` (timing-safe), `{}` = dashboard handshake, dedup by `event_properties.profile_event_id`, always 200 (Adapty pauses delivery after failures). Every event is stored in `SubscriptionEvent` (A/B test, paywall, product — for our own analysis); events mapped to a user via `customer_user_id` (= Wolog user id) set `isPro`/`proExpiresAt` (`access_level_updated` for `premium`, else `profile_has_access_level`)
- **Webhook beats the client**: for a `NEW` account that has at least one `SubscriptionEvent`, `PUT /users/me/pro` `isPro: true` is applied only if Adapty's server API (`GET /api/v2/server-side-api/profile/`, `ADAPTY_SECRET_KEY`) shows an active `premium` level; `isPro: false` is ignored while the stored webhook state is active. No key / Adapty down → the app is trusted and a warning logged. Legacy/null accounts, and `NEW` ones the webhook hasn't reported yet (purchase before `Adapty.identify`), still trust the app

### Health (public)
- `GET /health` — DB connectivity check

### AI Connector (see `docs/AI-CONNECTOR.md`)
Lets Claude (remote MCP at `/mcp`) and ChatGPT (GPT Action via `/openapi.json`) read history/routines and create/update routines for a user, authorized through an OAuth consent screen (`/oauth/*`, root-level — excluded from the `/api/v1` prefix). Scopes: `routines:read`, `routines:write`, `history:read`.
- `POST /exercises`, `PATCH /exercises/:id`, `DELETE /exercises/:id` — the user's **custom** exercises only (scope `routines:write`; library exercises read-only → 403). Delete is refused (409) while any workout or live routine uses the exercise. MCP: `create_exercise`, `update_exercise`, `delete_exercise`; `list_exercises` takes `customOnly`
- `GET /routines`, `GET /routines/:id` — read (scope `routines:read`)
- `POST /routines` — create; server resolves exercise names → catalog UUIDs, returns a resolution report; free tier capped at 5 routines (403 `PRO_REQUIRED`, `User.isPro` lifts it)
- `PATCH /routines/:id` — **id-keyed merge** (never delete-and-replace); `baseUpdatedAt` → 409 with current routine on conflict; bumps `updatedAt` so the change reaches the phone via pull sync
- `DELETE /routines/:id` — soft delete (bumps `updatedAt`, reaches the phone via pull sync)
- `GET /workouts`, `GET /exercises/:id/history` — **recent** history + Epley e1RM (scope `history:read`); `/exercises/:id/history` also returns `allTime` records
- `GET /personal-records` — all-time records per exercise over the whole history (MCP `get_personal_records`). History tools are paged to recent sessions, so without this the AI misses older PRs
- `GET /training-profile` — onboarding answers (scope `history:read`; MCP tool `get_training_profile`)
- All weights kg, durations seconds, distances meters
- Connector endpoints accept scoped OAuth tokens (`wlga_…`) or first-party app JWTs (full scopes)

## Architecture Decisions

- **Global JWT guard**: Every route requires auth by default. Use `@Public()` decorator to opt out.
- **Per-user rate limiting**: `UserThrottlerGuard` keys on the user id (app JWT or connector token, resolved before the controller guard), falling back to client IP (`trust proxy` = 1 for Railway; for the web app's BFF, the `X-Wolog-Client-IP` it forwards with `BFF_SHARED_SECRET`). AI-connector traffic comes from shared provider IPs, so IP keys would throttle users against each other.
- **Atomic aggregates**: Workout + children (exercises, sets, supersets) sync as one unit in a transaction. On update, children are deleted and re-inserted.
- **Last-write-wins**: `updatedAt` comparison. Server-newer entities are rejected back to client.
- **Soft deletes**: Top-level entities (Workout, Exercise, WorkoutTemplate, BodyMeasurement) have `deletedAt`. Children cascade-delete with their parent.
- **Seeded exercises**: `userId = null` means seeded (bundled in app). `userId` set means custom. Only custom exercises sync.
- **Refresh token rotation**: Each refresh issues a new token and revokes the old one. Tokens are bcrypt-hashed in DB.
- **Google auth**: Code exists but is gated — returns 401 if `GOOGLE_CLIENT_ID` env var is not set.

## Prisma Schema

16 models, 5 enums mirrored from iOS `SharedEnums.swift`:
- **Enums**: ExerciseType (8), MuscleGroup (21), Equipment (10), SetType (4), MeasurementType (15)
- **Auth**: User, RefreshToken, TrainingProfile (1:1, cascade)
- **Workouts**: Workout → WorkoutExercise → ExerciseSet, WorkoutSuperset, Photo
- **Templates**: WorkoutTemplate → TemplateItem → TemplateExercise → TemplateSet, TemplateSuperset
- **Other**: Exercise, BodyMeasurement (→ Photo via `photoId`)
- **Subscriptions** (server-only, not synced): `User.paywallCohort` (enum `PaywallCohort` LEGACY|NEW), `User.proExpiresAt`, SubscriptionEvent (raw Adapty webhook events)

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
- `APPLE_CLIENT_ID` — iOS app bundle ID(s), comma-separated (`com.tarasdarchuk.wolog`; dev server also `com.tarasdarchuk.wolog.dev`)
- `GOOGLE_CLIENT_ID` — Optional, Google OAuth web client ID
- `PORT` — Server port (default: `3000`)
- `NODE_ENV` — `development` or `production`
- `SHARE_DEFAULT_TTL_DAYS` — TTL for share links in days (default: `90`)
- `SHARE_BASE_URL` — URL prefix for share links (default: `https://wolog.app/s/`)
- `PUBLIC_BASE_URL` — Public API URL, used in OAuth discovery + OpenAPI spec
- `APPLE_WEB_CLIENT_ID` — Apple Services ID for web sign-in (OAuth consent screen and the my.wolog.app web app via `POST /auth/apple`)
- `OAUTH_STATIC_CLIENTS` — Optional JSON array of pre-registered OAuth clients (ChatGPT Action)
- `CONNECTOR_ACCESS_TTL_MINUTES` / `CONNECTOR_REFRESH_TTL_DAYS` — Connector token lifetimes (60 / 30)
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — workout photo bucket (Railway bucket service `workout-photos`; set as `${{workout-photos.*}}` references). Without them photo endpoints return 503. Read once at startup: after resetting the bucket credentials, **redeploy wolog-api**, or presigned uploads keep failing with 403 (Oct 2026: a week of stranded photo uploads). An hourly probe (`StorageService.probeUploads`) does a real presigned PUT and logs an error if it fails
- `TELEGRAM_ALERT_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` — optional. Every error-level log (unhandled 5xx, failed sync pushes, S3 failures, the upload probe) is forwarded to this Telegram chat by `AlertingLogger` (deduplicated per 30 min, max 20/hour)
- `ADAPTY_WEBHOOK_SECRET` — must equal the Adapty dashboard webhook "Authorization header value". One webhook per server: sandbox → dev, production → prod. Unset → the webhook answers 401
- `ADAPTY_SECRET_KEY` — Adapty secret API key (App Settings → General → API keys) for the server API that verifies `isPro: true` claims. Optional: unset → the app's claim is trusted (warning logged)
- `BFF_SHARED_SECRET` — Shared with the web app (my.wolog.app). Its server-side calls send `X-Wolog-Bff-Secret` + `X-Wolog-Client-IP`, and the rate limiter keys anonymous web traffic on that IP instead of the BFF's
- `OAUTH_DEV_LOGIN` — `true` enables email dev sign-in on the consent screen (non-production only)

## Related Repo

iOS app: `../wolog/` (SwiftUI + SwiftData)
- Exercises JSON seed data: `../wolog/wolog/Resources/exercises.json` (also copied to `prisma/exercises.json`)
- Enum definitions: `../wolog/wolog/Shared/SharedEnums.swift`

## Notion

The whole Wolog product (iOS app `wolog`, API `wolog-api`, web app `wolog-web`, landing `wolog-landing`) shares one Notion page, "Wolog": https://app.notion.com/p/3241b7ea87b881e19e29f9589a4b6499 (read and write it through the Notion MCP).

- **Feature Roadmap** database: unbuilt ideas only, tagged with `Project` (iOS / API / Web / Landing). When Taras mentions an idea for later, add a row there. When work here ships one of those ideas, delete its row.
- **Epic: Trainer**, **Epic: Coach** and **Epic: Hard Paywall** databases: big multi-task features, one row per task. A new big feature gets its own `Epic: …` database on the Wolog page instead of crowding Feature Roadmap.
- **Video Content System — Short-form**: marketing video process.

The code is the source of truth for status, bugs and decisions. Don't create trackers, logs or checklists in Notion.
