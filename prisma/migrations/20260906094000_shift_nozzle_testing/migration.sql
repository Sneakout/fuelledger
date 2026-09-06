ALTER TABLE "shift_nozzle_readings"
ADD COLUMN "testing_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN "testing_returned" BOOLEAN NOT NULL DEFAULT true;
