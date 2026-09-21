-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'TenantEventType'
  ) THEN
    CREATE TYPE "TenantEventType" AS ENUM (
      'product_added',
      'order_placed',
      'payment_received',
      'login',
      'settings_changed',
      'theme_updated',
      'ai_invocation',
      'merchant_onboarded'
    );
  END IF;
END $$;

-- MerchantApplication
ALTER TABLE "MerchantApplication"
ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

-- Tenant
ALTER TABLE "Tenant"
ADD COLUMN IF NOT EXISTS "merchantContext" JSONB;

-- TenantEvent
ALTER TABLE "TenantEvent"
DROP COLUMN "type",
ADD COLUMN "type" "TenantEventType" NOT NULL;

-- Indexes
CREATE UNIQUE INDEX "MerchantApplication_tenantId_key"
ON "MerchantApplication"("tenantId");

CREATE INDEX "TenantEvent_type_createdAt_idx"
ON "TenantEvent"("type","createdAt");

-- FK
ALTER TABLE "MerchantApplication"
ADD CONSTRAINT "MerchantApplication_tenantId_fkey"
FOREIGN KEY ("tenantId")
REFERENCES "Tenant"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;