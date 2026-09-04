import { Router } from "express";
import { customerSubscriptionUpdateSchema } from "@fuelledger/shared";
import { isPlatformAdminEmail } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/authenticate.js";

export const platformRouter = Router();
platformRouter.use(authenticate);
const requirePlatformAdmin = (email: string) => {
  if (!isPlatformAdminEmail(email))
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "This area is restricted to the FuelLedger team.");
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
  const customer = await prisma.organization.update({
    where: { id: existing.id },
    data: {
      setupFeePaidAt: parsed.data.setupFeePaid ? existing.setupFeePaidAt ?? now : null,
      lifetimeAccessPaidAt: parsed.data.lifetimeAccessPaid ? existing.lifetimeAccessPaidAt ?? now : null,
      subscriptionUpdatedAt: now,
      subscriptionUpdatedBy: req.user!.email,
    },
    select: { id: true, setupFeePaidAt: true, lifetimeAccessPaidAt: true, subscriptionUpdatedAt: true, subscriptionUpdatedBy: true },
  });
  res.json({ customer });
});
platformRouter.get("/subscription", async (req, res) => {
  const subscription = await prisma.organization.findUnique({
    where: { id: req.user!.organization.id },
    select: { setupFeePaidAt: true, lifetimeAccessPaidAt: true, subscriptionUpdatedAt: true },
  });
  if (!subscription) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Your organization was not found.");
  res.json(subscription);
});
