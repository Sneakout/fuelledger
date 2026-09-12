ALTER TABLE "customer_ledger"
ADD COLUMN "disputed_at" TIMESTAMP(3),
ADD COLUMN "dispute_reason" TEXT;
