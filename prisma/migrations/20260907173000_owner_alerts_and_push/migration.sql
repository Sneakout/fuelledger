CREATE TYPE "OwnerAlertSeverity" AS ENUM ('INFORMATION', 'ATTENTION', 'URGENT');

CREATE TABLE "owner_alerts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "station_id" TEXT,
  "type" "OwnerNotificationType" NOT NULL,
  "severity" "OwnerAlertSeverity" NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "evidence_label" TEXT NOT NULL,
  "evidence_path" TEXT NOT NULL,
  "evidence_source_type" TEXT,
  "evidence_source_id" TEXT,
  "read_at" TIMESTAMP(3),
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "owner_alerts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "owner_push_devices" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'IOS',
  "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "owner_push_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "owner_push_deliveries" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "alert_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "provider_message_id" TEXT,
  "error_message" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_push_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_alerts_dedupe_key_key" ON "owner_alerts"("dedupe_key");
CREATE INDEX "owner_alerts_organization_id_created_at_idx" ON "owner_alerts"("organization_id", "created_at");
CREATE INDEX "owner_alerts_station_id_created_at_idx" ON "owner_alerts"("station_id", "created_at");
CREATE INDEX "owner_alerts_organization_id_acknowledged_at_created_at_idx" ON "owner_alerts"("organization_id", "acknowledged_at", "created_at");
CREATE UNIQUE INDEX "owner_push_devices_token_key" ON "owner_push_devices"("token");
CREATE INDEX "owner_push_devices_organization_id_active_idx" ON "owner_push_devices"("organization_id", "active");
CREATE INDEX "owner_push_devices_user_id_active_idx" ON "owner_push_devices"("user_id", "active");
CREATE UNIQUE INDEX "owner_push_deliveries_alert_id_device_id_key" ON "owner_push_deliveries"("alert_id", "device_id");
CREATE INDEX "owner_push_deliveries_organization_id_created_at_idx" ON "owner_push_deliveries"("organization_id", "created_at");

ALTER TABLE "owner_alerts" ADD CONSTRAINT "owner_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_alerts" ADD CONSTRAINT "owner_alerts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_alerts" ADD CONSTRAINT "owner_alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_push_devices" ADD CONSTRAINT "owner_push_devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_push_devices" ADD CONSTRAINT "owner_push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_push_deliveries" ADD CONSTRAINT "owner_push_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_push_deliveries" ADD CONSTRAINT "owner_push_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "owner_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_push_deliveries" ADD CONSTRAINT "owner_push_deliveries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "owner_push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
