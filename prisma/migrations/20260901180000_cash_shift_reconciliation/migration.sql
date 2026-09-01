-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'OTHER';

-- CreateTable
CREATE TABLE "shift_reconciliations" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "reconciled_by_id" TEXT NOT NULL,
    "reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "shift_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_collection_reconciliations" (
    "id" TEXT NOT NULL,
    "reconciliation_id" TEXT NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "expected_amount" DECIMAL(14,2) NOT NULL,
    "actual_amount" DECIMAL(14,2) NOT NULL,
    "adjustment_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjustment_reason" TEXT,
    "variance_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "shift_collection_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_reconciliations_shift_id_key" ON "shift_reconciliations"("shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "shift_collection_reconciliations_reconciliation_id_payment__key" ON "shift_collection_reconciliations"("reconciliation_id", "payment_method");

-- AddForeignKey
ALTER TABLE "shift_reconciliations" ADD CONSTRAINT "shift_reconciliations_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_reconciliations" ADD CONSTRAINT "shift_reconciliations_reconciled_by_id_fkey" FOREIGN KEY ("reconciled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_collection_reconciliations" ADD CONSTRAINT "shift_collection_reconciliations_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "shift_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
