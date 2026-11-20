import { createHash, randomUUID } from 'node:crypto';
import { hasActiveIntelligence, allowsOwnerWhatsApp } from '@fuelledger/shared';
import { Prisma, type OwnerEmailDelivery, type OwnerNotificationType, type OwnerNotificationSettings } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { indiaDate } from '../../lib/india-time.js';
import { emailDesign, renderOwnerEmail } from './email-template.js';
import { coreDailyMessage, stockAlertMessage, receiptMessage, shiftMessage, isRecentReceipt } from './agent-messages.js';
import { readDailyOperatingFacts, readReceiptMessageFacts, readShiftMessageFacts, readTankAlertFacts } from './message-facts.js';
import { creditDeliverySnapshot } from './delivery-queue.js';

type Guard = { sourceId?: string | undefined; status?: string | undefined; quantity?: number | undefined; snapshot?: string | undefined; version?: string | undefined; date?: string; ownerName?: string; stationName?: string };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const validOwnerEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/\.(local|invalid|test)$/i.test(value);
export function emailCategoryEnabled(settings: OwnerNotificationSettings, type: OwnerNotificationType) {
  return (type === 'OWNER_WELCOME' || (type === 'DAILY_SUMMARY' ? settings.dailySummaryEnabled
    : type === 'LOW_STOCK' ? settings.lowStockEnabled : type === 'SHIFT_CLOSED_SUMMARY' ? settings.shiftSummaryEnabled
      : type === 'PURCHASE_RECEIPT_SUMMARY' ? settings.receiptSummaryEnabled : type === 'OVERDUE_CUSTOMER' ? settings.overdueCustomerEnabled : false));
}
export const emailDeliveryReady = (organizationId: string) => Boolean(env.EMAIL_DELIVERY_ENABLED && env.SMTP2GO_API_KEY && env.EMAIL_ROLLOUT_ORGANIZATION_IDS.split(',').map(id => id.trim()).includes(organizationId));
const owners = (organizationId: string, db: Prisma.TransactionClient) => db.user.findMany({ where: { organizationId, role: 'OWNER', active: true, loginEnabled: true, ownerEmailPreference: { is: { organizationId, enabled: true } } }, select: { id: true, email: true, name: true } });
export async function queueOwnerEmail(input: { organizationId: string; stationId?: string | undefined; type: OwnerNotificationType; eventKey: string; recordType: string; message: string; guard: Guard }, db: Prisma.TransactionClient = prisma) {
  if (!emailDesign[input.type]) return;
  const settings = await db.ownerNotificationSettings.findUnique({ where: { organizationId: input.organizationId } });
  if (!settings || !emailCategoryEnabled(settings, input.type)) return;
  for (const owner of await owners(input.organizationId, db)) {
    if (!validOwnerEmail(owner.email)) continue;
    const destination = owner.email.trim().toLowerCase();
    const dedupeKey = `email:${digest([input.organizationId, input.stationId ?? null, input.type, input.eventKey, owner.id, destination])}`;
    await db.ownerEmailDelivery.createMany({ skipDuplicates: true, data: {
      organizationId: input.organizationId, stationId: input.stationId ?? null, ownerId: owner.id, destination,
      type: input.type, eventKey: input.eventKey, dedupeKey, recordType: input.recordType, message: input.message,
      guard: { ...input.guard, ownerName: owner.name } as Prisma.InputJsonValue,
    } });
  }
}
export async function queueEmailWelcome(organizationId: string, db: Prisma.TransactionClient = prisma) {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  if (!organization) return;
  await queueOwnerEmail({ organizationId, type: 'OWNER_WELCOME', eventKey: `owner-email-welcome:${organizationId}`, recordType: 'OWNER_WELCOME',
    message: `Your account for ${organization.name} is ready.\nReview your fuel station setup and get started with shifts, sales and tank stock.\nChoose the updates you receive in Settings → Email & WhatsApp alerts.`, guard: { stationName: organization.name } }, db);
}

