CREATE TABLE "service_tickets" (
  "id" TEXT NOT NULL,
  "ticket_number" SERIAL NOT NULL,
  "organization_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "issue" TEXT NOT NULL,
  "sub_issue" TEXT,
  "comments" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "screenshot_file_name" TEXT,
  "screenshot_mime_type" TEXT,
  "screenshot_size" INTEGER,
  "screenshot_content" BYTEA,
  "admin_note" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_tickets_ticket_number_key" ON "service_tickets"("ticket_number");
CREATE INDEX "service_tickets_status_created_at_idx" ON "service_tickets"("status", "created_at");
CREATE INDEX "service_tickets_organization_id_created_at_idx" ON "service_tickets"("organization_id", "created_at");

ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
