import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";

type MetaWebhookError = { code?: number; title?: string; message?: string };
type MetaMessageStatus = {
  id?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  timestamp?: string;
  biz_opaque_callback_data?: string;
  errors?: MetaWebhookError[];
};
type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: { statuses?: MetaMessageStatus[]; metadata?: { phone_number_id?: string } };
    }>;
  }>;
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyWebhookToken(received: string | undefined, expected: string) {
  return Boolean(received && safeEqual(received, expected));
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(signature, expected);
}

function statusTime(value: string | undefined) {
  const seconds = Number(value);
  const parsed = new Date(seconds * 1000);
  return seconds > 0 && Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function failureMessage(errors: MetaWebhookError[] | undefined) {
  if (!errors?.length) return "Meta reported that the WhatsApp message failed.";
  return errors.map(error => [error.code, error.title ?? error.message].filter(Boolean).join(": ")).filter(Boolean).join("; ").slice(0, 500);
}

export async function processWhatsAppWebhook(payload: MetaWebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return { processed: 0 };
  const statuses = payload.entry?.filter(entry => !env.WHATSAPP_BUSINESS_ACCOUNT_ID || entry.id === env.WHATSAPP_BUSINESS_ACCOUNT_ID)
    .flatMap(entry => entry.changes ?? [])
    .filter(change => change.field === "messages" && (!env.WHATSAPP_PHONE_NUMBER_ID
      || change.value?.metadata?.phone_number_id === env.WHATSAPP_PHONE_NUMBER_ID))
    .flatMap(change => change.value?.statuses ?? []) ?? [];
  let processed = 0;
  for (const event of statuses) {
    if (typeof event.id !== "string" || !["sent", "delivered", "read", "failed"].includes(event.status ?? "")) continue;
    const callback = typeof event.biz_opaque_callback_data === "string" ? event.biz_opaque_callback_data : null;
    processed += await applyStatus(event, event.id, callback);
  }
  return { processed };
}

async function applyStatus(event: MetaMessageStatus, providerMessageId: string, callback: string | null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const delivery = await prisma.ownerNotificationDelivery.findFirst({
      where: { OR: [
        { providerMessageId: providerMessageId },
        ...(callback ? [{ callbackKey: callback, providerMessageId: null, dispatchStartedAt: { not: null } }] : []),
      ] },
      select: { id: true, providerMessageId: true, callbackKey: true, status: true, failureKind: true },
    });
    if (!delivery || (callback && delivery.callbackKey && delivery.callbackKey !== callback)) return 0;
    const at = statusTime(event.timestamp);
    const early = ["PENDING", "PROCESSING", "SENT", "ACCEPTED"].includes(delivery.status);
    const uncertain = delivery.status === "FAILED" && delivery.failureKind === "UNCERTAIN";
    const update = event.status === "sent" && (delivery.status === "PROCESSING" || delivery.status === "PENDING" || uncertain)
      ? { status: "ACCEPTED" as const, sentAt: at }
      : event.status === "delivered" && (early || delivery.status === "FAILED")
        ? { status: "DELIVERED" as const, deliveredAt: at }
        : event.status === "read" && (early || delivery.status === "DELIVERED" || delivery.status === "FAILED")
          ? { status: "READ" as const, readAt: at }
          : event.status === "failed" && (early || uncertain)
            ? { status: "FAILED" as const, failedAt: at, failureKind: "PROVIDER_FAILED", errorMessage: failureMessage(event.errors) }
            : null;
    if (!update) return 0;
    const result = await prisma.ownerNotificationDelivery.updateMany({
      where: { id: delivery.id, status: delivery.status, callbackKey: delivery.callbackKey, providerMessageId: delivery.providerMessageId },
      data: { providerMessageId: providerMessageId, leaseUntil: null, errorMessage: null, failureKind: null, ...update },
    });
    if (result.count) return 1;
  }
  throw new Error("Concurrent WhatsApp status update. Retry the webhook.");
}
