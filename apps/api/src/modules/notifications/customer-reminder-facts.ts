import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { hasActiveIntelligence } from '@fuelledger/shared';
import { prisma } from '../../lib/prisma.js';
import { indiaDate } from '../../lib/india-time.js';
import { customerReminderDraft } from './agent-messages.js';
import { readCustomerCreditFacts } from './message-facts.js';

export const customerPaymentReminderBody = (details: string) =>
  `Payment reminder for your fuel account. Our records show an overdue balance. ${details} If you have already paid or believe the balance is incorrect, please contact your fuel station.`;

export type CustomerReminderScope = { organizationId: string; stationId: string; customerId: string };

export function recentCustomerReminder(scope: CustomerReminderScope, now: Date, exceptId?: string): Prisma.OwnerNotificationDeliveryWhereInput {
  return {
    organizationId: scope.organizationId, customerId: scope.customerId, type: 'CUSTOMER_CREDIT_REMINDER',
    ...(exceptId ? { id: { not: exceptId } } : {}),
    OR: [
      { failureKind: 'UNCERTAIN' },
      { dispatchStartedAt: { gt: new Date(now.getTime() - 7 * 86_400_000) },
        status: { in: ['PROCESSING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ'] } },
    ],
  };
}

export async function readCustomerReminder(scope: CustomerReminderScope, now = new Date(), db: Prisma.TransactionClient = prisma) {
  const { organizationId, stationId, customerId } = scope;
  const [organization, station, customer, settings, factsList] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId } }),
    db.station.findFirst({ where: { id: stationId, organizationId, active: true }, select: { name: true } }),
    db.customer.findFirst({ where: { id: customerId, organizationId, active: true } }),
    db.ownerNotificationSettings.findUnique({ where: { organizationId } }),
    // Payments can be recorded at a different station. Allocate them across the full account first.
    readCustomerCreditFacts({ organizationId }, now, customerId, db),
  ]);
  if (!organization || !station || !customer) return { reason: 'customer_or_station_unavailable' } as const;
  if (!hasActiveIntelligence(organization, now)) return { reason: 'intelligence_required' } as const;
  const destination = customer.reminderWhatsAppNumber;
  if (customer.reminderPaused) return { reason: 'customer_paused' } as const;
  if (!destination || !/^[1-9]\d{7,14}$/.test(destination) || !customer.reminderConsentAt || !customer.reminderConsentSource) {
    return { reason: 'customer_consent_missing' } as const;
  }
  const facts = factsList[0];
  if (facts?.hasDisputedBalance) return { reason: 'customer_balance_disputed' } as const;
  const unpaid = facts?.unpaid.filter(entry => entry.stationId === stationId) ?? [];
  const overdueAmount = unpaid.reduce((total, entry) => total + ((entry.daysOverdue ?? 0) > 0 ? Math.round(entry.remaining * 100) : 0), 0) / 100;
  const draft = facts && customerReminderDraft({ ...facts, stationId, unpaid, overdueAmount }, station.name);
  if (!draft || facts.outstanding <= 0) return { reason: 'no_verified_overdue_balance' } as const;
  const message = `${station.name} · ${customer.name} · ${draft.overdueAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} overdue as of ${indiaDate(now)} · Earliest unpaid due date ${draft.dueDate}.`;
  const snapshot = createHash('sha256').update(JSON.stringify([
    organizationId, stationId, customerId, destination, customer.reminderConsentAt, customer.updatedAt, facts.outstanding,
    [...facts.ledgerEntryIds].sort(), message,
  ])).digest('hex');
  return { draft: { ...draft, message, destination, snapshot }, scheduledHour: settings?.customerReminderScheduled ? settings.customerReminderHour : null } as const;
}
