-- CreateTable
CREATE TABLE "WorkoutPhoto" (
    "id" UUID NOT NULL,
    "workoutId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "byteSize" INTEGER,

    CONSTRAINT "WorkoutPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutPhoto_workoutId_idx" ON "WorkoutPhoto"("workoutId");

-- AddForeignKey
ALTER TABLE "WorkoutPhoto" ADD CONSTRAINT "WorkoutPhoto_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

