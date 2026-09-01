CREATE TABLE "user_station_access" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_station_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_station_access_user_id_station_id_key" ON "user_station_access"("user_id", "station_id");
CREATE INDEX "user_station_access_station_id_idx" ON "user_station_access"("station_id");
ALTER TABLE "user_station_access" ADD CONSTRAINT "user_station_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_station_access" ADD CONSTRAINT "user_station_access_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "user_station_access" ("id", "user_id", "station_id")
SELECT 'backfill-' || md5(u."id" || ':' || s."id"), u."id", s."id"
FROM "users" u
JOIN "stations" s ON s."organization_id" = u."organization_id"
WHERE u."role" IN ('MANAGER', 'STAFF');
