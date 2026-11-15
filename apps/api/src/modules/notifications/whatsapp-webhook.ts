import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";

type MetaWebhookError = { code?: number; title?: string; message?: string };
type MetaMessageStatus = {
  id?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  timestamp?: string;
  errors?: MetaWebhookError[];
};
type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: { statuses?: MetaMessageStatus[] };
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
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function failureMessage(errors: MetaWebhookError[] | undefined) {
  if (!errors?.length) return "Meta reported that the WhatsApp message failed.";
  return errors.map(error => [error.code, error.title ?? error.message].filter(Boolean).join(": ")).filter(Boolean).join("; ").slice(0, 500);
}

export async function processWhatsAppWebhook(payload: MetaWebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return { processed: 0 };
  const statuses = payload.entry?.flatMap(entry => entry.changes ?? [])
    .filter(change => change.field === "messages")
    .flatMap(change => change.value?.statuses ?? []) ?? [];
  let processed = 0;
  for (const event of statuses) {
    if (!event.id || !event.status) continue;
    const at = statusTime(event.timestamp);
    const result = event.status === "sent"
      ? await prisma.ownerNotificationDelivery.updateMany({ where: { providerMessageId: event.id, status: "PENDING" }, data: { status: "SENT", sentAt: at, errorMessage: null } })
      : event.status === "delivered"
        ? await prisma.ownerNotificationDelivery.updateMany({ where: { providerMessageId: event.id, status: { in: ["PENDING", "SENT"] } }, data: { status: "DELIVERED", deliveredAt: at, errorMessage: null } })
        : event.status === "read"
          ? await prisma.ownerNotificationDelivery.updateMany({ where: { providerMessageId: event.id, status: { in: ["PENDING", "SENT", "DELIVERED"] } }, data: { status: "READ", readAt: at, errorMessage: null } })
          : await prisma.ownerNotificationDelivery.updateMany({ where: { providerMessageId: event.id, status: { in: ["PENDING", "SENT"] } }, data: { status: "FAILED", failedAt: at, errorMessage: failureMessage(event.errors) } });
    processed += result.count;
  }
  return { processed };
}
