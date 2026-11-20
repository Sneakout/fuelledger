-- Email has its own dispatch progress; WhatsApp and review progress remain unchanged.
ALTER TABLE "nerve_review_jobs" ADD COLUMN "emailHandledAt" TIMESTAMP(3),
  ADD COLUMN "emailNextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Do not replay pre-rollout events as newly received deliveries or completed shifts.
UPDATE "nerve_review_jobs" SET "emailHandledAt" = CURRENT_TIMESTAMP;
CREATE INDEX "nerve_review_email_idx" ON "nerve_review_jobs"("organizationId", "emailHandledAt", "emailNextAt");
