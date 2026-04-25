-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Share_ownerUserId_createdAt_idx" ON "Share"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Share_expiresAt_idx" ON "Share"("expiresAt");

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
