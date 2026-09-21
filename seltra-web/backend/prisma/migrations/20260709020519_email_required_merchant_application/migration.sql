/*
  Warnings:

  - Made the column `email` on table `MerchantApplication` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MerchantApplication" ALTER COLUMN "email" SET NOT NULL;
