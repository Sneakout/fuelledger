import { randomUUID } from 'node:crypto';
import { hasActiveIntelligence } from '@fuelledger/shared';
import type { NerveReviewJob } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { bookStockAt } from '../../lib/stock.js';
import { receiptMessage, shiftMessage, stockLevel, stockAlertMessage, isRecentReceipt } from './agent-messages.js';
import { readReceiptMessageFacts, readShiftMessageFacts, readTankAlertFacts } from './message-facts.js';
import { getSettings, sendOwnerNotification, prepareEmailNotifications } from './service.js';

const retryDelay = 15 * 60_000;
const maximumAge = 24 * 60 * 60_000;
const stockKey = (tankId: string, episodeId: string, level: string) => `stock-episode:${tankId}:${episodeId}:${level}`;

type DispatchOptions = { channel?: 'EMAIL'; organizationIds?: string[] };
export async function drainAgentMessages(options: DispatchOptions = {}) {
  return options.channel === 'EMAIL' ? prepareEmailNotifications(() => dispatchAgentMessages(options)) : dispatchAgentMessages(options);
}
async function dispatchAgentMessages(options: DispatchOptions) {
  const email = options.channel === 'EMAIL';
  if (email && !options.organizationIds?.length) return { handled: 0, deferred: 0 };
  const handledField = email ? 'emailHandledAt' : 'notificationHandledAt';
  const nextField = email ? 'emailNextAt' : 'notificationNextAt';
  const now = new Date();
  const jobs = await prisma.nerveReviewJob.findMany({
    where: { ...(options.organizationIds ? { organizationId: { in: options.organizationIds } } : {}), [handledField]: null, [nextField]: { lte: now }, OR: [
      { agentKey: 'reconciliation-review', eventType: 'SHIFT_RECONCILED' },
      { agentKey: 'purchase-check', eventType: 'RECEIPT_RECORDED' },
      { agentKey: 'inventory-watch', eventType: { in: ['SHIFT_CLOSED', 'RECEIPT_RECORDED', 'SALE_RECORDED', 'STOCK_ADJUSTED', 'INVOICE_CHANGED', 'DAILY_REVIEW'] } },
    ] },
    orderBy: [{ [nextField]: 'asc' }, { id: 'asc' }],
    take: 4,
  });
  const totals = { handled: 0, deferred: 0 };
  for (const job of jobs) {
    if (Date.now() - now.getTime() > 60_000) break;
    // Delay the job before work so overlapping ticks cannot process it together.
    const claim = await prisma.nerveReviewJob.updateMany({
      where: { id: job.id, [handledField]: null, [nextField]: job[nextField] },
      data: { [nextField]: new Date(Date.now() + retryDelay) },
    });
    if (!claim.count) continue;
    try {
      const station = await prisma.station.findFirst({
        where: { id: job.stationId, organizationId: job.organizationId, active: true },
        select: { organization: { select: { intelligenceEnabledAt: true, intelligenceExpiresAt: true } } },
      });
      const expired = Date.now() - job.createdAt.getTime() >= maximumAge;
      const done = !station || !hasActiveIntelligence(station.organization)
        || (email && (expired || now.getTime() - job.occurredAt.getTime() >= maximumAge || job.occurredAt > now))
        || (expired && job.agentKey !== 'inventory-watch') || await processMessage(job, email);
      if (done) {
        await prisma.nerveReviewJob.update({ where: { id: job.id }, data: { [handledField]: new Date() } });
        totals.handled++;
      } else totals.deferred++;
    } catch (error) {
      totals.deferred++;
      logger.warn({ jobId: job.id, errorName: error instanceof Error ? error.name : 'MessageError' }, 'Agent message review deferred');
    }
  }
  return totals;
}

