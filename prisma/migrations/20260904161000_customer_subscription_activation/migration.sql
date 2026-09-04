ALTER TABLE "organizations"
ADD COLUMN "setup_fee_paid_at" TIMESTAMP(3),
ADD COLUMN "lifetime_access_paid_at" TIMESTAMP(3),
ADD COLUMN "subscription_updated_at" TIMESTAMP(3),
ADD COLUMN "subscription_updated_by" TEXT;
