ALTER TABLE "User"
  ADD COLUMN "marketingEmailUnsubscribedAt" TIMESTAMP(3);

CREATE TABLE "ScheduledEmail" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "campaign" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledEmail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScheduledEmail_userId_campaign_key" ON "ScheduledEmail"("userId", "campaign");
CREATE INDEX "ScheduledEmail_status_scheduledAt_idx" ON "ScheduledEmail"("status", "scheduledAt");
CREATE INDEX "ScheduledEmail_status_claimedAt_idx" ON "ScheduledEmail"("status", "claimedAt");
