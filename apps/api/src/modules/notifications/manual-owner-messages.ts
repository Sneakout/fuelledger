import { z } from 'zod';
import { allowsOwnerWhatsApp, hasActiveIntelligence } from '@fuelledger/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { indiaDate } from '../../lib/india-time.js';
import { coreDailyMessage, money, receiptMessage, shiftMessage, stockAlertMessage, stockLevel } from './agent-messages.js';
import { readCustomerCreditFacts, readDailyOperatingFacts, readReceiptMessageFacts, readShiftMessageFacts, readTankAlertFacts } from './message-facts.js';

export const manualMessageInput = z.object({
  stationId: z.string().min(1),
  type: z.enum(['OWNER_WELCOME', 'DAILY_SUMMARY', 'LOW_STOCK', 'SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY', 'OVERDUE_CUSTOMER']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceId: z.string().optional(),
});
export async function manualMessageContext(organizationId: string) {
  const stations = await prisma.station.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return { stations, today: indiaDate(new Date()) };
}
// Read-only: these messages never enter the provider queue or change delivery status.
export async function prepareManualOwnerMessage(organizationId: string, input: z.infer<typeof manualMessageInput>, now = new Date()) {
  const station = await prisma.station.findFirst({ where: { id: input.stationId, organizationId, active: true }, select: { id: true, name: true } });
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'Choose an active fuel station belonging to this account.');
  if (input.date > indiaDate(now) || Number.isNaN(Date.parse(input.date)) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date) throw new AppError(400, 'INVALID_DATE', 'Choose a valid report date through today.');
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, include: { notificationSettings: true } });
  const owner = await prisma.user.findFirst({ where: { organizationId, role: 'OWNER', active: true, loginEnabled: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { name: true, email: true } });
  if (!organization || !owner) throw new AppError(404, 'OWNER_NOT_FOUND', 'No active owner login is available for this account.');
  const settings = organization.notificationSettings;
  const destination = settings?.whatsappNumber;
  if (!destination || !/^[1-9]\d{7,14}$/.test(destination) || !settings.whatsappOptedIn) throw new AppError(409, 'CONSENT_REQUIRED', 'The owner must save their WhatsApp number and consent in Settings → WhatsApp alerts first.');
  const scope = { organizationId, stationId: station.id };
  let body: string | null = null;
  const warnings: string[] = [];
  if (input.type === 'OWNER_WELCOME') {
    body = `*Welcome to FuelNerve, ${owner.name}!*\n\nYour account for *${station.name}* is ready.\n\nSign in: ${env.APP_URL}/login\nLogin email: ${owner.email}\n\nUse your account password to sign in.\n\nStart with your fuel station setup, then shifts, sales and tank stock. Choose your updates in *Settings → WhatsApp alerts*.\n\nReply here if you need help getting started.`;
    warnings.push('Passwords are never included. If this owner needs new credentials, arrange a password change separately.');
  } else {
    const recordType = input.type === 'DAILY_SUMMARY' ? 'CORE_DAILY_SUMMARY' : input.type;
    if (!allowsOwnerWhatsApp(input.type, recordType, hasActiveIntelligence(organization, now))) throw new AppError(403, 'PLAN_REQUIRED', 'Core includes the daily summary. This message requires active Intelligence access.');
    const enabled = input.type === 'DAILY_SUMMARY' ? settings.dailySummaryEnabled : input.type === 'LOW_STOCK' ? settings.lowStockEnabled : input.type === 'SHIFT_CLOSED_SUMMARY' ? settings.shiftSummaryEnabled : input.type === 'PURCHASE_RECEIPT_SUMMARY' ? settings.receiptSummaryEnabled : settings.overdueCustomerEnabled;
    if (!enabled) throw new AppError(409, 'CATEGORY_DISABLED', 'The owner has turned off this message category.');
    if (input.type === 'DAILY_SUMMARY') {
      const facts = await readDailyOperatingFacts(scope, input.date, now);
      body = coreDailyMessage(facts, input.date, env.APP_URL).replace('Collections (reconciled shifts):', 'Collections (reconciled shifts + counter sales):');
      if (facts.completeness !== 'COMPLETE') warnings.push('Some shifts or collections are incomplete. Review the provisional figures before sharing.');
      warnings.push('Sales and collections describe the selected date. Tank book stock is checked at the report cutoff; historical imports are not live cash collections.');
    } else if (input.type === 'LOW_STOCK') {
      const tanks = await prisma.tank.findMany({ where: { status: 'ACTIVE', product: { category: 'FUEL' }, configuration: { active: true, station: { id: station.id, organizationId, active: true } } }, select: { id: true }, orderBy: { id: 'asc' } });
      const messages: string[] = [];
      for (const tank of tanks) {
        const facts = await readTankAlertFacts(scope, tank.id, now);
        if (facts?.completeness === 'COMPLETE' && stockLevel(Number(facts.bookStock), Number(facts.tank.workingCapacity), settings.lowStockPercent) !== 'HEALTHY') messages.push(stockAlertMessage(facts, settings.lowStockPercent, env.APP_URL));
      }
      body = messages.join('\n\n') || null;
    } else if (input.type === 'SHIFT_CLOSED_SUMMARY') {
      const shift = await prisma.shift.findFirst({ where: { ...(input.sourceId ? { id: input.sourceId } : {}), stationId: station.id, station: { organizationId }, closedAt: { not: null, lte: now }, reconciliation: { isNot: null } }, orderBy: [{ closedAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      const facts = shift && await readShiftMessageFacts(scope, shift.id, now);
      body = facts && shiftMessage(facts) || null;
      if (body && facts) body += `\nClosed: ${facts.closedAt!.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\nReview: ${env.APP_URL}/reconciliation?shiftId=${facts.shiftId}`;
    } else if (input.type === 'PURCHASE_RECEIPT_SUMMARY') {
      const receipt = await prisma.purchaseReceipt.findFirst({ where: { ...(input.sourceId ? { id: input.sourceId } : {}), organizationId, stationId: station.id, receivedAt: { lte: now } }, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      const facts = receipt && await readReceiptMessageFacts(scope, receipt.id, now);
      body = facts && receiptMessage(facts, env.APP_URL) || null;
    } else {
      const customers = (await readCustomerCreditFacts(scope, now)).filter(row => row.outstanding > 0);
      if (customers.length) body = [`FuelNerve Credit Agent · ${station.name}`, `Customer balances checked ${indiaDate(now)}`, ...customers.map(row => `${row.customerName}: ${money(row.outstanding)} outstanding · ${money(row.overdueAmount)} overdue${row.oldestDaysOverdue !== null ? ` · oldest ${row.oldestDaysOverdue} days overdue` : row.completeness === 'INCOMPLETE' ? ' · due date needs review' : ' · none overdue'}${row.hasDisputedBalance ? ' · disputed balance: review before follow-up' : ''}`), `Review: ${env.APP_URL}/customers`].join('\n\n');
    }
  }
  if (!body) throw new AppError(409, 'NO_ELIGIBLE_RECORDS', 'No qualifying records are available for this message at this fuel station. No message was created.');
  return { body, destination, ownerName: owner.name, stationName: station.name, checkedAt: now.toISOString(), warnings };
}
