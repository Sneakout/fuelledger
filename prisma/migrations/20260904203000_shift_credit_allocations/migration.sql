CREATE TABLE "shift_credit_allocations" (
  "id" TEXT NOT NULL,
  "reconciliation_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "vehicle_id" TEXT,
  "payment_method" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_credit_allocations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_ledger" ADD COLUMN "shift_credit_allocation_id" TEXT;
CREATE UNIQUE INDEX "customer_ledger_shift_credit_allocation_id_key" ON "customer_ledger"("shift_credit_allocation_id");
CREATE INDEX "shift_credit_allocations_reconciliation_id_payment_method_idx" ON "shift_credit_allocations"("reconciliation_id", "payment_method");
CREATE INDEX "shift_credit_allocations_customer_id_due_date_idx" ON "shift_credit_allocations"("customer_id", "due_date");
ALTER TABLE "shift_credit_allocations" ADD CONSTRAINT "shift_credit_allocations_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "shift_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_credit_allocations" ADD CONSTRAINT "shift_credit_allocations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_credit_allocations" ADD CONSTRAINT "shift_credit_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_ledger" ADD CONSTRAINT "customer_ledger_shift_credit_allocation_id_fkey" FOREIGN KEY ("shift_credit_allocation_id") REFERENCES "shift_credit_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
