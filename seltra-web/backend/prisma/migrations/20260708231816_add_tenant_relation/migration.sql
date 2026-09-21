/*
  Warnings:

  - You are about to drop the column `tenantId` on the `MerchantApplication` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId]` on the table `MerchantApplication` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "MerchantApplication" DROP CONSTRAINT "MerchantApplication_tenantId_fkey";

-- DropIndex
DROP INDEX "MerchantApplication_tenantId_key";

-- AlterTable
ALTER TABLE "MerchantApplication" DROP COLUMN "tenantId",
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantApplication_userId_key" ON "MerchantApplication"("userId");

-- AddForeignKey
ALTER TABLE "MerchantApplication" ADD CONSTRAINT "MerchantApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
