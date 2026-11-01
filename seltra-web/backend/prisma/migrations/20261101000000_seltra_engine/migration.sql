CREATE TABLE "seltra_engine_api_keys" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seltra_engine_api_keys_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "seltra_engine_usage" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "modelRole" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "costUnits" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seltra_engine_usage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "seltra_engine_assets" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seltra_engine_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seltra_engine_api_keys_keyHash_key" ON "seltra_engine_api_keys"("keyHash");
CREATE INDEX "seltra_engine_api_keys_workspaceId_revokedAt_idx" ON "seltra_engine_api_keys"("workspaceId", "revokedAt");
CREATE INDEX "seltra_engine_usage_workspaceId_createdAt_idx" ON "seltra_engine_usage"("workspaceId", "createdAt");
CREATE INDEX "seltra_engine_usage_keyId_createdAt_idx" ON "seltra_engine_usage"("keyId", "createdAt");
CREATE INDEX "seltra_engine_usage_requestId_idx" ON "seltra_engine_usage"("requestId");
CREATE INDEX "seltra_engine_assets_workspaceId_createdAt_idx" ON "seltra_engine_assets"("workspaceId", "createdAt");
ALTER TABLE "seltra_engine_api_keys" ADD CONSTRAINT "seltra_engine_api_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace_credits"("workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seltra_engine_usage" ADD CONSTRAINT "seltra_engine_usage_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "seltra_engine_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seltra_engine_assets" ADD CONSTRAINT "seltra_engine_assets_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "seltra_engine_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seltra_engine_usage" ADD CONSTRAINT "seltra_engine_usage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace_credits"("workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seltra_engine_assets" ADD CONSTRAINT "seltra_engine_assets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace_credits"("workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
