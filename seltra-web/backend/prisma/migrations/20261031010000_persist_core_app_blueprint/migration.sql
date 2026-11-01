ALTER TABLE "TenantApp"
  ADD COLUMN "corePath" TEXT,
  ADD COLUMN "blueprint" JSONB,
  ADD COLUMN "appManifest" JSONB,
  ADD COLUMN "blueprintApprovedAt" TIMESTAMP(3);
