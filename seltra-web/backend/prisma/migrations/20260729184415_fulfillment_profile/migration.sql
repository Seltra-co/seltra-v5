-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "deliveryDays" TEXT,
ADD COLUMN     "deliveryEstimate" TEXT,
ADD COLUMN     "deliveryFeeNote" TEXT,
ADD COLUMN     "fulfillmentMode" TEXT DEFAULT 'delivery',
ADD COLUMN     "pickupAddress" TEXT,
ADD COLUMN     "pickupInstructions" TEXT;
