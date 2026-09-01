CREATE TABLE "shift_nozzle_assignments" (
  "shift_id" TEXT NOT NULL,
  "nozzle_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  CONSTRAINT "shift_nozzle_assignments_pkey" PRIMARY KEY ("shift_id", "nozzle_id"),
  CONSTRAINT "shift_nozzle_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shift_nozzle_assignments_nozzle_id_fkey" FOREIGN KEY ("nozzle_id") REFERENCES "nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shift_nozzle_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "shift_nozzle_assignments_shift_id_user_id_idx" ON "shift_nozzle_assignments"("shift_id", "user_id");
