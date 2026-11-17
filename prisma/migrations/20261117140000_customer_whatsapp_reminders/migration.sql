ALTER TYPE "OwnerNotificationType" ADD VALUE 'CUSTOMER_CREDIT_REMINDER';

ALTER TABLE "owner_notification_settings"
  ADD COLUMN "shift_summary_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "receipt_summary_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "credit_report_hour" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "customer_reminder_scheduled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customer_reminder_hour" INTEGER NOT NULL DEFAULT 10;

UPDATE "owner_notification_settings" SET "credit_report_hour" = "daily_summary_hour";

ALTER TABLE "customers"
  ADD COLUMN "reminder_whatsapp_number" TEXT,
  ADD COLUMN "reminder_consent_at" TIMESTAMP(3),
  ADD COLUMN "reminder_consent_by_id" TEXT,
  ADD COLUMN "reminder_consent_source" TEXT,
  ADD COLUMN "reminder_paused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "owner_notification_deliveries"
  ADD COLUMN "customer_id" TEXT,
  ADD CONSTRAINT "owner_notification_deliveries_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "whatsapp_customer_history_idx"
  ON "owner_notification_deliveries" ("organization_id", "customer_id", "created_at");
