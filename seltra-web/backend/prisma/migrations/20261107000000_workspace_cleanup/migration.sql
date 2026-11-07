CREATE TABLE "WorkspaceCleanup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workspaceKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceCleanup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceCleanup_workspaceKey_key" ON "WorkspaceCleanup"("workspaceKey");
CREATE INDEX "WorkspaceCleanup_nextAttemptAt_idx" ON "WorkspaceCleanup"("nextAttemptAt");
