-- Add tokenFamily column to RefreshToken for efficient lookup
ALTER TABLE "RefreshToken" ADD COLUMN "tokenFamily" TEXT;

-- Backfill tokenFamily from first 8 chars of tokenHash (existing tokens)
UPDATE "RefreshToken" SET "tokenFamily" = LEFT("tokenHash", 8) WHERE "tokenFamily" IS NULL;

-- Make tokenFamily required after backfill
ALTER TABLE "RefreshToken" ALTER COLUMN "tokenFamily" SET NOT NULL;

-- Drop old tokenHash index, add tokenFamily index
DROP INDEX IF EXISTS "RefreshToken_tokenHash_idx";
CREATE INDEX "RefreshToken_tokenFamily_idx" ON "RefreshToken"("tokenFamily");

-- Add FK from TemplateSuperset to WorkoutTemplate
ALTER TABLE "TemplateSuperset" ADD CONSTRAINT "TemplateSuperset_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
