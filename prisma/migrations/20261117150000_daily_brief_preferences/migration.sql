CREATE TABLE "daily_brief_finding_preferences" (
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "station_id" TEXT NOT NULL REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "finding_key" TEXT NOT NULL,
  "acknowledged_at" TIMESTAMP(3),
  "remind_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_brief_finding_preferences_pkey" PRIMARY KEY ("organization_id", "station_id", "user_id", "finding_key")
);
