-- notionPageId was already removed in an earlier migration/environment.

-- AlterTable
ALTER TABLE "Tenant"
ADD COLUMN "aiCreditsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aiCreditsWindowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';