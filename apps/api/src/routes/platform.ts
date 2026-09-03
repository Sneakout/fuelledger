import { Router } from "express";
import { isPlatformAdminEmail } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/authenticate.js";

export const platformRouter = Router();
platformRouter.use(authenticate);
platformRouter.get("/demo-leads", async (req, res) => {
  if (!isPlatformAdminEmail(req.user!.email)) {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "This area is restricted to the FuelLedger team.");
  }
  const leads = await prisma.demoSession.findMany({
    orderBy: { createdAt: "desc" },
    take: 250,
    select: { id: true, contact: true, kind: true, createdAt: true, expiresAt: true },
  });
  const uniqueContacts = new Set(leads.map((lead) => lead.contact.toLowerCase())).size;
  res.json({ leads, summary: { sessions: leads.length, uniqueContacts } });
});
