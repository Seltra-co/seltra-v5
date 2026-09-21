/*
  Warnings:

  - You are about to drop the column `notionPageId` on the `MerchantApplication` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MerchantApplication" DROP COLUMN "notionPageId";

-- CreateTable
CREATE TABLE "ManifestPatchLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'chat',
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManifestPatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManifestPatchLog_tenantId_createdAt_idx" ON "ManifestPatchLog"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ManifestPatchLog" ADD CONSTRAINT "ManifestPatchLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
