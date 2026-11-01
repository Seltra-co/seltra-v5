ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "creditWorkspaceId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Tenant_creditWorkspaceId_fkey'
  ) THEN
    ALTER TABLE "Tenant"
      ADD CONSTRAINT "Tenant_creditWorkspaceId_fkey"
      FOREIGN KEY ("creditWorkspaceId")
      REFERENCES "workspace_credits"("workspaceId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Tenant_creditWorkspaceId_idx" ON "Tenant"("creditWorkspaceId");

-- Link the workspace explicitly provided for the current local acceptance run.
-- Other deployments with different IDs are unchanged by this conditional update.
UPDATE "Tenant"
SET "creditWorkspaceId" = 'f5e0abf3-6bc9-4849-bd9a-d0db30f3568a'
WHERE "id" = '990a2e3b-bdb1-4a32-9c57-c50c1aa2dd96'
  AND "creditWorkspaceId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "workspace_credits"
    WHERE "workspaceId" = 'f5e0abf3-6bc9-4849-bd9a-d0db30f3568a'
  );
