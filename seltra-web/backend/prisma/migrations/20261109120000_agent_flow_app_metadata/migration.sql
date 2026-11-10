ALTER TABLE "TenantApp"
  ADD COLUMN "workspaceInstanceId" TEXT,
  ADD COLUMN "lastRunId" TEXT,
  ADD COLUMN "lastBuildAt" TIMESTAMP(3),
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "errorDetail" TEXT;

ALTER TABLE "project_assets"
  ADD COLUMN "slot" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "error" TEXT;
