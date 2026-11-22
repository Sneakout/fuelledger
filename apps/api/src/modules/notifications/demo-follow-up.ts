import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type DemoFollowUpEmail } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { emailDeliveryReady, sendSmtp2go, validOwnerEmail } from './email-queue.js';
import { demoFollowUpVersion, renderDemoFollowUp } from './demo-follow-up-template.js';

export const demoFollowUpState = (job: DemoFollowUpEmail) => ({ id: job.id, destination: job.destination, status: job.optedOutAt ? 'OPTED_OUT' : job.status, attempts: job.attempts, acceptedAt: job.acceptedAt, createdAt: job.createdAt, errorMessage: job.errorMessage });
async function leadEmail(leadId: string) {
  const lead = await prisma.demoSession.findUnique({ where: { id: leadId } });
  if (!lead || lead.kind !== 'EMAIL' || !validOwnerEmail(lead.contact.trim())) throw new AppError(400, 'DEMO_EMAIL_REQUIRED', 'This enquiry does not have a valid email address.');
  return lead.contact.trim().toLowerCase();
}
async function converted(destination: string) {
  return Boolean(await prisma.user.findFirst({ where: { email: { equals: destination, mode: 'insensitive' }, role: 'OWNER' }, select: { id: true } }));
}
export async function prepareDemoFollowUp(leadId: string, adminId: string) {
  return prepareProspectEmail(await leadEmail(leadId), adminId, leadId);
}
export async function prepareProspectEmail(email: string, adminId: string, leadId: string | null = null) {
  const destination = normalizedProspectEmail(email);
  if (await converted(destination)) throw new AppError(409, 'DEMO_CONVERTED', 'This visitor already has an owner account. Use Accounts for their customer emails.');
  const token = randomUUID();
  const message = renderDemoFollowUp({ appUrl: env.APP_URL, unsubscribeUrl: `${new URL(env.APP_URL).origin}/api/demo-email/unsubscribe?token=${token}`, prospect: !leadId });
  const previewHash = createHash('sha256').update(JSON.stringify(message)).digest('hex');
  // Destination identity prevents repeated demo sessions or concurrent previews creating repeat jobs.
  let job: DemoFollowUpEmail;
  try {
    job = await prisma.demoFollowUpEmail.upsert({ where: { destination }, update: {}, create: { destination, demoSessionId: leadId, preparedBy: adminId, templateVersion: demoFollowUpVersion, unsubscribeToken: token, previewHash, ...message } });
  } catch (error) {
    // Prisma can emulate an empty-update upsert. Concurrent previews must reuse the winner.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await prisma.demoFollowUpEmail.findUnique({ where: { destination } });
    if (!existing) throw error;
    job = existing;
  }
  if (job.status === 'PROCESSING' && job.leaseUntil && job.leaseUntil < new Date()) {
    await prisma.demoFollowUpEmail.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseUntil: { lt: new Date() } }, data: { status: 'UNKNOWN', errorMessage: 'The sending result is uncertain. Check SMTP2GO before any further contact.' } });
    job = await prisma.demoFollowUpEmail.findUniqueOrThrow({ where: { id: job.id } });
  }
  return { ...demoFollowUpState(job), ready: emailDeliveryReady(), previewHash: job.previewHash, subject: job.subject, html: job.html, text: job.text };
}
export async function sendDemoFollowUp(leadId: string, input: { id: string; previewHash: string; permissionConfirmed: true }, adminId: string) {
  return sendProspectEmail(await leadEmail(leadId), input, adminId);
}
export async function sendProspectEmail(email: string, input: { id: string; previewHash: string; permissionConfirmed: true }, adminId: string) {
  if (input.permissionConfirmed !== true) throw new AppError(400, 'DEMO_PERMISSION_REQUIRED', 'Confirm this person agreed to receive a FuelNerve introduction.');
  const destination = normalizedProspectEmail(email);
  const job = await prisma.demoFollowUpEmail.findFirst({ where: { id: input.id, destination, previewHash: input.previewHash } });
  if (!job) throw new AppError(409, 'DEMO_PREVIEW_CHANGED', 'Open the email preview again before sending.');
  if (job.optedOutAt) throw new AppError(409, 'DEMO_OPTED_OUT', 'This person opted out of FuelNerve marketing emails.');
  if (await converted(destination)) throw new AppError(409, 'DEMO_CONVERTED', 'This visitor now has an owner account. Use Accounts for their customer emails.');
  if (!emailDeliveryReady()) throw new AppError(409, 'EMAIL_UNAVAILABLE', 'Email sending is paused. Check email configuration in Growth Desk.');
  const claimToken = randomUUID();
  const now = new Date();
  const claimed = await prisma.demoFollowUpEmail.updateMany({ where: { id: job.id, optedOutAt: null, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 3 }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { status: 'PROCESSING', claimToken, leaseUntil: new Date(now.getTime() + 120_000), attempts: { increment: 1 }, sentBy: adminId, permissionConfirmedAt: now, errorMessage: null } });
  if (!claimed.count) throw new AppError(409, 'DEMO_ALREADY_HANDLED', 'This email was already sent, is being processed, or needs a delivery review. Refresh its status.');
  // Recheck opt-out immediately before handing the message to the provider.
  const current = await prisma.demoFollowUpEmail.findUniqueOrThrow({ where: { id: job.id } });
  if (current.optedOutAt) {
    await prisma.demoFollowUpEmail.updateMany({ where: { id: job.id, claimToken }, data: { status: 'SUPPRESSED', claimToken: null, leaseUntil: null } });
    return demoFollowUpState(current);
  }
  const result = await sendSmtp2go({ destination, subject: job.subject, html: job.html, text: job.text, id: job.id });
  await prisma.demoFollowUpEmail.updateMany({ where: { id: job.id, claimToken }, data: {
    status: result.status === 'RETRY' ? 'FAILED' : result.status,
    providerMessageId: result.status === 'ACCEPTED' ? result.providerMessageId : null,
    acceptedAt: result.status === 'ACCEPTED' ? new Date() : null,
    errorMessage: result.status === 'ACCEPTED' ? null : result.error,
    claimToken: null,
    // A rate limit has a cooldown; uncertain sends are never automatically retried.
    leaseUntil: result.status === 'RETRY' ? new Date(Date.now() + 60_000) : null,
  } });
  return demoFollowUpState(await prisma.demoFollowUpEmail.findUniqueOrThrow({ where: { id: job.id } }));
}

function normalizedProspectEmail(email: string) {
  const destination = email.trim().toLowerCase();
  if (destination.length > 254 || !z.string().email().safeParse(destination).success || !validOwnerEmail(destination)) throw new AppError(400, 'MARKETING_EMAIL_REQUIRED', 'Enter one valid email address.');
  return destination;
}
export async function listMarketingEmails() {
  const jobs = await prisma.demoFollowUpEmail.findMany({ where: { demoSessionId: null }, orderBy: { createdAt: 'desc' }, take: 20 });
  return { emails: jobs.map(demoFollowUpState) };
}