export async function emailFactsStillCurrent(job: OwnerEmailDelivery, now: Date) {
  const guard = job.guard as Guard;
  if (job.type === 'OWNER_WELCOME') return true;
  if (indiaDate(job.createdAt) !== indiaDate(now)) return false;
  if (job.type === 'OVERDUE_CUSTOMER') return Boolean(guard.snapshot && (await creditDeliverySnapshot(job.organizationId, now)).snapshot === guard.snapshot);
  if (job.type === 'DAILY_SUMMARY') return coreDailyMessage(await readDailyOperatingFacts({ organizationId: job.organizationId }, guard.date ?? indiaDate(job.createdAt), now), guard.date ?? indiaDate(job.createdAt), env.APP_URL) === job.message;
  if (!job.stationId || !guard.sourceId) return false;
  const scope = { organizationId: job.organizationId, stationId: job.stationId };
  if (job.type === 'SHIFT_CLOSED_SUMMARY') {
    const facts = await readShiftMessageFacts(scope, guard.sourceId, now);
    return Boolean(facts && facts.collections?.reconciliationId === guard.version && [shiftMessage(facts), shiftMessage(facts, true)].includes(job.message.split('\n\nReview: ')[0] ?? ''));
  }
  if (job.type === 'PURCHASE_RECEIPT_SUMMARY') {
    const facts = await readReceiptMessageFacts(scope, guard.sourceId, now);
    return Boolean(facts && isRecentReceipt(facts.receivedAt, now) && receiptMessage(facts, env.APP_URL) === job.message);
  }
  if (job.type === 'LOW_STOCK') {
    const [facts, settings] = await Promise.all([readTankAlertFacts(scope, guard.sourceId, now), prisma.ownerNotificationSettings.findUnique({ where: { organizationId: job.organizationId } })]);
    return Boolean(facts && settings && facts.completeness === 'COMPLETE' && facts.bookStock.toNumber() === guard.quantity && stockAlertMessage(facts, settings.lowStockPercent, env.APP_URL) === job.message);
  }
  return false;
}

// A rejected rate-limited request is retryable. A timeout/5xx may already have sent mail.
export type EmailSendResult = { status: 'ACCEPTED'; providerMessageId: string } | { status: 'FAILED' | 'UNKNOWN' | 'RETRY'; error: string };
export async function sendSmtp2go(input: { destination: string; subject: string; html: string; text: string; id: string }): Promise<EmailSendResult> {
  try {
    const response = await fetch('https://api.smtp2go.com/v3/email/send', { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', 'X-Smtp2go-Api-Key': env.SMTP2GO_API_KEY ?? '' },
      body: JSON.stringify({ sender: `FuelNerve <${env.EMAIL_FROM}>`, to: [input.destination], subject: input.subject, html_body: input.html, text_body: input.text,
        custom_headers: [{ header: 'Reply-To', value: env.EMAIL_FROM }, { header: 'X-FuelNerve-Delivery', value: input.id }] }),
    });
    if (response.status === 429) return { status: 'RETRY', error: 'Email service rate limit. Waiting before retry.' };
    if (response.status >= 500) return { status: 'UNKNOWN', error: 'Email service outcome is uncertain. Check SMTP2GO before resending.' };
    const body = await response.json() as { data?: { succeeded?: number; failed?: number; email_id?: string } };
    if (response.ok && body.data?.succeeded === 1 && body.data.failed === 0 && body.data.email_id) return { status: 'ACCEPTED', providerMessageId: body.data.email_id };
    if (!response.ok && response.status >= 400 && response.status < 500) return { status: 'FAILED', error: 'Email service rejected the request. Check sender verification, credentials and recipient in SMTP2GO.' };
    return { status: 'UNKNOWN', error: 'Email service did not confirm a single accepted message. Check SMTP2GO before resending.' };
  } catch { return { status: 'UNKNOWN', error: 'Connection interrupted. Delivery may have been accepted; automatic retry is held.' }; }
}

