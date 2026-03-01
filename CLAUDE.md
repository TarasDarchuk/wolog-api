# Wolog API

Backend for the Wolog iOS workout logger app. Provides user accounts, authentication, and cloud sync.

## Stack

- **Runtime**: NestJS (Node.js)
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: Sign in with Apple + Google OAuth, JWT access tokens + rotating refresh tokens
- **Sync**: Offline-first push/pull with last-write-wins conflict resolution

## Project Structure

```
src/
├── main.ts                 # Bootstrap: /api/v1 prefix, validation pipes, CORS
├── app.module.ts           # Root module: global JWT guard + throttler
├── common/                 # @CurrentUser, @Public decorators, JwtAuthGuard
├── config/                 # Global ConfigModule (.env)
├── prisma/                 # Global PrismaService
├── auth/                   # Apple/Google auth, JWT, refresh tokens, account deletion
├── users/                  # GET /users/me
├── sync/                   # Push/pull sync engine with conflict resolution
└── health/                 # GET /health
```

## Commands

```bash
npm run start:dev          # Dev server with watch mode
npm run build              # Production build
npm run start:prod         # Run production build
npx prisma migrate dev     # Create/apply migrations
npx prisma generate        # Regenerate Prisma client after schema changes
npm run db:seed            # Seed exercises from iOS exercises.json
npx prisma studio          # Visual DB browser
docker compose up -d postgres  # Start local PostgreSQL
```

## API Routes

All routes prefixed with `/api/v1`. All routes require JWT auth except those marked `@Public`.

### Auth (public)
- `POST /auth/apple` — Sign in with Apple identity token
- `POST /auth/google` — Sign in with Google ID token
- `POST /auth/refresh` — Refresh access token (rotates refresh token)

### Auth (authenticated)
- `POST /auth/logout` — Revoke refresh token
- `DELETE /auth/account` — Delete account + all data (cascade)

### Users
- `GET /users/me` — Current user profile

### Sync
- `POST /sync/push` — Push changed entities (workouts, exercises, templates, measurements)
- `POST /sync/pull` — Pull changed entities since cursor (paginated)
- `GET /sync/status` — Last sync timestamps per entity type

### Health (public)
- `GET /health` — DB connectivity check

## Architecture Decisions

- **Global JWT guard**: Every route requires auth by default. Use `@Public()` decorator to opt out.
- **Atomic aggregates**: Workout + children (exercises, sets, supersets) sync as one unit in a transaction. On update, children are deleted and re-inserted.
- **Last-write-wins**: `updatedAt` comparison. Server-newer entities are rejected back to client.
- **Soft deletes**: Top-level entities (Workout, Exercise, WorkoutTemplate, BodyMeasurement) have `deletedAt`. Children cascade-delete with their parent.
- **Seeded exercises**: `userId = null` means seeded (bundled in app). `userId` set means custom. Only custom exercises sync.
- **Refresh token rotation**: Each refresh issues a new token and revokes the old one. Tokens are bcrypt-hashed in DB.

## Prisma Schema

14 models, 5 enums mirrored from iOS `SharedEnums.swift`:
- **Enums**: ExerciseType (8), MuscleGroup (21), Equipment (10), SetType (4), MeasurementType (15)
- **Auth**: User, RefreshToken
- **Workouts**: Workout → WorkoutExercise → ExerciseSet, WorkoutSuperset
- **Templates**: WorkoutTemplate → TemplateItem → TemplateExercise → TemplateSet, TemplateSuperset
- **Other**: Exercise, BodyMeasurement

All IDs are client-generated UUIDs. All syncable entities have `updatedAt` + `deletedAt`.

## Related Repo

iOS app: `../wolog/` (SwiftUI + SwiftData)
- Exercises JSON seed data: `../wolog/wolog/Resources/exercises.json`
- Enum definitions: `../wolog/wolog/Shared/SharedEnums.swift`

## Environment Variables

See `.env.example`. Key vars: `DATABASE_URL`, `JWT_SECRET`, `APPLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`.
