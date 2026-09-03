-- Owner-controlled WhatsApp notification settings and delivery audit trail.
CREATE TYPE "OwnerNotificationType" AS ENUM (
  'DENSITY_MISSING',
  'LOW_STOCK',
  'SHIFT_VARIANCE',
  'SHIFT_OPEN',
  'DAILY_SUMMARY',
  'OVERDUE_CUSTOMER',
  'SYSTEM_TEST'
);

CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "owner_notification_settings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "whatsapp_number" TEXT,
  "whatsapp_opted_in" BOOLEAN NOT NULL DEFAULT false,
  "density_missing_enabled" BOOLEAN NOT NULL DEFAULT true,
  "low_stock_enabled" BOOLEAN NOT NULL DEFAULT true,
  "shift_variance_enabled" BOOLEAN NOT NULL DEFAULT true,
  "unclosed_shift_enabled" BOOLEAN NOT NULL DEFAULT true,
  "daily_summary_enabled" BOOLEAN NOT NULL DEFAULT true,
  "overdue_customer_enabled" BOOLEAN NOT NULL DEFAULT true,
  "low_stock_percent" INTEGER NOT NULL DEFAULT 20,
  "variance_threshold" DECIMAL(12,2) NOT NULL DEFAULT 500,
  "daily_summary_hour" INTEGER NOT NULL DEFAULT 20,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "owner_notification_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "owner_notification_deliveries" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "station_id" TEXT,
  "type" "OwnerNotificationType" NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "provider_message_id" TEXT,
  "error_message" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_notification_settings_organization_id_key" ON "owner_notification_settings"("organization_id");
CREATE UNIQUE INDEX "owner_notification_deliveries_dedupe_key_key" ON "owner_notification_deliveries"("dedupe_key");
CREATE INDEX "owner_notification_deliveries_organization_id_created_at_idx" ON "owner_notification_deliveries"("organization_id", "created_at");
CREATE INDEX "owner_notification_deliveries_station_id_created_at_idx" ON "owner_notification_deliveries"("station_id", "created_at");

ALTER TABLE "owner_notification_settings" ADD CONSTRAINT "owner_notification_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_notification_deliveries" ADD CONSTRAINT "owner_notification_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_notification_deliveries" ADD CONSTRAINT "owner_notification_deliveries_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
