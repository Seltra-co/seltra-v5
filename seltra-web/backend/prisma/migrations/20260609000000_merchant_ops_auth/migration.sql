CREATE TYPE "MerchantStatus" AS ENUM ('pending', 'approved', 'rejected', 'suspended');

ALTER TABLE "MerchantApplication"
  ADD COLUMN "createdBy" TEXT;

ALTER TABLE "MerchantApplication"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "MerchantApplication"
  ALTER COLUMN "status" TYPE "MerchantStatus"
  USING (
    CASE
      WHEN "status" = 'approved' THEN 'approved'::"MerchantStatus"
      WHEN "status" = 'rejected' THEN 'rejected'::"MerchantStatus"
      WHEN "status" = 'suspended' THEN 'suspended'::"MerchantStatus"
      ELSE 'pending'::"MerchantStatus"
    END
  );

ALTER TABLE "MerchantApplication"
  ALTER COLUMN "status" SET DEFAULT 'pending';

CREATE UNIQUE INDEX "MerchantApplication_email_key" ON "MerchantApplication"("email");

CREATE TABLE "OtpCode" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "hashedCode" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OtpCode_merchantId_idx" ON "OtpCode"("merchantId");
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");
