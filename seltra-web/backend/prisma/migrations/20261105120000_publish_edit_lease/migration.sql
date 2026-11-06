-- Add Backend-owned edit lease state for each merchant app.
ALTER TABLE "TenantApp"
ADD COLUMN "editLeaseHolderSessionId" TEXT,
ADD COLUMN "editLeaseExpiresAt" TIMESTAMP(3);
