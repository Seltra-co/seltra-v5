ALTER TABLE "Deployment"
  ADD COLUMN "queueLeaseOwner" TEXT,
  ADD COLUMN "queueLeaseToken" TEXT,
  ADD COLUMN "queueLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "vercelRequestedAt" TIMESTAMP(3);

CREATE INDEX "Deployment_status_queueLeaseExpiresAt_createdAt_idx"
  ON "Deployment"("status", "queueLeaseExpiresAt", "createdAt");
CREATE INDEX "Deployment_vercelRequestedAt_idx" ON "Deployment"("vercelRequestedAt");

CREATE TABLE "PublishProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "reconciliationStatus" TEXT NOT NULL DEFAULT 'DETECTED',
  "readyState" TEXT,
  "url" TEXT,
  "sourceSha" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublishProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublishProviderEvent_provider_deploymentId_key"
  ON "PublishProviderEvent"("provider", "deploymentId");
CREATE INDEX "PublishProviderEvent_projectId_firstSeenAt_idx"
  ON "PublishProviderEvent"("projectId", "firstSeenAt");
