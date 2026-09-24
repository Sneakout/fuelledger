import { Router } from "express";
import { serviceTicketInputSchema } from "@fuelledger/shared";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/authenticate.js";

export const supportRouter = Router();
supportRouter.use(authenticate);

const present = (ticket: { id: string; ticketNumber: number; issue: string; subIssue: string | null; comments: string; status: string; screenshotFileName: string | null; createdAt: Date; updatedAt: Date }) => ({
  ...ticket,
  reference: `FN-${String(ticket.ticketNumber).padStart(6, "0")}`,
  hasScreenshot: Boolean(ticket.screenshotFileName),
});

supportRouter.get("/tickets", async (req, res) => {
  const tickets = await prisma.serviceTicket.findMany({
    where: { organizationId: req.user!.organization.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, ticketNumber: true, issue: true, subIssue: true, comments: true, status: true, screenshotFileName: true, createdAt: true, updatedAt: true },
  });
  res.json({ tickets: tickets.map(present) });
});

supportRouter.post("/tickets", async (req, res) => {
  const parsed = serviceTicketInputSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "SERVICE_TICKET_INVALID", "Review the issue details before submitting.", parsed.error.flatten());
  const screenshot = parsed.data.screenshot;
  const content = screenshot ? Buffer.from(screenshot.contentBase64, "base64") : null;
  if (screenshot && content?.byteLength !== screenshot.size)
    throw new AppError(400, "SCREENSHOT_INVALID", "The screenshot could not be verified.");
  const ticket = await prisma.serviceTicket.create({
    data: {
      organizationId: req.user!.organization.id,
      createdById: req.user!.id,
      issue: parsed.data.issue,
      subIssue: parsed.data.subIssue || null,
      comments: parsed.data.comments,
      ...(screenshot ? { screenshotFileName: screenshot.fileName, screenshotMimeType: screenshot.mimeType, screenshotSize: screenshot.size, screenshotContent: content! } : {}),
    },
    select: { id: true, ticketNumber: true, issue: true, subIssue: true, comments: true, status: true, screenshotFileName: true, createdAt: true, updatedAt: true },
  });
  res.status(201).json({ ticket: present(ticket) });
});
