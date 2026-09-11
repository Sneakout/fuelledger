import { Router } from "express";
import { customerSubscriptionUpdateSchema } from "@fuelledger/shared";
import { isPlatformAdminEmail } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/authenticate.js";

export const platformRouter = Router();
const planPricesPaise = { CORE: { MONTHLY: 69_900, YEARLY: 598_800, LIFETIME: 2_400_000 }, CORE_INTELLIGENCE: { MONTHLY: 149_900, YEARLY: 1_499_900, FOUNDING_YEARLY: 1_199_900 } } as const;
const planExpiry = (period: "MONTHLY" | "YEARLY" | "LIFETIME" | "FOUNDING_YEARLY", from: Date) => { if (period === "LIFETIME") return null; const expires = new Date(from); if (period === "MONTHLY") expires.setUTCMonth(expires.getUTCMonth() + 1); else expires.setUTCFullYear(expires.getUTCFullYear() + 1); return expires; };
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
      intelligenceEnabledAt: true, intelligenceExpiresAt: true,
      subscriptionPlan: true, subscriptionBillingPeriod: true, subscriptionPricePaise: true,
      subscriptionActivatedAt: true, subscriptionExpiresAt: true,
      users: {
        where: { role: "OWNER" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { name: true, email: true, lastLoginAt: true },
      },
      _count: { select: { stations: true } },
    },
  });
  res.json({
    customers: customers.map(({ users, _count, ...customer }) => ({
      ...customer,
      owner: users[0] ?? null,
      petrolPumps: _count.stations,
    })),
  });
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
  if (pricePaise === undefined) throw new AppError(400, "SUBSCRIPTION_COMBINATION_INVALID", "Choose a billing option available for this plan.");
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
      subscriptionPlan: plan, subscriptionBillingPeriod: billingPeriod, subscriptionPricePaise: pricePaise,
      subscriptionActivatedAt: activatedAt, subscriptionExpiresAt: expiresAt,
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
