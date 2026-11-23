-- Add operational heartbeat without changing delivery jobs or account data.
CREATE TABLE "email_worker_heartbeats" (
  "stage" TEXT NOT NULL PRIMARY KEY,
  "last_started_at" TIMESTAMP(3) NOT NULL,
  "last_succeeded_at" TIMESTAMP(3),
  "last_failed_at" TIMESTAMP(3),
  "last_run_failed" BOOLEAN NOT NULL DEFAULT false
);
