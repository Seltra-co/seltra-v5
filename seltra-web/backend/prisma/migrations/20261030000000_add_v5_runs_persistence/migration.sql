CREATE TABLE IF NOT EXISTS "runs" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "userId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'queued',
  "phase" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "lastEventSeq" INTEGER NOT NULL DEFAULT 0,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "checkpoint" JSONB,
  "error" JSONB,
  "idempotencyKey" TEXT,
  "resumesRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "runs_idempotencyKey_key" ON "runs"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "runs_projectId_state_idx" ON "runs"("projectId", "state");
CREATE INDEX IF NOT EXISTS "runs_workspaceId_state_idx" ON "runs"("workspaceId", "state");
CREATE INDEX IF NOT EXISTS "runs_lastHeartbeatAt_idx" ON "runs"("lastHeartbeatAt");
CREATE UNIQUE INDEX IF NOT EXISTS "runs_one_active_per_project" ON "runs"("projectId")
  WHERE "state" IN ('queued', 'running', 'waiting_for_user', 'stopping', 'paused_no_credits');

CREATE TABLE IF NOT EXISTS "run_events" (
  "id" TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "seq" INTEGER NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type" TEXT NOT NULL,
  "phase" TEXT,
  "agent" TEXT,
  "payload" JSONB NOT NULL
);
ALTER TABLE "run_events" DROP CONSTRAINT IF EXISTS "run_events_invalid_sequence";
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_invalid_sequence"
  CHECK ("seq" >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS "run_events_runId_seq_key" ON "run_events"("runId", "seq");
CREATE INDEX IF NOT EXISTS "run_events_runId_seq_idx" ON "run_events"("runId", "seq");

CREATE TABLE IF NOT EXISTS "project_files" (
  "projectId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "mime" TEXT,
  "storageRef" TEXT,
  "inlineContent" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastRunId" TEXT REFERENCES "runs"("id") ON DELETE SET NULL,
  PRIMARY KEY ("projectId", "path")
);
CREATE INDEX IF NOT EXISTS "project_files_projectId_updatedAt_idx" ON "project_files"("projectId", "updatedAt");

CREATE TABLE IF NOT EXISTS "project_snapshots" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "runId" TEXT NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "label" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'auto',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "project_snapshots_projectId_createdAt_idx" ON "project_snapshots"("projectId", "createdAt");

CREATE TABLE IF NOT EXISTS "workspace_credits" (
  "workspaceId" TEXT PRIMARY KEY,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "lifetimeGranted" INTEGER NOT NULL DEFAULT 0,
  "lifetimeUsed" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "workspace_credits"("workspaceId") ON DELETE CASCADE,
  "runId" TEXT,
  "projectId" TEXT,
  "kind" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "modelRole" TEXT,
  "tokensIn" INTEGER NOT NULL DEFAULT 0,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "credit_ledger_workspaceId_createdAt_idx" ON "credit_ledger"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "credit_ledger_runId_idx" ON "credit_ledger"("runId");

CREATE TABLE IF NOT EXISTS "file_blobs" (
  "hash" TEXT PRIMARY KEY,
  "content" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_assets" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "prompt" TEXT,
  "license" TEXT,
  "attribution" TEXT,
  "storageRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "project_assets_projectId_createdAt_idx" ON "project_assets"("projectId", "createdAt");
