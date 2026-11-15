import express, { Router } from "express";
import { env, whatsappWebhookConfigured } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { processWhatsAppWebhook, verifyWebhookSignature, verifyWebhookToken } from "../modules/notifications/whatsapp-webhook.js";

export const whatsappWebhookRouter = Router();

whatsappWebhookRouter.get("/", (req, res) => {
  if (!whatsappWebhookConfigured || !env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
    throw new AppError(503, "WHATSAPP_WEBHOOK_NOT_CONFIGURED", "WhatsApp webhook verification is not configured.");
  const mode = typeof req.query["hub.mode"] === "string" ? req.query["hub.mode"] : undefined;
  const token = typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : undefined;
  const challenge = typeof req.query["hub.challenge"] === "string" ? req.query["hub.challenge"] : undefined;
  if (mode !== "subscribe" || !challenge || !verifyWebhookToken(token, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN))
    throw new AppError(403, "WHATSAPP_WEBHOOK_VERIFICATION_FAILED", "WhatsApp webhook verification failed.");
  res.type("text/plain").send(challenge);
});

whatsappWebhookRouter.post("/", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!whatsappWebhookConfigured || !env.WHATSAPP_APP_SECRET)
    throw new AppError(503, "WHATSAPP_WEBHOOK_NOT_CONFIGURED", "WhatsApp webhook verification is not configured.");
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, req.get("x-hub-signature-256"), env.WHATSAPP_APP_SECRET))
    throw new AppError(401, "WHATSAPP_WEBHOOK_SIGNATURE_INVALID", "WhatsApp webhook signature is invalid.");
  let payload: unknown;
  try { payload = JSON.parse(req.body.toString("utf8")); }
  catch { throw new AppError(400, "WHATSAPP_WEBHOOK_BODY_INVALID", "WhatsApp webhook body is invalid."); }
  const result = await processWhatsAppWebhook(payload as Parameters<typeof processWhatsAppWebhook>[0]);
  res.json({ received: true, ...result });
});
