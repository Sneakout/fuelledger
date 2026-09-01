-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIPT', 'SALE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "reference_no" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_lines" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tank_id" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_ledger" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tank_id" TEXT,
    "type" "InventoryMovementType" NOT NULL,
    "quantity_delta" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "sale_id" TEXT,
    "receipt_line_id" TEXT,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tank_readings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "tank_id" TEXT NOT NULL,
    "physical_stock" DECIMAL(14,3) NOT NULL,
    "dip_reading" DECIMAL(14,3),
    "notes" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_id" TEXT NOT NULL,

    CONSTRAINT "tank_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_receipts_station_id_received_at_idx" ON "purchase_receipts"("station_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_ledger_sale_id_key" ON "inventory_ledger"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_ledger_receipt_line_id_key" ON "inventory_ledger"("receipt_line_id");

-- CreateIndex
CREATE INDEX "inventory_ledger_station_id_product_id_occurred_at_idx" ON "inventory_ledger"("station_id", "product_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_ledger_tank_id_occurred_at_idx" ON "inventory_ledger"("tank_id", "occurred_at");

-- CreateIndex
CREATE INDEX "tank_readings_tank_id_recorded_at_idx" ON "tank_readings"("tank_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_receipt_line_id_fkey" FOREIGN KEY ("receipt_line_id") REFERENCES "receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve sales recorded before the ledger existed. Future sales create this entry atomically.
INSERT INTO "inventory_ledger" ("id", "organization_id", "station_id", "product_id", "tank_id", "type", "quantity_delta", "sale_id", "occurred_at", "created_by_id")
SELECT 'sale-ledger-' || s."id", s."organization_id", s."station_id", s."product_id", s."tank_id", 'SALE', -s."quantity", s."id", s."occurred_at", s."employee_id"
FROM "sales" s
JOIN "products" p ON p."id" = s."product_id"
WHERE p."inventory_tracked" = true;
