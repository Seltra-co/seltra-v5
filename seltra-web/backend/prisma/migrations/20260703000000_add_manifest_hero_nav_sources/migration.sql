ALTER TABLE "Tenant" ADD COLUMN "manifest" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "heroSource" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "heroGeneratedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "navSource" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "navGeneratedAt" TIMESTAMP(3);
