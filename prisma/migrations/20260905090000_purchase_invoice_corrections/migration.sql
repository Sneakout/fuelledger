CREATE TABLE "purchase_invoice_corrections" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "before_lines" JSONB NOT NULL,
  "after_lines" JSONB NOT NULL,
  "previous_total" DECIMAL(14,2) NOT NULL,
  "corrected_total" DECIMAL(14,2) NOT NULL,
  "corrected_by_id" TEXT NOT NULL,
  "corrected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_invoice_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_invoice_corrections_invoice_id_corrected_at_idx"
  ON "purchase_invoice_corrections"("invoice_id", "corrected_at");

ALTER TABLE "purchase_invoice_corrections"
  ADD CONSTRAINT "purchase_invoice_corrections_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_corrections"
  ADD CONSTRAINT "purchase_invoice_corrections_corrected_by_id_fkey"
  FOREIGN KEY ("corrected_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
