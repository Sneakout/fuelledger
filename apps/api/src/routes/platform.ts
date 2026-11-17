import { Router } from "express";
import { customerSubscriptionUpdateSchema } from "@fuelledger/shared";
import { z } from "zod";
import { isPlatformAdminEmail } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/authenticate.js";
import { presentNotificationSettings, sendTestNotification } from "../modules/notifications/service.js";
import { drainAgentMessages } from "../modules/notifications/agent-dispatch.js";
import { drainReviewJobs, scheduleDailyReviews } from "../modules/nerve/review-worker.js";
import { prepareNotificationPreviews, runScheduledNotifications } from "../modules/notifications/service.js";
import { approveRolloutPreview, pauseRollout, readRollout, rolloutInput, updateRollout } from "../modules/notifications/whatsapp-rollout.js";
import { adminWhatsAppDeliveries, drainWhatsAppQueue, retryWhatsAppDelivery } from "../modules/notifications/delivery-queue.js";

export const platformRouter = Router();
const planPricesPaise = {
  CORE: { MONTHLY: 69_900, YEARLY: 598_800, LIFETIME: 2_400_000 },
  CORE_INTELLIGENCE: { MONTHLY: 149_900, YEARLY: 1_499_900, FOUNDING_YEARLY: 1_199_900 },
} as const;
const planExpiry = (billingPeriod: "MONTHLY" | "YEARLY" | "LIFETIME" | "FOUNDING_YEARLY", from: Date) => {
  if (billingPeriod === "LIFETIME") return null;
  const expires = new Date(from);
  if (billingPeriod === "MONTHLY") expires.setUTCMonth(expires.getUTCMonth() + 1);
  else expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires;
};
platformRouter.use(authenticate);
const requirePlatformAdmin = (email: string) => {
  if (!isPlatformAdminEmail(email))
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "This area is restricted to the FuelNerve team.");
};
platformRouter.get("/demo-leads", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const leads = await prisma.demoSession.findMany({
    orderBy: { createdAt: "desc" },
    take: 250,
    select: { id: true, contact: true, kind: true, createdAt: true, expiresAt: true },
  });
  const uniqueContacts = new Set(leads.map((lead) => lead.contact.toLowerCase())).size;
  res.json({ leads, summary: { sessions: leads.length, uniqueContacts } });
});
platformRouter.get("/customers", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const customers = await prisma.organization.findMany({
    where: {
      users: {
        some: { role: "OWNER", email: { not: "owner@fuelledger.local" } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 250,
    select: {
      id: true,
      name: true,
      createdAt: true,
      setupFeePaidAt: true,
      lifetimeAccessPaidAt: true,
      subscriptionUpdatedAt: true,
      subscriptionUpdatedBy: true,
      intelligenceEnabledAt: true,
      intelligenceExpiresAt: true,
      subscriptionPlan: true,
      subscriptionBillingPeriod: true,
      subscriptionPricePaise: true,
      subscriptionActivatedAt: true,
      subscriptionExpiresAt: true,
      users: {
        where: { role: "OWNER" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { name: true, email: true, lastLoginAt: true },
      },
      notificationSettings: true,
      _count: { select: { stations: true } },
    },
  });
  res.json({
    customers: customers.map(({ users, _count, notificationSettings, ...customer }) => ({
      ...customer,
      owner: users[0] ?? null,
      petrolPumps: _count.stations,
      notificationSettings: presentNotificationSettings(notificationSettings),
    })),
  });
});
platformRouter.get("/service-tickets", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const tickets = await prisma.serviceTicket.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 250,
    select: {
      id: true, ticketNumber: true, issue: true, subIssue: true, comments: true, status: true,
      screenshotFileName: true, adminNote: true, createdAt: true, updatedAt: true, resolvedAt: true,
      organization: { select: { id: true, name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  res.json({ tickets: tickets.map((ticket) => ({ ...ticket, reference: `FN-${String(ticket.ticketNumber).padStart(6, "0")}`, hasScreenshot: Boolean(ticket.screenshotFileName) })) });
});
platformRouter.patch("/service-tickets/:id", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const parsed = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]), adminNote: z.string().trim().max(2_000).optional() }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "SERVICE_TICKET_UPDATE_INVALID", "Review the ticket update.", parsed.error.flatten());
  const existing = await prisma.serviceTicket.findUnique({ where: { id: req.params.id! }, select: { id: true } });
  if (!existing) throw new AppError(404, "SERVICE_TICKET_NOT_FOUND", "This service ticket was not found.");
  const ticket = await prisma.serviceTicket.update({
    where: { id: existing.id },
    data: { status: parsed.data.status, adminNote: parsed.data.adminNote || null, resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : null },
    select: { id: true, status: true, adminNote: true, resolvedAt: true, updatedAt: true },
  });
  res.json({ ticket });
});
platformRouter.get("/service-tickets/:id/screenshot", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const screenshot = await prisma.serviceTicket.findUnique({ where: { id: req.params.id! }, select: { screenshotFileName: true, screenshotMimeType: true, screenshotContent: true } });
  if (!screenshot?.screenshotContent || !screenshot.screenshotMimeType || !screenshot.screenshotFileName)
    throw new AppError(404, "SCREENSHOT_NOT_FOUND", "This ticket does not have a screenshot.");
  res.type(screenshot.screenshotMimeType).setHeader("Content-Disposition", `inline; filename="${screenshot.screenshotFileName.replaceAll('"', '')}"`).send(screenshot.screenshotContent);
});
platformRouter.get("/whatsapp-rollout", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const policy = await readRollout();
  const outcomes = await prisma.ownerNotificationDelivery.groupBy({
    by: ["status", "rolloutHold", "suppressionReason", "failureKind"],
    where: { eventKey: { not: null }, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    _count: { _all: true },
  });
  const audit = await prisma.whatsAppRolloutAudit.findMany({ orderBy: { createdAt: "desc" }, take: 15,
    select: { id: true, action: true, createdAt: true } });
  res.json({ policy, audit, outcomes: outcomes.map(({ _count, ...outcome }) => ({ ...outcome, count: _count._all })) });
});
platformRouter.put("/whatsapp-rollout", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const input = rolloutInput.safeParse(req.body);
  if (!input.success) throw new AppError(400, "ROLLOUT_INVALID", input.error.issues[0]?.message ?? "Review the delivery settings.");
  res.json({ policy: await updateRollout(input.data, req.user!.id) });
});
platformRouter.post("/whatsapp-rollout/pause", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  res.json({ policy: await pauseRollout(req.user!.id) });
});
platformRouter.post("/whatsapp-rollout/preview", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const result = await prepareNotificationPreviews(async () => {
    const queued = await scheduleDailyReviews();
    const reviews = await drainReviewJobs();
    await runScheduledNotifications(new Date());
    const messages = await drainAgentMessages();
    const previews = await drainWhatsAppQueue(new Date(), { previewOnly: true });
    return { queued, reviews, messages, previews };
  });
  res.json(result);
});
platformRouter.post("/whatsapp-rollout/process-approved", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  res.json(await drainWhatsAppQueue());
});
platformRouter.post("/customers/:id/notifications/deliveries/:deliveryId/approve-preview", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const input = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(req.body);
  if (!input.success) throw new AppError(400, "PREVIEW_INVALID", "Refresh the message preview before approving it.");
  await approveRolloutPreview(req.params.id!, req.params.deliveryId!, input.data.hash, req.user!.id);
  res.status(204).end();
});
platformRouter.post("/customers/:id/notifications/test", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const customer = await prisma.organization.findUnique({ where: { id: req.params.id! }, select: { id: true } });
  if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "This customer account was not found.");
  res.json({ delivery: await sendTestNotification(customer.id) });
});
platformRouter.get("/customers/:id/notifications/deliveries", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  res.json({ deliveries: await adminWhatsAppDeliveries(req.params.id!) });
});
platformRouter.post("/customers/:id/notifications/deliveries/:deliveryId/retry", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  await retryWhatsAppDelivery(req.params.id!, req.params.deliveryId!, req.user!.id);
  res.status(202).json({ queued: true });
});
platformRouter.put("/customers/:id/subscription", async (req, res) => {
  requirePlatformAdmin(req.user!.email);
  const parsed = customerSubscriptionUpdateSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(400, "SUBSCRIPTION_INVALID", parsed.error.issues[0]?.message ?? "Review the payment confirmations.");
  const existing = await prisma.organization.findUnique({ where: { id: req.params.id! } });
  if (!existing) throw new AppError(404, "CUSTOMER_NOT_FOUND", "This customer account was not found.");
  const now = new Date();
  const { plan, billingPeriod, paymentConfirmed, setupFeePaid } = parsed.data;
  const pricePaise = planPricesPaise[plan][billingPeriod as keyof (typeof planPricesPaise)[typeof plan]];
  if (pricePaise === undefined)
    throw new AppError(400, "SUBSCRIPTION_COMBINATION_INVALID", "Choose a billing option available for this plan.");
  const sameActivePlan = Boolean(existing.subscriptionActivatedAt && existing.subscriptionPlan === plan && existing.subscriptionBillingPeriod === billingPeriod);
  const activatedAt = paymentConfirmed ? (sameActivePlan ? existing.subscriptionActivatedAt : now) : null;
  const expiresAt = paymentConfirmed ? (sameActivePlan ? existing.subscriptionExpiresAt : planExpiry(billingPeriod, now)) : null;
  const intelligenceEnabled = paymentConfirmed && plan === "CORE_INTELLIGENCE";
  const lifetimeAccess = paymentConfirmed && plan === "CORE" && billingPeriod === "LIFETIME";
  const customer = await prisma.organization.update({
    where: { id: existing.id },
    data: {
      setupFeePaidAt: setupFeePaid ? existing.setupFeePaidAt ?? now : null,
      lifetimeAccessPaidAt: lifetimeAccess ? existing.lifetimeAccessPaidAt ?? now : null,
      subscriptionUpdatedAt: now,
      subscriptionUpdatedBy: req.user!.email,
      subscriptionPlan: plan,
      subscriptionBillingPeriod: billingPeriod,
      subscriptionPricePaise: pricePaise,
      subscriptionActivatedAt: activatedAt,
      subscriptionExpiresAt: expiresAt,
      intelligenceEnabledAt: intelligenceEnabled ? existing.intelligenceEnabledAt ?? now : null,
      intelligenceExpiresAt: intelligenceEnabled ? expiresAt : null,
    },
    select: { id: true, setupFeePaidAt: true, lifetimeAccessPaidAt: true, intelligenceEnabledAt: true, intelligenceExpiresAt: true, subscriptionPlan: true, subscriptionBillingPeriod: true, subscriptionPricePaise: true, subscriptionActivatedAt: true, subscriptionExpiresAt: true, subscriptionUpdatedAt: true, subscriptionUpdatedBy: true },
  });
  res.json({ customer });
});
platformRouter.get("/subscription", async (req, res) => {
  const subscription = await prisma.organization.findUnique({
    where: { id: req.user!.organization.id },
    select: { setupFeePaidAt: true, lifetimeAccessPaidAt: true, intelligenceEnabledAt: true, intelligenceExpiresAt: true, subscriptionPlan: true, subscriptionBillingPeriod: true, subscriptionPricePaise: true, subscriptionActivatedAt: true, subscriptionExpiresAt: true, subscriptionUpdatedAt: true },
  });
  if (!subscription) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Your organization was not found.");
  res.json(subscription);
});

platformRouter.get("/capabilities", async (_req, res) => {
  // Mutations are individually advertised and still require server-side
  // authorization, validation, idempotency, and an explicit user decision.
  res.json({
    version: 1,
    readOnly: true,
    approvals: true,
    alertAcknowledgement: false,
    pushRegistration: true,
    proposals: false,
    execution: false,
    invoiceCapture: true,
  });
});
