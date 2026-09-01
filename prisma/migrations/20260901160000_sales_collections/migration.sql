-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'CREDIT', 'FLEET');

-- CreateEnum
CREATE TYPE "SaleKind" AS ENUM ('METERED', 'PRODUCT', 'SERVICE');

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "tank_id" TEXT,
    "nozzle_id" TEXT,
    "kind" "SaleKind" NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "meter_opening" DECIMAL(14,3),
    "meter_closing" DECIMAL(14,3),
    "customer_name" TEXT,
    "vehicle_number" TEXT,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_organization_id_occurred_at_idx" ON "sales"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "sales_station_id_shift_id_idx" ON "sales"("station_id", "shift_id");

-- CreateIndex
CREATE INDEX "sales_nozzle_id_occurred_at_idx" ON "sales"("nozzle_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tank_id_fkey" FOREIGN KEY ("tank_id") REFERENCES "tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_nozzle_id_fkey" FOREIGN KEY ("nozzle_id") REFERENCES "nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
