-- CreateEnum
CREATE TYPE "PaywallCohort" AS ENUM ('LEGACY', 'NEW');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "paywallCohort" "PaywallCohort",
ADD COLUMN     "proExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" UUID NOT NULL,
    "profileEventId" TEXT,
    "userId" UUID,
    "adaptyProfileId" TEXT,
    "eventType" TEXT NOT NULL,
    "environment" TEXT,
    "productId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "abTestName" TEXT,
    "variationId" TEXT,
    "paywallName" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEvent_profileEventId_key" ON "SubscriptionEvent"("profileEventId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_userId_idx" ON "SubscriptionEvent"("userId");

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every account that exists before the hard paywall is legacy and
-- keeps today's free tier forever.
UPDATE "User" SET "paywallCohort" = 'LEGACY';
