ALTER TABLE "owner_notification_settings"
ADD COLUMN "stock_variance_tolerance" DECIMAL(12,3) NOT NULL DEFAULT 50;
