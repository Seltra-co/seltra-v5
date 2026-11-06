CREATE TYPE "WorkspacePersistenceOperationStatus" AS ENUM (
  'PERSISTING',
  'SOURCE_VERIFIED',
  'SNAPSHOT_VERIFIED',
  'SAFE_TO_DESTROY',
  'DEGRADED'
);

ALTER TYPE "PublishWorkspaceStatus" ADD VALUE 'SAFE_TO_DESTROY';

CREATE TABLE "WorkspacePersistenceOperation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workspaceKey" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "WorkspacePersistenceOperationStatus" NOT NULL DEFAULT 'PERSISTING',
  "githubRevisions" JSONB,
  "snapshotVersion" TEXT,
  "manifestKey" TEXT,
  "bundleKey" TEXT,
  "bundleSha256" TEXT,
  "errorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspacePersistenceOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspacePersistenceOperation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkspacePersistenceOperation_tenantId_operationId_key"
  ON "WorkspacePersistenceOperation"("tenantId", "operationId");
CREATE INDEX "WorkspacePersistenceOperation_workspaceKey_status_updatedAt_idx"
  ON "WorkspacePersistenceOperation"("workspaceKey", "status", "updatedAt");
CREATE INDEX "WorkspacePersistenceOperation_tenantId_createdAt_idx"
  ON "WorkspacePersistenceOperation"("tenantId", "createdAt");
