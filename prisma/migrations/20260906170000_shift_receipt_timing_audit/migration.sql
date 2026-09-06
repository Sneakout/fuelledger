CREATE TABLE "receipt_timing_audit_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "receipt_id" TEXT NOT NULL,
  "previous_received_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "affected_shift_id" TEXT,
  "affected_shift_status" "ShiftStatus",
  "affects_closed_shift" BOOLEAN NOT NULL DEFAULT false,
  "changed_by_id" TEXT NOT NULL,
  "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receipt_timing_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receipt_timing_audit_events_receipt_id_changed_at_idx"
ON "receipt_timing_audit_events"("receipt_id", "changed_at");

CREATE INDEX "receipt_timing_audit_events_affected_shift_id_idx"
ON "receipt_timing_audit_events"("affected_shift_id");

ALTER TABLE "receipt_timing_audit_events"
ADD CONSTRAINT "receipt_timing_audit_events_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_timing_audit_events"
ADD CONSTRAINT "receipt_timing_audit_events_station_id_fkey"
FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_timing_audit_events"
ADD CONSTRAINT "receipt_timing_audit_events_receipt_id_fkey"
FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_timing_audit_events"
ADD CONSTRAINT "receipt_timing_audit_events_affected_shift_id_fkey"
FOREIGN KEY ("affected_shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_timing_audit_events"
ADD CONSTRAINT "receipt_timing_audit_events_changed_by_id_fkey"
FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
