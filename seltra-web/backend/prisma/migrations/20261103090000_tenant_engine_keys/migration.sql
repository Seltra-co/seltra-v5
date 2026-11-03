ALTER TABLE "seltra_engine_api_keys"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "encryptedKey" TEXT;

CREATE INDEX "seltra_engine_api_keys_tenantId_revokedAt_idx"
  ON "seltra_engine_api_keys"("tenantId", "revokedAt");

CREATE UNIQUE INDEX "seltra_engine_api_keys_active_tenant_key"
  ON "seltra_engine_api_keys"("tenantId")
  WHERE "tenantId" IS NOT NULL AND "revokedAt" IS NULL;

ALTER TABLE "seltra_engine_api_keys"
  ADD CONSTRAINT "seltra_engine_api_keys_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
