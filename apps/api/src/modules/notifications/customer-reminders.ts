import { indiaDate, indiaParts } from '../../lib/india-time.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { hasActiveIntelligence } from '@fuelledger/shared';
import { queueOwnerWhatsApp } from './delivery-queue.js';
import { customerPaymentReminderBody, readCustomerReminder, recentCustomerReminder, type CustomerReminderScope } from './customer-reminder-facts.js';

export const reminderReason: Record<string, string> = {
  customer_or_station_unavailable: 'This customer or fuel station is unavailable.',
  customer_paused: 'Reminders are paused for this customer.',
  customer_consent_missing: 'Save a WhatsApp number and record the customer’s consent first.',
  customer_balance_disputed: 'This customer has a disputed balance.',
  no_verified_overdue_balance: 'There is no verified overdue balance for this fuel station.',
  recent_customer_reminder: 'A recent reminder or an unconfirmed delivery already exists for this customer.',
  intelligence_required: 'Customer reminders are included with Core + Intelligence.',
};

const customerFields = { id: true, reminderWhatsAppNumber: true, reminderConsentAt: true, reminderConsentById: true, reminderConsentSource: true, reminderPaused: true } as const;

export async function reminderProfile(organizationId: string, customerId: string, stationIds?: string[]) {
  const profile = await prisma.customer.findFirst({ where: { organizationId, id: customerId, active: true }, select: customerFields });
  if (!profile) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'This customer was not found.');
  const history = await prisma.ownerNotificationDelivery.findMany({
    where: { organizationId, customerId, ...(stationIds ? { stationId: { in: stationIds } } : {}) },
    orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, status: true, createdAt: true, suppressionReason: true, failureKind: true, station: { select: { name: true } } },
  });
  return { profile, history };
}

export async function saveReminderProfile(organizationId: string, customerId: string, actorId: string,
  input: { destination: string; consentSource: string; recordConsent: boolean; revokeConsent: boolean; paused: boolean }) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} AND organization_id = ${organizationId} FOR UPDATE`;
    const current = await tx.customer.findFirst({ where: { id: customerId, organizationId, active: true }, select: customerFields });
    if (!current) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'This customer was not found.');
    const destination = input.destination || null;
    const resetConsent = input.revokeConsent || destination !== current.reminderWhatsAppNumber;
    return tx.customer.update({ where: { id: customerId }, select: customerFields, data: {
      reminderWhatsAppNumber: destination, reminderPaused: input.paused,
      ...(input.recordConsent ? { reminderConsentAt: new Date(), reminderConsentById: actorId, reminderConsentSource: input.consentSource }
        : resetConsent ? { reminderConsentAt: null, reminderConsentById: null, reminderConsentSource: null } : {}),
    } });
  });
}

export async function previewCustomerReminder(scope: CustomerReminderScope, now = new Date()) {
  const result = await readCustomerReminder(scope, now);
  if (!result.draft) throw new AppError(409, 'REMINDER_INELIGIBLE', reminderReason[result.reason] ?? 'This reminder is unavailable.');
  if (await prisma.ownerNotificationDelivery.findFirst({ where: recentCustomerReminder(scope, now), select: { id: true } })) {
    throw new AppError(409, 'REMINDER_RECENT', reminderReason.recent_customer_reminder ?? 'A recent reminder already exists.');
  }
  return { ...result.draft, preview: customerPaymentReminderBody(result.draft.message) };
}

function queue(scope: CustomerReminderScope, draft: Pick<Awaited<ReturnType<typeof previewCustomerReminder>>, 'destination' | 'snapshot' | 'message'>, now: Date, actorId?: string) {
  return queueOwnerWhatsApp({
    ...scope, type: 'CUSTOMER_CREDIT_REMINDER', recordType: 'CUSTOMER_LEDGER',
    eventKey: `customer-reminder:${scope.customerId}:${actorId ? 'reviewed' : 'scheduled'}:${indiaDate(now)}:${draft.snapshot}`,
    destination: draft.destination, optedIn: true, message: draft.message,
    guard: { status: actorId ? 'OWNER_REVIEWED' : 'SCHEDULED', snapshot: draft.snapshot, ...(actorId ? { actorId } : { scheduledHour: indiaParts(now).hour }) },
  });
}

export async function approveCustomerReminder(scope: CustomerReminderScope, actorId: string, snapshot: string, now = new Date()) {
  const draft = await previewCustomerReminder(scope, now);
  if (draft.snapshot !== snapshot) throw new AppError(409, 'REMINDER_CHANGED', 'The balance or recipient changed. Review a new reminder before queuing it.');
  return queue(scope, draft, now, actorId);
}

export async function scheduleCustomerReminders(hour: number, now: Date) {
  const organizations = await prisma.organization.findMany({
    where: { notificationSettings: { customerReminderScheduled: true, customerReminderHour: hour } },
    select: { id: true, intelligenceEnabledAt: true, intelligenceExpiresAt: true },
  });
  let queued = 0;
  for (const organization of organizations.filter(item => hasActiveIntelligence(item, now))) {
    const candidates = await prisma.customerLedgerEntry.findMany({
      where: { organizationId: organization.id, amount: { gt: 0 }, dueDate: { lt: now }, occurredAt: { lte: now },
        station: { organizationId: organization.id, active: true }, customer: { organizationId: organization.id, active: true,
          reminderPaused: false, reminderConsentAt: { not: null }, reminderWhatsAppNumber: { not: null } } },
      distinct: ['customerId', 'stationId'], orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      select: { customerId: true, stationId: true },
    });
    const considered = new Set<string>();
    for (const candidate of candidates) {
      if (considered.has(candidate.customerId)) continue;
      const scope = { organizationId: organization.id, ...candidate };
      const result = await readCustomerReminder(scope, now);
      if (!result.draft || result.scheduledHour !== hour) continue;
      considered.add(candidate.customerId);
      if (await prisma.ownerNotificationDelivery.findFirst({ where: recentCustomerReminder(scope, now), select: { id: true } })) continue;
      const delivery = await queue(scope, result.draft, now);
      if (delivery.status === 'PENDING') queued++;
    }
  }
  return queued;
}