async function processMessage(job: NerveReviewJob, email = false) {
  const scope = { organizationId: job.organizationId, stationId: job.stationId };
  if (job.eventType === 'SHIFT_RECONCILED') {
    const facts = await readShiftMessageFacts(scope, job.resourceId);
    if (!facts) return true;
    if (facts.completeness !== 'COMPLETE' || !facts.collections || !facts.closedAt) return false;
    const path = '/reconciliation';
    const version = facts.collections.reconciliationId;
    const dedupeKey = `shift-summary:${facts.shiftId}:${version}`;
    const previousWhere = {
      ...scope, type: 'SHIFT_CLOSED_SUMMARY' as const, eventKey: { startsWith: `shift-summary:${facts.shiftId}:`, not: dedupeKey },
    };
    const previous = email ? await prisma.ownerEmailDelivery.findFirst({ where: { ...previousWhere, status: 'ACCEPTED' }, select: { id: true } }) : await prisma.ownerNotificationDelivery.findFirst({
      where: { ...scope, type: 'SHIFT_CLOSED_SUMMARY', status: { in: ['SENT', 'ACCEPTED', 'DELIVERED', 'READ'] }, OR: [
        { eventKey: { startsWith: `shift-summary:${facts.shiftId}:`, not: dedupeKey } },
        { eventKey: null, dedupeKey: { startsWith: `shift-summary:${facts.shiftId}:`, not: dedupeKey } },
      ] },
      select: { id: true },
    });
    const message = shiftMessage(facts, Boolean(previous));
    const result = await sendOwnerNotification({
      ...scope, type: 'SHIFT_CLOSED_SUMMARY', dedupeKey, version,
      evidenceSourceType: 'SHIFT', evidenceSourceId: facts.shiftId,
      stillRelevant: async () => {
        const current = await readShiftMessageFacts(scope, job.resourceId);
        return Boolean(current && current.collections?.reconciliationId === version && shiftMessage(current, Boolean(previous)) === message);
      },
      packet: {
        subjectName: `Shift #${facts.shiftNumber}`, recordType: 'SHIFT_CLOSURE', eventDate: facts.closedAt.toISOString(),
        product: null, amount: { value: facts.collections.actual.toNumber(), currency: 'INR' }, quantity: null, dueDate: null,
        status: 'RECONCILED', daysOverdueOrWaiting: null, station: facts.station,
        evidence: [{ label: 'Open shift reconciliation', path, recordType: 'SHIFT', recordId: facts.shiftId }],
        availableActions: ['VIEW_RECORD', 'ACKNOWLEDGE'],
      },
      message: () => `${message}\n\nReview: ${env.APP_URL}${path}?shiftId=${encodeURIComponent(facts.shiftId)}`,
    });
    return result.reason !== 'facts_changed';
  }
  if (job.agentKey === 'purchase-check') {
    const facts = await readReceiptMessageFacts(scope, job.resourceId);
    if (!facts) return false;
    if (!isRecentReceipt(facts.receivedAt, new Date())) return true;
    const message = receiptMessage(facts);
    if (!message) return false;
    const invoice = facts.invoice;
    const result = await sendOwnerNotification({
      ...scope, type: 'PURCHASE_RECEIPT_SUMMARY', dedupeKey: `purchase-receipt:${facts.receiptId}`,
      evidenceSourceType: 'PURCHASE_RECEIPT', evidenceSourceId: facts.receiptId,
      stillRelevant: async () => {
        const current = await readReceiptMessageFacts(scope, job.resourceId);
        return Boolean(current && receiptMessage(current) === message);
      },
      packet: {
        subjectName: invoice ? `Invoice ${invoice.number}`.slice(0, 160) : 'Stock receipt', recordType: 'PURCHASE_RECEIPT', eventDate: facts.receivedAt.toISOString(),
        product: null, quantity: null, amount: invoice ? { value: invoice.totalAmount.toNumber(), currency: 'INR' } : null,
        dueDate: invoice && invoice.outstanding.gt(0) ? invoice.dueDate.toISOString() : null,
        status: invoice ? invoice.outstanding.lte(0) ? 'PAID' : 'OUTSTANDING' : 'RECEIVED', daysOverdueOrWaiting: null, station: facts.station,
        evidence: [{ label: invoice ? 'Open purchase invoice' : 'Open purchase records', path: '/purchases', recordType: invoice ? 'PURCHASE_INVOICE' : 'PURCHASE_RECEIPT', recordId: invoice?.id ?? facts.receiptId }],
        availableActions: ['VIEW_RECORD'],
      },
      message: () => receiptMessage(facts, env.APP_URL)!,
    });
    return result.reason !== 'facts_changed';
  }
  const tankFilter = job.eventType === 'SALE_RECORDED'
    ? await prisma.sale.findFirst({ where: { id: job.resourceId, ...scope }, select: { tankId: true } })
    : job.eventType === 'STOCK_ADJUSTED'
      ? await prisma.inventoryLedger.findFirst({ where: { id: job.resourceId, ...scope }, select: { tankId: true } })
      : undefined;
  if (tankFilter === null || tankFilter?.tankId === null) return true;
  const tanks = await prisma.tank.findMany({
    where: { ...(tankFilter?.tankId ? { id: tankFilter.tankId } : {}), status: 'ACTIVE', product: { category: 'FUEL' }, configuration: { active: true, stationId: job.stationId, station: { organizationId: job.organizationId } } },
    select: { id: true }, orderBy: { id: 'asc' },
  });
  let done = true;
  for (const tank of tanks) if (!(await reviewLowStock(scope, tank.id))) done = false;
  return done;
}

