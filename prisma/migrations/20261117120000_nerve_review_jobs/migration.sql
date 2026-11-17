CREATE TABLE "nerve_review_jobs" (
  "id" TEXT PRIMARY KEY,
  "eventKey" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  "agentKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "outcome" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "nerve_review_event_agent_key"
  ON "nerve_review_jobs" ("organizationId", "stationId", "eventKey", "agentKey");
CREATE INDEX "nerve_review_claim_idx"
  ON "nerve_review_jobs" ("completedAt", "failedAt", "availableAt", "leaseUntil");
CREATE INDEX "nerve_review_latest_idx"
  ON "nerve_review_jobs" ("organizationId", "stationId", "agentKey", "completedAt");
