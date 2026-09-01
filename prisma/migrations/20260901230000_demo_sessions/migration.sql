CREATE TABLE "demo_sessions" (
  "id" TEXT NOT NULL,
  "contact" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "demo_sessions_expires_at_idx" ON "demo_sessions"("expires_at");
