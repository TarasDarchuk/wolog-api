-- CreateTable
CREATE TABLE "TrainingProfile" (
    "userId" UUID NOT NULL,
    "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "level" TEXT,
    "equipment" TEXT,
    "daysPerWeek" INTEGER,
    "useMetric" BOOLEAN,
    "starterProgramId" TEXT,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProfile_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "TrainingProfile" ADD CONSTRAINT "TrainingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
