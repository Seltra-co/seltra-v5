ALTER TABLE "Tenant" ADD COLUMN "coreWorkspaceKey" TEXT;

UPDATE "Tenant"
SET "coreWorkspaceKey" = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

CREATE UNIQUE INDEX "Tenant_coreWorkspaceKey_key" ON "Tenant"("coreWorkspaceKey");

CREATE TABLE "TenantApp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "coreAppId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "previewUrl" TEXT,
    "publishedUrl" TEXT,
    "lastCommitSha" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantApp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantApp_tenantId_coreAppId_key" ON "TenantApp"("tenantId", "coreAppId");
CREATE INDEX "TenantApp_tenantId_idx" ON "TenantApp"("tenantId");
ALTER TABLE "TenantApp" ADD CONSTRAINT "TenantApp_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
