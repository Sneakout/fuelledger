CREATE TABLE "intelligence_questions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "station_id" TEXT,
  "question" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "facts" JSONB NOT NULL,
  "answer" JSONB NOT NULL,
  "answer_mode" TEXT NOT NULL,
  "model" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intelligence_questions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "intelligence_questions_organization_id_request_key_key" ON "intelligence_questions"("organization_id", "request_key");
CREATE INDEX "intelligence_questions_organization_id_created_at_idx" ON "intelligence_questions"("organization_id", "created_at");
CREATE INDEX "intelligence_questions_user_id_created_at_idx" ON "intelligence_questions"("user_id", "created_at");
ALTER TABLE "intelligence_questions" ADD CONSTRAINT "intelligence_questions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intelligence_questions" ADD CONSTRAINT "intelligence_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intelligence_questions" ADD CONSTRAINT "intelligence_questions_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
