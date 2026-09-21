ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "merchantMemory" JSONB;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "brandVoice" JSONB;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "preferences" JSONB;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "agentSettings" JSONB;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "lastReminderAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fulfilledBy" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "timeline" JSONB;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "lifetimeValue" DECIMAL(12,2);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "preferredChannel" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TYPE "TenantEventType" ADD VALUE IF NOT EXISTS 'invoice_created';
ALTER TYPE "TenantEventType" ADD VALUE IF NOT EXISTS 'invoice_paid';
ALTER TYPE "TenantEventType" ADD VALUE IF NOT EXISTS 'invoice_sent';
ALTER TYPE "TenantEventType" ADD VALUE IF NOT EXISTS 'order_reminder';
ALTER TYPE "TenantEventType" ADD VALUE IF NOT EXISTS 'sales_summary';

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "dueDate" TIMESTAMP(3),
  "pdfUrl" TEXT,
  "sentAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "agent" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "action" TEXT,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");
CREATE INDEX IF NOT EXISTS "Invoice_tenantId_createdAt_idx" ON "Invoice"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");
CREATE INDEX IF NOT EXISTS "AgentEvent_tenantId_createdAt_idx" ON "AgentEvent"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentEvent_agent_createdAt_idx" ON "AgentEvent"("agent", "createdAt");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
