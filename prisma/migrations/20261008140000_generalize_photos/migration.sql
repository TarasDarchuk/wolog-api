-- Generalize WorkoutPhoto into Photo (workout photos + measurement progress
-- photos). Renames in place so existing rows survive.

-- RenameTable
ALTER TABLE "WorkoutPhoto" RENAME TO "Photo";
ALTER TABLE "Photo" RENAME CONSTRAINT "WorkoutPhoto_pkey" TO "Photo_pkey";
ALTER TABLE "Photo" RENAME CONSTRAINT "WorkoutPhoto_workoutId_fkey" TO "Photo_workoutId_fkey";
ALTER INDEX "WorkoutPhoto_workoutId_idx" RENAME TO "Photo_workoutId_idx";

-- Owner column, backfilled from the workout
ALTER TABLE "Photo" ADD COLUMN "userId" UUID;
UPDATE "Photo" p SET "userId" = w."userId" FROM "Workout" w WHERE w."id" = p."workoutId";
ALTER TABLE "Photo" ALTER COLUMN "userId" SET NOT NULL;

-- Measurement photos have no workout
ALTER TABLE "Photo" ALTER COLUMN "workoutId" DROP NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "sortOrder" SET DEFAULT 0;
ALTER TABLE "Photo" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Photo_userId_idx" ON "Photo"("userId");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "BodyMeasurement" ADD COLUMN "photoId" UUID;

-- CreateIndex
CREATE INDEX "BodyMeasurement_photoId_idx" ON "BodyMeasurement"("photoId");
