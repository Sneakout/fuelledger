ALTER TABLE "organizations" ADD COLUMN "intelligence_enabled_at" TIMESTAMP(3), ADD COLUMN "intelligence_expires_at" TIMESTAMP(3);

CREATE TABLE "daily_owner_briefings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "station_scope" TEXT NOT NULL,
  "briefing_date" DATE NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "facts" JSONB NOT NULL,
  "narrative" JSONB NOT NULL,
  "narrative_mode" TEXT NOT NULL,
  "model" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_owner_briefings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_owner_briefings_organization_id_station_scope_briefing_date_key" ON "daily_owner_briefings"("organization_id", "station_scope", "briefing_date");
CREATE INDEX "daily_owner_briefings_organization_id_briefing_date_idx" ON "daily_owner_briefings"("organization_id", "briefing_date");
ALTER TABLE "daily_owner_briefings" ADD CONSTRAINT "daily_owner_briefings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
