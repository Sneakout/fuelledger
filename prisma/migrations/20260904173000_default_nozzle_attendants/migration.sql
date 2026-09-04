CREATE TABLE "nozzle_attendant_assignments" (
    "nozzle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nozzle_attendant_assignments_pkey" PRIMARY KEY ("nozzle_id")
);

CREATE INDEX "nozzle_attendant_assignments_user_id_idx" ON "nozzle_attendant_assignments"("user_id");

ALTER TABLE "nozzle_attendant_assignments" ADD CONSTRAINT "nozzle_attendant_assignments_nozzle_id_fkey" FOREIGN KEY ("nozzle_id") REFERENCES "nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nozzle_attendant_assignments" ADD CONSTRAINT "nozzle_attendant_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
