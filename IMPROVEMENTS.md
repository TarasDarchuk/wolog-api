## Analysis: Improvements Based on NestJS Best Practices & Prisma Expert Skills

### CRITICAL Priority

**1. ~~Refresh token lookup scans ALL tokens (N+1 / table scan)~~** ✅ FIXED
`src/auth/auth.service.ts`

Added `tokenFamily` field (first 8 chars of raw UUID) to `RefreshToken` model. Lookup now filters by `tokenFamily` first, then bcrypt-compares only the small set of matches. Migration: `0002_improvements`.

---

**2. ~~No global exception filter~~** ✅ FIXED
`src/common/filters/prisma-exception.filter.ts`

Added `PrismaExceptionFilter` that catches `PrismaClientKnownRequestError` and maps: P2002→409, P2025→404, P2003→400, default→500. Registered globally in `main.ts`.

---

**3. `SyncService` is a god service** (`arch-single-responsibility`) — DEFERRED
`src/sync/sync.service.ts` — 676 lines

This single service handles push/pull for 4 entity types. Splitting into per-entity services is a large refactor best done as a separate effort.

---

### HIGH Priority

**4. ~~No graceful shutdown~~** ✅ FIXED
`src/main.ts`

Added `app.enableShutdownHooks()` in `bootstrap()`.

---

**5. CORS is wide open** (`security-sanitize-output`) — INTENTIONAL
`src/main.ts` — `app.enableCors()` with no options

This is intentional for a mobile API — the iOS app doesn't use browser-based requests. No fix needed.

---

**6. ~~Health endpoint returns 200 on failure~~** ✅ FIXED
`src/health/health.controller.ts`

Now throws `ServiceUnavailableException` (503) when DB is disconnected.

---

**7. ~~Enum values not validated at DTO level~~** ✅ FIXED
`src/sync/dto/sync-push.dto.ts`

Replaced `@IsString()` with `@IsIn(Object.values(EnumType))` for: `SetType`, `ExerciseType`, `MuscleGroup`, `Equipment`, `MeasurementType`. Invalid enum values now rejected at validation layer.

---

**8. No structured logging** (`devops-use-logging`) — DEFERRED

`main.ts` now uses NestJS `Logger` instead of `console.log`. Full structured logging (JSON format, request correlation IDs) is a separate effort.

---

### MEDIUM-HIGH Priority (Prisma)

**9. Missing `@@map` on all models** — DEFERRED

Cosmetic. Would require a migration renaming all tables. Not worth the risk for an existing deployed schema.

---

**10. ~~`TemplateSuperset` missing FK relation to `WorkoutTemplate`~~** ✅ FIXED
`prisma/schema.prisma`

Added `@relation` from `TemplateSuperset.templateId` to `WorkoutTemplate` with `onDelete: Cascade`. Also added `supersets` relation field on `WorkoutTemplate`. Migration: `0002_improvements`.

---

**11. Over-fetching in pull queries** — DEFERRED

Premature optimization. The sync API returns full entities that the client needs. Adding `select` would add maintenance burden and risk missing fields the client expects.

---

**12. ~~Sequential creates inside transactions~~** ✅ FIXED
`src/sync/sync.service.ts`

Workout exercises now use `createMany` instead of sequential `create` calls. Sets across all exercises are also batched into a single `createMany`.

---

### MEDIUM Priority

**13. ~~`ExercisesController` has DB logic directly~~** ✅ FIXED
`src/exercises/`

Extracted `ExercisesService` with query logic. Controller now delegates to service. Module updated to provide the service.

---

**14. ~~No `@Public()` on health endpoint~~** ✅ FIXED
`src/health/health.controller.ts`

Added `@Public()` decorator.

---

**15. No tests at all** (`test-use-testing-module`) — DEFERRED

Zero test coverage. This is a separate effort tracked in the plan as Phase 7.

---

**16. ~~`exercises.controller.ts` — Query params not validated with a DTO~~** ✅ FIXED
`src/exercises/dto/list-exercises.dto.ts`

Created `ListExercisesDto` with `@IsInt()`, `@Min()`, `@Max()`, `@Type(() => Number)` for proper validation via the global `ValidationPipe`.

---

### Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | Refresh token full-table scan | ✅ Fixed |
| 2 | No exception filter | ✅ Fixed |
| 3 | SyncService god service | Deferred |
| 4 | No graceful shutdown hooks | ✅ Fixed |
| 5 | CORS unrestricted | Intentional |
| 6 | Health returns 200 on failure | ✅ Fixed |
| 7 | Enum values not validated in DTOs | ✅ Fixed |
| 8 | No structured logging | Deferred |
| 9 | Missing @@map on models | Deferred |
| 10 | TemplateSuperset missing FK | ✅ Fixed |
| 11 | Over-fetching (no select in pulls) | Deferred |
| 12 | Sequential creates vs createMany | ✅ Fixed |
| 13 | Controllers with direct DB access | ✅ Fixed |
| 14 | Missing @Public on health | ✅ Fixed |
| 15 | Zero test coverage | Deferred |
| 16 | Query params not DTO-validated | ✅ Fixed |

**10 of 16 items fixed. 1 intentional. 5 deferred for future work.**
