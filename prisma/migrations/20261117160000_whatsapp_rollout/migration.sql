CREATE TABLE "whatsapp_rollout" (
  "id" TEXT PRIMARY KEY,
  "stage" TEXT NOT NULL DEFAULT 'SHADOW' CHECK ("stage" IN ('SHADOW','INTERNAL','PILOT','EXPANDED')),
  "paused" BOOLEAN NOT NULL DEFAULT true,
  "organization_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enabled_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "whatsapp_rollout" ("id") VALUES ('global');

CREATE TABLE "whatsapp_rollout_audit" (
  "id" TEXT PRIMARY KEY,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "owner_notification_deliveries"
  ADD COLUMN "rollout_stage" TEXT,
  ADD COLUMN "rollout_hold" TEXT,
  ADD COLUMN "preview_body" TEXT,
  ADD COLUMN "preview_template" TEXT,
  ADD COLUMN "preview_hash" TEXT,
  ADD COLUMN "preview_at" TIMESTAMP(3),
  ADD COLUMN "approved_preview_hash" TEXT;
