ALTER TYPE "NotificationDeliveryStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE IF NOT EXISTS 'READ';

ALTER TABLE "owner_notification_deliveries"
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "read_at" TIMESTAMP(3),
  ADD COLUMN "failed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "owner_notification_deliveries_provider_message_id_key"
  ON "owner_notification_deliveries"("provider_message_id");
