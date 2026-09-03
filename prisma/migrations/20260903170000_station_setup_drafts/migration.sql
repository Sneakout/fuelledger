CREATE TABLE "station_setup_drafts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "setup" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_setup_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "station_setup_drafts_station_id_key" ON "station_setup_drafts"("station_id");
CREATE INDEX "station_setup_drafts_organization_id_updated_at_idx" ON "station_setup_drafts"("organization_id", "updated_at");

ALTER TABLE "station_setup_drafts"
  ADD CONSTRAINT "station_setup_drafts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "station_setup_drafts"
  ADD CONSTRAINT "station_setup_drafts_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
