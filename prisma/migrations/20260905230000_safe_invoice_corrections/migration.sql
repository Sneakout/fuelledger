ALTER TABLE "purchase_invoices" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
-- Do not infer payment provenance for legacy records.
ALTER TABLE "supplier_payments" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'RECORDED_PAYMENT';