async function reviewLowStock(scope: { organizationId: string; stationId: string }, tankId: string) {
  const settings = await getSettings(scope.organizationId);
  const episode = await prisma.$transaction(async tx => {
    const [state] = await tx.$queryRaw<Array<{ episodeId: string; level: string }>>`
      INSERT INTO "stock_alert_states" ("tankId", "episodeId", "level")
      VALUES (${tankId}, ${randomUUID()}, 'HEALTHY')
      ON CONFLICT ("tankId") DO UPDATE SET "tankId" = EXCLUDED."tankId"
      RETURNING "episodeId", "level"`;
    if (!state) return null;
    const tank = await tx.tank.findFirst({
      where: { id: tankId, status: 'ACTIVE', configuration: { active: true, stationId: scope.stationId, station: { organizationId: scope.organizationId } } },
      select: { productId: true, workingCapacity: true },
    });
    if (!tank || tank.workingCapacity.lte(0)) return null;
    const quantity = await bookStockAt(tx, { ...scope, tankId, productId: tank.productId });
    const level = stockLevel(quantity.toNumber(), tank.workingCapacity.toNumber(), settings.lowStockPercent);
    if (level === 'HEALTHY') {
      if (state.level !== 'HEALTHY') await tx.ownerAlert.updateMany({
        where: { organizationId: scope.organizationId, stationId: scope.stationId, dedupeKey: { in: ['LOW', 'EMPTY'].map(key => stockKey(tankId, state.episodeId, key)) }, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
      await tx.stockAlertState.update({ where: { tankId }, data: { level } });
      return null;
    }
    if (state.level === 'EMPTY' && level === 'LOW') {
      await tx.ownerAlert.updateMany({
        where: { organizationId: scope.organizationId, stationId: scope.stationId, dedupeKey: stockKey(tankId, state.episodeId, 'EMPTY'), resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
      await tx.stockAlertState.update({ where: { tankId }, data: { level } });
      return null;
    }
    const episodeId = state.level === 'HEALTHY' ? randomUUID() : state.episodeId;
    if (state.level !== level) await tx.stockAlertState.update({ where: { tankId }, data: { level, episodeId } });
    return { episodeId, level };
  });
  if (!episode) return true;
  const facts = await readTankAlertFacts(scope, tankId);
  if (!facts || facts.completeness !== 'COMPLETE') return true;
  if (stockLevel(facts.bookStock.toNumber(), facts.tank.workingCapacity.toNumber(), settings.lowStockPercent) !== episode.level) return false;
  const tank = facts.tank;
  const subject = `${tank.product.code} tank ${tank.code}`.slice(0, 160);
  const result = await sendOwnerNotification({
    ...scope, type: 'LOW_STOCK', dedupeKey: stockKey(tankId, episode.episodeId, episode.level),
    severity: episode.level === 'EMPTY' ? 'URGENT' : 'ATTENTION', evidenceSourceType: 'TANK', evidenceSourceId: tankId,
    stillRelevant: async () => {
      const [current, state] = await Promise.all([readTankAlertFacts(scope, tankId), prisma.stockAlertState.findUnique({ where: { tankId } })]);
      return Boolean(current && current.completeness === 'COMPLETE' && state?.episodeId === episode.episodeId && state.level === episode.level
        && current.bookStock.eq(facts.bookStock) && stockLevel(current.bookStock.toNumber(), current.tank.workingCapacity.toNumber(), settings.lowStockPercent) === episode.level);
    },
    packet: {
      subjectName: subject, recordType: 'TANK_STOCK_POSITION', eventDate: facts.calculatedAt.toISOString(), product: tank.product,
      quantity: { value: facts.bookStock.toNumber(), unit: tank.product.unit }, amount: null, dueDate: null,
      status: episode.level, daysOverdueOrWaiting: null, station: facts.station,
      evidence: [{ label: 'Open tank inventory', path: '/inventory', recordType: 'TANK', recordId: tankId }],
      availableActions: ['VIEW_RECORD', 'ACKNOWLEDGE'],
    },
    message: () => stockAlertMessage(facts, settings.lowStockPercent, env.APP_URL),
  });
  return result.reason !== 'facts_changed';
}
