CREATE TABLE "owner_email_deliveries" (
 "id" TEXT PRIMARY KEY, "organization_id" TEXT NOT NULL, "station_id" TEXT, "owner_id" TEXT NOT NULL,
 "type" "OwnerNotificationType" NOT NULL, "event_key" TEXT NOT NULL, "dedupe_key" TEXT NOT NULL UNIQUE,
 "destination" TEXT NOT NULL, "record_type" TEXT NOT NULL, "message" TEXT NOT NULL, "guard" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "suppression_reason" TEXT, "error_message" TEXT,
 "provider_message_id" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lease_until" TIMESTAMP(3), "claim_token" TEXT, "accepted_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "owner_email_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "owner_email_deliveries_status_next_attempt_at_idx" ON "owner_email_deliveries"("status", "next_attempt_at");
CREATE INDEX "owner_email_deliveries_organization_id_created_at_idx" ON "owner_email_deliveries"("organization_id", "created_at");

CREATE TABLE "owner_email_preferences" (
 "owner_id" TEXT PRIMARY KEY, "organization_id" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
 "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "owner_email_preferences_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "owner_email_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "owner_email_preferences_organization_id_enabled_idx" ON "owner_email_preferences"("organization_id", "enabled");
