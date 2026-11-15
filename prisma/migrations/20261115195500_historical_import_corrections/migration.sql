ALTER TABLE "historical_sales_imports"
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "historical_sales_import_corrections" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "previous_rows" JSONB NOT NULL,
    "corrected_rows" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historical_sales_import_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "historical_sales_import_corrections_import_id_changed_at_idx" ON "historical_sales_import_corrections"("import_id", "changed_at");
CREATE INDEX "historical_sales_import_corrections_organization_id_changed_at_idx" ON "historical_sales_import_corrections"("organization_id", "changed_at");

ALTER TABLE "historical_sales_import_corrections" ADD CONSTRAINT "historical_sales_import_corrections_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "historical_sales_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historical_sales_import_corrections" ADD CONSTRAINT "historical_sales_import_corrections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historical_sales_import_corrections" ADD CONSTRAINT "historical_sales_import_corrections_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historical_sales_import_corrections" ADD CONSTRAINT "historical_sales_import_corrections_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
