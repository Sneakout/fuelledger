CREATE TABLE "historical_sales_imports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "month_start" TIMESTAMP(3) NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "source_mime_type" TEXT NOT NULL,
    "source_size" INTEGER NOT NULL,
    "source_content" BYTEA NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "cutover_applied" BOOLEAN NOT NULL DEFAULT false,
    "imported_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historical_sales_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "historical_sales_imports_station_id_product_id_month_start_key" ON "historical_sales_imports"("station_id", "product_id", "month_start");
CREATE UNIQUE INDEX "historical_sales_imports_organization_id_source_fingerprint_key" ON "historical_sales_imports"("organization_id", "source_fingerprint");
CREATE INDEX "historical_sales_imports_organization_id_month_start_idx" ON "historical_sales_imports"("organization_id", "month_start");
CREATE INDEX "historical_sales_imports_station_id_month_start_idx" ON "historical_sales_imports"("station_id", "month_start");

ALTER TABLE "historical_sales_imports" ADD CONSTRAINT "historical_sales_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historical_sales_imports" ADD CONSTRAINT "historical_sales_imports_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historical_sales_imports" ADD CONSTRAINT "historical_sales_imports_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historical_sales_imports" ADD CONSTRAINT "historical_sales_imports_imported_by_id_fkey" FOREIGN KEY ("imported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