export async function drainEmailQueue(options: { organizationId?: string; deliveryId?: string; limit?: number } = {}) {
  const now = new Date();
  const scope = { ...(options.organizationId ? { organizationId: options.organizationId } : {}), ...(options.deliveryId ? { id: options.deliveryId } : {}) };
  // An expired lease may have crossed the provider boundary; never resend automatically.
  await prisma.ownerEmailDelivery.updateMany({ where: { ...scope, status: 'PROCESSING', leaseUntil: { lt: now } }, data: { status: 'UNKNOWN', claimToken: null, leaseUntil: null, errorMessage: 'Worker interrupted. Check SMTP2GO before resending.' } });
  const enabledOrganizations = env.EMAIL_ROLLOUT_ORGANIZATION_IDS.split(',').map(id => id.trim()).filter(Boolean);
  if (!env.EMAIL_DELIVERY_ENABLED || !env.SMTP2GO_API_KEY || !enabledOrganizations.length || (options.organizationId && !enabledOrganizations.includes(options.organizationId))) return { checked: 0, accepted: 0 };
  // Paused accounts must not occupy the bounded batch and starve enabled accounts.
  const jobs = await prisma.ownerEmailDelivery.findMany({ where: { ...scope, organizationId: options.organizationId ?? { in: enabledOrganizations }, status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: Math.max(1, Math.min(options.limit ?? 4, 4)) });
  let accepted = 0;
  for (const job of jobs) {
    if (!emailDeliveryReady(job.organizationId)) continue;
    const token = randomUUID();
    const claimed = await prisma.ownerEmailDelivery.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'PROCESSING', claimToken: token, leaseUntil: new Date(Date.now() + 120_000) } });
    if (!claimed.count) continue;
    const finish = (data: Prisma.OwnerEmailDeliveryUpdateManyMutationInput) => prisma.ownerEmailDelivery.updateMany({ where: { id: job.id, status: 'PROCESSING', claimToken: token }, data: { ...data, claimToken: null, leaseUntil: null } });
    try {
      const [owner, organization, settings, station, preference] = await Promise.all([
        prisma.user.findFirst({ where: { id: job.ownerId, organizationId: job.organizationId, role: 'OWNER', active: true, loginEnabled: true }, select: { email: true, name: true } }),
        prisma.organization.findUnique({ where: { id: job.organizationId } }),
        prisma.ownerNotificationSettings.findUnique({ where: { organizationId: job.organizationId } }),
        job.stationId ? prisma.station.findFirst({ where: { id: job.stationId, organizationId: job.organizationId, active: true }, select: { name: true } }) : Promise.resolve(null),
        prisma.ownerEmailPreference.findFirst({ where: { ownerId: job.ownerId, organizationId: job.organizationId, enabled: true } }),
      ]);
      const fresh = new Date();
      const planActive = organization && (organization.lifetimeAccessPaidAt || (organization.subscriptionActivatedAt && (!organization.subscriptionExpiresAt || organization.subscriptionExpiresAt > fresh)));
      const reason = !owner || owner.email.trim().toLowerCase() !== job.destination || !validOwnerEmail(job.destination) ? 'recipient_changed_or_ineligible'
        : !preference || !settings || !emailCategoryEnabled(settings, job.type) ? 'email_or_category_disabled'
        : !organization || (job.stationId && !station) ? 'fuel_station_unavailable'
        : job.type !== 'OWNER_WELCOME' && !planActive ? 'subscription_inactive'
        : job.type !== 'OWNER_WELCOME' && !allowsOwnerWhatsApp(job.type, job.recordType, hasActiveIntelligence(organization)) ? 'category_not_in_plan'
        : fresh.getTime() - job.createdAt.getTime() > 86_400_000 ? 'message_expired'
        : !(await emailFactsStillCurrent(job, fresh)) ? 'source_changed' : null;
      if (reason) { await finish({ status: 'SUPPRESSED', suppressionReason: reason }); continue; }
      if (!emailDeliveryReady(job.organizationId)) { await finish({ status: 'PENDING' }); continue; }
      const mail = renderOwnerEmail({ type: job.type, message: job.message, ownerName: owner!.name, stationName: station?.name ?? organization!.name, date: indiaDate(job.createdAt), appUrl: env.APP_URL, sourceId: (job.guard as Guard).sourceId });
      await prisma.ownerEmailDelivery.updateMany({ where: { id: job.id, claimToken: token, status: 'PROCESSING' }, data: { attempts: { increment: 1 } } });
      const result = await sendSmtp2go({ ...mail, destination: job.destination, id: job.id });
      if (result.status === 'ACCEPTED') { await finish({ status: 'ACCEPTED', providerMessageId: result.providerMessageId, acceptedAt: new Date(), errorMessage: null }); accepted++; }
      else if (result.status === 'RETRY' && job.attempts < 3) await finish({ status: 'PENDING', errorMessage: result.error, nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** job.attempts) });
      else await finish({ status: result.status === 'RETRY' ? 'FAILED' : result.status, errorMessage: result.error });
    } catch { await finish({ status: 'UNKNOWN', errorMessage: 'Processing interrupted. Review source records and SMTP2GO before resending.' }); }
  }
  return { checked: jobs.length, accepted };
}
