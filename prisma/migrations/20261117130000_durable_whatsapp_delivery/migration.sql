ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'SUPPRESSED';

ALTER TABLE "owner_notification_deliveries"
  ADD COLUMN "event_key" TEXT,
  ADD COLUMN "record_type" TEXT,
  ADD COLUMN "guard" JSONB,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lease_until" TIMESTAMP(3),
  ADD COLUMN "callback_key" TEXT,
  ADD COLUMN "dispatch_started_at" TIMESTAMP(3),
  ADD COLUMN "failure_kind" TEXT,
  ADD COLUMN "suppression_reason" TEXT,
  ADD COLUMN "retried_by_id" TEXT,
  ADD COLUMN "retried_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "owner_notification_deliveries_callback_key_key" ON "owner_notification_deliveries" ("callback_key");
CREATE INDEX "owner_whatsapp_queue_idx" ON "owner_notification_deliveries" ("status", "available_at");

-- Legacy pending rows could already have reached Meta before their process stopped.
UPDATE "owner_notification_deliveries"
SET "status" = 'FAILED', "failure_kind" = 'UNCERTAIN', "failed_at" = CURRENT_TIMESTAMP,
    "error_message" = 'Delivery outcome was not recorded by the previous sender.'
WHERE "status" = 'PENDING';
