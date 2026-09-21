ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "country" TEXT;

CREATE TABLE IF NOT EXISTS "TenantEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TenantEvent_tenantId_createdAt_idx" ON "TenantEvent"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "TenantEvent_type_createdAt_idx" ON "TenantEvent"("type", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TenantEvent_tenantId_fkey'
  ) THEN
    ALTER TABLE "TenantEvent"
      ADD CONSTRAINT "TenantEvent_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OpsAuditLog" (
  "id" TEXT NOT NULL,
  "actorLabel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpsAuditLog_targetType_targetId_idx" ON "OpsAuditLog"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "OpsAuditLog_actorLabel_createdAt_idx" ON "OpsAuditLog"("actorLabel", "createdAt");

ALTER TABLE "MerchantApplication" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "MerchantApplication" ADD COLUMN IF NOT EXISTS "credentialsGeneratedAt" TIMESTAMP(3);
ALTER TABLE "MerchantApplication" ADD COLUMN IF NOT EXISTS "welcomeEmailSentAt" TIMESTAMP(3);

UPDATE "Tenant" t
SET
  "city" = NULLIF(TRIM(SUBSTRING(ma."basedIn" FROM 1 FOR LENGTH(ma."basedIn") - POSITION(',' IN REVERSE(ma."basedIn")))), ''),
  "country" = NULLIF(TRIM(RIGHT(ma."basedIn", POSITION(',' IN REVERSE(ma."basedIn")) - 1)), '')
FROM "MerchantApplication" ma
WHERE ma."merchantId" = t."id"
  AND t."city" IS NULL
  AND t."country" IS NULL
  AND ma."basedIn" LIKE '%,%';
