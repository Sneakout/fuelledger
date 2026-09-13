CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ApprovalActionType" AS ENUM ('INVENTORY_ADJUSTMENT');

CREATE TABLE "approval_requests" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "station_id" TEXT NOT NULL,
  "action_type" "ApprovalActionType" NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "request_key" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "decided_by_id" TEXT,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "executed_at" TIMESTAMP(3),
  "execution_type" TEXT,
  "execution_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_requests_organization_id_request_key_key" ON "approval_requests"("organization_id", "request_key");
CREATE INDEX "approval_requests_organization_id_status_requested_at_idx" ON "approval_requests"("organization_id", "status", "requested_at");
CREATE INDEX "approval_requests_station_id_status_requested_at_idx" ON "approval_requests"("station_id", "status", "requested_at");
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
