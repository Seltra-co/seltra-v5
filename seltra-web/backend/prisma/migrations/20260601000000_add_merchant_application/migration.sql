CREATE TABLE "MerchantApplication" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "businessName" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "whatYouSell" TEXT NOT NULL,
    "basedIn" TEXT NOT NULL,
    "monthlyRevenue" TEXT NOT NULL,
    "existingLinks" TEXT,
    "aiFamiliarity" TEXT,
    "aiUsedBefore" BOOLEAN,
    "aiToolsUsed" TEXT,
    "aiFeelings" TEXT,
    "allowAiHelp" TEXT,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "merchantId" TEXT,
    "notionPageId" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantApplication_merchantId_key" ON "MerchantApplication"("merchantId");
CREATE INDEX "MerchantApplication_status_idx" ON "MerchantApplication"("status");
CREATE INDEX "MerchantApplication_email_idx" ON "MerchantApplication"("email");
CREATE INDEX "MerchantApplication_merchantId_idx" ON "MerchantApplication"("merchantId");
