CREATE TABLE "intelligence_investigations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "finding_ids" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "fact_snapshot" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "narrative_mode" TEXT NOT NULL,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_investigations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intelligence_investigations_organization_id_request_key_key"
ON "intelligence_investigations"("organization_id", "request_key");

CREATE INDEX "intelligence_investigations_organization_id_station_id_created_at_idx"
ON "intelligence_investigations"("organization_id", "station_id", "created_at");

CREATE INDEX "intelligence_investigations_user_id_created_at_idx"
ON "intelligence_investigations"("user_id", "created_at");

ALTER TABLE "intelligence_investigations"
ADD CONSTRAINT "intelligence_investigations_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intelligence_investigations"
ADD CONSTRAINT "intelligence_investigations_station_id_fkey"
FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intelligence_investigations"
ADD CONSTRAINT "intelligence_investigations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
