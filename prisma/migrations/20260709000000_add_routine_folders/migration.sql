-- CreateTable
CREATE TABLE "RoutineFolder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoutineFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutineFolder_userId_updatedAt_idx" ON "RoutineFolder"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "RoutineFolder_userId_deletedAt_idx" ON "RoutineFolder"("userId", "deletedAt");

-- AddForeignKey
ALTER TABLE "RoutineFolder" ADD CONSTRAINT "RoutineFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "WorkoutTemplate" ADD COLUMN "folderId" UUID;
