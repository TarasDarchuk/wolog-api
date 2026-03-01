-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('weightReps', 'repsOnly', 'weightedBodyweight', 'assistedBodyweight', 'duration', 'weightDuration', 'distanceDuration', 'weightDistance');

-- CreateEnum
CREATE TYPE "MuscleGroup" AS ENUM ('chest', 'lats', 'lowerBack', 'traps', 'upperBack', 'abductors', 'adductors', 'calves', 'tibialis', 'glutes', 'hamstrings', 'quadriceps', 'shoulders', 'neck', 'biceps', 'triceps', 'forearms', 'abdominals', 'cardio', 'fullBody', 'other');

-- CreateEnum
CREATE TYPE "Equipment" AS ENUM ('barbell', 'dumbbell', 'bodyweight', 'cable', 'machine', 'kettlebell', 'plate', 'resistanceBand', 'suspension', 'other');

-- CreateEnum
CREATE TYPE "SetType" AS ENUM ('normal', 'warmup', 'dropset', 'failure');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('weight', 'bodyFat', 'chest', 'waist', 'hips', 'neck', 'shoulders', 'leftBicep', 'rightBicep', 'leftForearm', 'rightForearm', 'leftThigh', 'rightThigh', 'leftCalf', 'rightCalf');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "appleUserId" TEXT,
    "googleUserId" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "activeCalories" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" UUID NOT NULL,
    "workoutId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseSet" (
    "id" UUID NOT NULL,
    "workoutExerciseId" UUID NOT NULL,
    "setNumber" INTEGER NOT NULL DEFAULT 1,
    "weight" DOUBLE PRECISION,
    "reps" INTEGER,
    "duration" DOUBLE PRECISION,
    "distance" DOUBLE PRECISION,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "type" "SetType" NOT NULL DEFAULT 'normal',
    "prRecords" JSONB,

    CONSTRAINT "ExerciseSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSuperset" (
    "id" UUID NOT NULL,
    "workoutId" UUID NOT NULL,
    "supersetColorIndex" INTEGER NOT NULL DEFAULT 0,
    "exerciseIds" UUID[],

    CONSTRAINT "WorkoutSuperset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL DEFAULT '',
    "muscleGroup" "MuscleGroup" NOT NULL DEFAULT 'chest',
    "equipment" "Equipment" NOT NULL DEFAULT 'barbell',
    "exerciseType" "ExerciseType" NOT NULL DEFAULT 'weightReps',
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "restDuration" DOUBLE PRECISION,
    "thumbnailUrl" TEXT,
    "videoUrl" TEXT,
    "primaryMuscles" TEXT[],
    "secondaryMuscles" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateItem" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "supersetId" UUID,

    CONSTRAINT "TemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateExercise" (
    "id" UUID NOT NULL,
    "templateItemId" UUID NOT NULL,
    "supersetId" UUID,
    "exerciseId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "targetSets" INTEGER NOT NULL DEFAULT 3,
    "targetReps" INTEGER NOT NULL DEFAULT 10,
    "notes" TEXT,
    "restTimerSeconds" INTEGER,

    CONSTRAINT "TemplateExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSet" (
    "id" UUID NOT NULL,
    "templateExerciseId" UUID NOT NULL,
    "setNumber" INTEGER NOT NULL DEFAULT 1,
    "targetWeight" DOUBLE PRECISION,
    "targetReps" INTEGER,
    "targetDuration" DOUBLE PRECISION,
    "targetDistance" DOUBLE PRECISION,

    CONSTRAINT "TemplateSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSuperset" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "supersetColorIndex" INTEGER NOT NULL DEFAULT 0,
    "exerciseIds" UUID[],

    CONSTRAINT "TemplateSuperset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMeasurement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "MeasurementType" NOT NULL DEFAULT 'weight',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "photoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_appleUserId_key" ON "User"("appleUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleUserId_key" ON "User"("googleUserId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "Workout_userId_updatedAt_idx" ON "Workout"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Workout_userId_deletedAt_idx" ON "Workout"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "WorkoutExercise_workoutId_idx" ON "WorkoutExercise"("workoutId");

-- CreateIndex
CREATE INDEX "ExerciseSet_workoutExerciseId_idx" ON "ExerciseSet"("workoutExerciseId");

-- CreateIndex
CREATE INDEX "WorkoutSuperset_workoutId_idx" ON "WorkoutSuperset"("workoutId");

-- CreateIndex
CREATE INDEX "Exercise_userId_idx" ON "Exercise"("userId");

-- CreateIndex
CREATE INDEX "Exercise_isCustom_idx" ON "Exercise"("isCustom");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_userId_updatedAt_idx" ON "WorkoutTemplate"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_userId_deletedAt_idx" ON "WorkoutTemplate"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "TemplateItem_templateId_idx" ON "TemplateItem"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateExercise_templateItemId_key" ON "TemplateExercise"("templateItemId");

-- CreateIndex
CREATE INDEX "TemplateExercise_templateItemId_idx" ON "TemplateExercise"("templateItemId");

-- CreateIndex
CREATE INDEX "TemplateSet_templateExerciseId_idx" ON "TemplateSet"("templateExerciseId");

-- CreateIndex
CREATE INDEX "TemplateSuperset_templateId_idx" ON "TemplateSuperset"("templateId");

-- CreateIndex
CREATE INDEX "BodyMeasurement_userId_updatedAt_idx" ON "BodyMeasurement"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "BodyMeasurement_userId_deletedAt_idx" ON "BodyMeasurement"("userId", "deletedAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSet" ADD CONSTRAINT "ExerciseSet_workoutExerciseId_fkey" FOREIGN KEY ("workoutExerciseId") REFERENCES "WorkoutExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSuperset" ADD CONSTRAINT "WorkoutSuperset_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutTemplate" ADD CONSTRAINT "WorkoutTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateItem" ADD CONSTRAINT "TemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateItem" ADD CONSTRAINT "TemplateItem_supersetId_fkey" FOREIGN KEY ("supersetId") REFERENCES "TemplateSuperset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateExercise" ADD CONSTRAINT "TemplateExercise_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "TemplateItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateExercise" ADD CONSTRAINT "TemplateExercise_supersetId_fkey" FOREIGN KEY ("supersetId") REFERENCES "TemplateSuperset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateExercise" ADD CONSTRAINT "TemplateExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSet" ADD CONSTRAINT "TemplateSet_templateExerciseId_fkey" FOREIGN KEY ("templateExerciseId") REFERENCES "TemplateExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
┌─────────────────────────────────────────────────────────┐
│  Update available 6.19.2 -> 7.4.2                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
