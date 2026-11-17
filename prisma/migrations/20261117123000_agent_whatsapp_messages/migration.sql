ALTER TYPE "OwnerNotificationType" ADD VALUE 'SHIFT_CLOSED_SUMMARY';
ALTER TYPE "OwnerNotificationType" ADD VALUE 'PURCHASE_RECEIPT_SUMMARY';

ALTER TABLE "nerve_review_jobs"
  ADD COLUMN "notificationHandledAt" TIMESTAMP(3),
  ADD COLUMN "notificationNextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "nerve_review_notification_idx" ON "nerve_review_jobs" ("notificationHandledAt", "notificationNextAt");
UPDATE "nerve_review_jobs" SET "notificationHandledAt" = CURRENT_TIMESTAMP;

CREATE TABLE "stock_alert_states" (
  "tankId" TEXT PRIMARY KEY,
  "episodeId" TEXT NOT NULL,
  "level" TEXT NOT NULL
);
