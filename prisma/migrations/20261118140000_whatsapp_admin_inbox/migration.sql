CREATE INDEX "whatsapp_delivery_history_idx" ON "owner_notification_deliveries"("created_at", "id");
CREATE INDEX "whatsapp_delivery_attention_idx" ON "owner_notification_deliveries"("status", "created_at", "id");
