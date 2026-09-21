-- Add merchant payout details and disbursement audit trail.
ALTER TABLE "Tenant"
  ADD COLUMN "payoutMethod" TEXT,
  ADD COLUMN "payoutProvider" TEXT,
  ADD COLUMN "payoutProviderCode" TEXT,
  ADD COLUMN "payoutAccount" TEXT,
  ADD COLUMN "payoutAccountName" TEXT,
  ADD COLUMN "payoutValidatedAt" TIMESTAMP(3);

CREATE TABLE "Disbursement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "status" TEXT NOT NULL DEFAULT 'pending_otp',
  "provider" TEXT,
  "providerCode" TEXT,
  "account" TEXT NOT NULL,
  "accountName" TEXT,
  "externalRef" TEXT NOT NULL,
  "transactionId" TEXT,
  "rawResponse" JSONB,
  "otpHash" TEXT,
  "otpExpiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Disbursement_externalRef_key" ON "Disbursement"("externalRef");
CREATE INDEX "Disbursement_tenantId_createdAt_idx" ON "Disbursement"("tenantId", "createdAt");
CREATE INDEX "Disbursement_status_idx" ON "Disbursement"("status");

ALTER TABLE "Disbursement"
  ADD CONSTRAINT "Disbursement_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Disbursement"
  ADD CONSTRAINT "Disbursement_ledgerId_fkey"
  FOREIGN KEY ("ledgerId") REFERENCES "MerchantLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "TenantEventType" ADD VALUE IF NOT EXISTS 'disbursement_requested';
ALTER TYPE "TenantEventType" ADD VALUE IF NOT EXISTS 'disbursement_paid';
