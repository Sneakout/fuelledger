ALTER TABLE "purchase_receipts"
ADD COLUMN "received_at_reason" TEXT;

COMMENT ON COLUMN "purchase_receipts"."received_at" IS
'Physical stock arrival time. This is independent from the supplier invoice date.';

COMMENT ON COLUMN "purchase_receipts"."received_at_reason" IS
'Required explanation when a physical receipt is deliberately entered with an earlier effective time.';
