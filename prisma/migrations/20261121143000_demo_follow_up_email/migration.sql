CREATE TABLE "demo_follow_up_emails" (
 "id" TEXT NOT NULL PRIMARY KEY, "destination" TEXT NOT NULL,
 "demo_session_id" TEXT NOT NULL, "template_version" TEXT NOT NULL,
 "subject" TEXT NOT NULL, "html" TEXT NOT NULL, "text" TEXT NOT NULL,
 "preview_hash" TEXT NOT NULL, "unsubscribe_token" TEXT NOT NULL,
 "opted_out_at" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'PENDING',
 "attempts" INTEGER NOT NULL DEFAULT 0, "prepared_by" TEXT NOT NULL,
 "sent_by" TEXT, "permission_confirmed_at" TIMESTAMP(3), "claim_token" TEXT,
 "lease_until" TIMESTAMP(3), "provider_message_id" TEXT, "error_message" TEXT,
 "accepted_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "demo_follow_up_emails_destination_key" ON "demo_follow_up_emails"("destination");
CREATE UNIQUE INDEX "demo_follow_up_emails_unsubscribe_token_key" ON "demo_follow_up_emails"("unsubscribe_token");
