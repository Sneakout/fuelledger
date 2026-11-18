import { allowsOwnerWhatsApp, hasActiveIntelligence } from '@fuelledger/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { indiaDate } from '../../lib/india-time.js';
import { AppError } from '../../lib/errors.js';
import { isRecentReceipt, receiptMessage, shiftMessage, stockAlertMessage, stockLevel } from './agent-messages.js';
import { queueOwnerWhatsApp } from './delivery-queue.js';
import { readReceiptMessageFacts, readShiftMessageFacts, readTankAlertFacts } from './message-facts.js';
import { getSettings, notifyDailySummary, notifyOverdueCustomers, prepareNotificationPreviews } from './service.js';

export const operationalPreviewTypes = ['LOW_STOCK', 'SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY', 'OVERDUE_CUSTOMER', 'DAILY_SUMMARY'] as const;
export type OperationalPreviewType = typeof operationalPreviewTypes[number];
export async function prepareOperationalPreview(organizationId: string, type: OperationalPreviewType, now = new Date()) {
  const [settings, organization] = await Promise.all([getSettings(organizationId), prisma.organization.findUnique({ where: { id: organizationId } })]);
  if (!settings.whatsappOptedIn || !settings.whatsappNumber) throw new AppError(400, 'WHATSAPP_OPT_IN_REQUIRED', 'The owner must save a WhatsApp number and consent first.');
  const recordType = type === 'DAILY_SUMMARY' ? 'CORE_DAILY_SUMMARY' : type;
  if (!organization || !allowsOwnerWhatsApp(type, recordType, hasActiveIntelligence(organization, now))) throw new AppError(403, 'PLAN_REQUIRED', 'Choose a message included in this owner’s plan. Core supports the daily operating summary; Intelligence supports stock, shift, receipt and credit updates.');
  const enabled = type === 'LOW_STOCK' ? settings.lowStockEnabled : type === 'SHIFT_CLOSED_SUMMARY' ? settings.shiftSummaryEnabled : type === 'PURCHASE_RECEIPT_SUMMARY' ? settings.receiptSummaryEnabled : type === 'OVERDUE_CUSTOMER' ? settings.overdueCustomerEnabled : settings.dailySummaryEnabled;
  if (!enabled) throw new AppError(409, 'CATEGORY_DISABLED', 'The owner has turned off this message category. Choose another category or ask the owner to enable it.');
  const date = indiaDate(now);
  if (type === 'DAILY_SUMMARY') return prepareNotificationPreviews(() => notifyDailySummary(organizationId, date, now));
  if (type === 'OVERDUE_CUSTOMER') return prepareNotificationPreviews(() => notifyOverdueCustomers(organizationId, date, now));
  const queue = async (stationId: string, sourceId: string, message: string, status: string, version?: string) => {
    const row = await queueOwnerWhatsApp({ organizationId, stationId, type, destination: settings.whatsappNumber, optedIn: true, recordType: type,
      eventKey: `operational-preview:${organizationId}:${type}:${sourceId}:${version ?? date}`,
      message, guard: { sourceId, status, ...(version ? { version } : {}) } });
    return row.status === 'SUPPRESSED' ? { status: 'SKIPPED' as const, reason: row.suppressionReason ?? 'suppressed' } : { status: 'QUEUED' as const, id: row.id };
  };
  if (type === 'LOW_STOCK') {
    const tanks = await prisma.tank.findMany({ where: { status: 'ACTIVE', product: { category: 'FUEL' }, configuration: { active: true, station: { organizationId, active: true } } }, select: { id: true, configuration: { select: { stationId: true } } }, orderBy: { id: 'asc' } });
    for (const tank of tanks) {
      const stationId = tank.configuration.stationId;
      const facts = await readTankAlertFacts({ organizationId, stationId }, tank.id, now);
      if (!facts || facts.completeness !== 'COMPLETE') continue;
      const level = stockLevel(Number(facts.bookStock), Number(facts.tank.workingCapacity), settings.lowStockPercent);
      if (level !== 'HEALTHY') return queue(stationId, tank.id, stockAlertMessage(facts, settings.lowStockPercent, env.APP_URL), level);
    }
  } else if (type === 'PURCHASE_RECEIPT_SUMMARY') {
    const receipt = await prisma.purchaseReceipt.findFirst({ where: { organizationId, receivedAt: { gte: new Date(now.getTime() - 86_400_000), lte: now }, station: { active: true, organizationId } }, orderBy: { receivedAt: 'desc' }, select: { id: true, stationId: true } });
    if (receipt) {
      const facts = await readReceiptMessageFacts({ organizationId, stationId: receipt.stationId }, receipt.id, now);
      const message = facts && isRecentReceipt(facts.receivedAt, now) ? receiptMessage(facts, env.APP_URL) : null;
      if (message) return queue(receipt.stationId, receipt.id, message, 'RECEIVED');
    }
  } else {
    const shift = await prisma.shift.findFirst({ where: { station: { organizationId, active: true }, closedAt: { gte: new Date(now.getTime() - 86_400_000), lte: now }, reconciliation: { isNot: null } }, orderBy: { closedAt: 'desc' }, select: { id: true, stationId: true } });
    if (shift) {
      const facts = await readShiftMessageFacts({ organizationId, stationId: shift.stationId }, shift.id, now);
      const message = facts && shiftMessage(facts);
      if (message && facts?.collections) return queue(shift.stationId, shift.id, message, 'RECONCILED', facts.collections.reconciliationId);
    }
  }
  return { status: 'SKIPPED' as const, reason: type === 'LOW_STOCK' ? 'No tank with verified low stock is available. Choose a different message; no stock values were changed.' : type === 'PURCHASE_RECEIPT_SUMMARY' ? 'No eligible receipt from the last 24 hours is available.' : 'No complete reconciled shift closed in the last 24 hours is available.' };
}
