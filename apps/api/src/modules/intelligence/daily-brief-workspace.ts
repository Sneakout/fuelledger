import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { addIndiaDays, indiaDate, indiaDayRange } from '../../lib/india-time.js';
import { readCustomerCreditFacts, readDailyOperatingFacts } from '../notifications/message-facts.js';
import { agentPresentation } from './agent-presentation.js';
import { missingDailyRecords } from './history-completeness.js';
import { completedReviewFindings } from './nerve-findings.js';

type Scope = { organizationId: string; stationId: string; userId: string };
type RecordLink = { label: string; path: string };
type Finding = {
  key: string; title: string; impact: string; amount: string | null; action: string;
  severity: 'URGENT' | 'ATTENTION'; agent: string; checkedAt: string; records: RecordLink[];
  insufficient?: boolean;
};
const money = (value: number) => value.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
const quantity = (value: number, unit: string) => `${value.toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${unit === 'LITRE' ? 'L' : unit.toLowerCase()}`;
const record = (label: string, path: string): RecordLink => ({ label, path });
const withId = (path: string, key: string, id: string) => `${path}?${new URLSearchParams({ [key]: id })}`;
const safeRecordPath = (path: string) => /^\/(inventory|operations|reconciliation|purchases|customers|sales|reports|approvals|accounting)(?=\/|\?|#|$)/.test(path);
const actionLabel = (type: string) => type === 'PRODUCT_PRICE_CHANGE' ? 'Price change'
  : type === 'PRODUCT_CATALOG_CHANGE' ? 'Product change' : 'Inventory adjustment';

export async function dailyBriefWorkspace(scope: Scope, demo: boolean, now = new Date()) {
  const { organizationId, stationId } = scope;
  const station = await prisma.station.findFirst({ where: { id: stationId, organizationId, active: true }, select: { id: true, name: true, code: true } });
  if (!station) throw new AppError(404, 'BRIEF_STATION_UNAVAILABLE', 'Choose an active fuel station.');
  const date = indiaDate(now);
  const { start } = indiaDayRange(date);
  const dueThrough = indiaDayRange(addIndiaDays(date, 7)).endExclusive;
  const since = indiaDayRange(addIndiaDays(date, -7)).start;
  const checkedAt = now.toISOString();
  const stationScope = { organizationId, stationId };
  const [operating, gaps, shifts, approvals, receipts, invoices, customerFacts, creditIssued, tanks, settings, reviews, closedShifts, resolvedAlerts, preferences] = await Promise.all([
    readDailyOperatingFacts(stationScope, date, now),
    missingDailyRecords(organizationId, [stationId], stationId, now),
    prisma.shift.findMany({ where: { stationId, status: { in: ['OPEN', 'CLOSING', 'RECONCILIATION_REQUIRED'] }, openedAt: { lte: now } }, orderBy: { openedAt: 'asc' }, select: { id: true, shiftNumber: true, status: true } }),
    prisma.approvalRequest.findMany({ where: { ...stationScope, OR: [{ status: 'PENDING' }, { decidedAt: { gte: since, lte: now } }] }, orderBy: { requestedAt: 'asc' },
      select: { id: true, actionType: true, status: true, reason: true, decisionNote: true, requestedAt: true, decidedAt: true, requestedBy: { select: { name: true } } } }),
    prisma.purchaseReceipt.findMany({ where: { ...stationScope, receivedAt: { gte: start, lte: now }, createdAt: { lte: now } }, orderBy: { receivedAt: 'desc' },
      select: { id: true, supplierName: true, invoiceId: true, receivedAt: true, lines: { select: { quantity: true, product: { select: { code: true, unit: true } } } } } }),
    prisma.purchaseInvoice.findMany({ where: { ...stationScope, status: { in: ['OPEN', 'PART_PAID'] }, dueDate: { lt: dueThrough } }, orderBy: { dueDate: 'asc' },
      select: { id: true, invoiceNumber: true, totalAmount: true, dueDate: true, supplier: { select: { name: true } },
        payments: { where: { ...stationScope, paidAt: { lte: now } }, select: { amount: true } } } }),
    readCustomerCreditFacts({ organizationId }, now),
    prisma.customerLedgerEntry.aggregate({ where: { ...stationScope, type: 'SALE', amount: { gt: 0 }, occurredAt: { gte: start, lte: now } }, _sum: { amount: true } }),
    prisma.tank.findMany({ where: { status: 'ACTIVE', configuration: { stationId, active: true } }, select: { id: true, workingCapacity: true } }),
    prisma.ownerNotificationSettings.findUnique({ where: { organizationId }, select: { lowStockPercent: true } }),
    demo ? [] : completedReviewFindings(organizationId, stationId),
    prisma.shiftReconciliation.findMany({ where: { shift: { stationId, status: { in: ['LOCKED', 'RECONCILED'] } }, reconciledAt: { gte: since, lte: now } },
      orderBy: { reconciledAt: 'desc' }, take: 12, select: { id: true, reconciledAt: true, notes: true, shift: { select: { id: true, shiftNumber: true } } } }),
    prisma.ownerAlert.findMany({ where: { ...stationScope, type: 'LOW_STOCK', resolvedAt: { gte: since, lte: now } },
      orderBy: { resolvedAt: 'desc' }, take: 10, select: { id: true, title: true, createdAt: true, resolvedAt: true, evidenceSourceId: true } }),
    demo ? [] : prisma.dailyBriefFindingPreference.findMany({ where: scope, select: { findingKey: true, acknowledgedAt: true, remindAt: true } }),
  ]);
  const capacity = new Map(tanks.map(tank => [tank.id, tank.workingCapacity.toNumber()]));
  const threshold = settings?.lowStockPercent ?? 20;
  const stock = operating.tanks.map(tank => {
    const litres = tank.bookStock.toNumber();
    const max = capacity.get(tank.id) ?? 0;
    const level = max <= 0 ? 'UNAVAILABLE' : litres <= 0 ? 'EMPTY' : litres > max ? 'OVER_CAPACITY' : litres / max * 100 <= threshold ? 'LOW' : 'NORMAL';
    return { id: tank.id, title: `${tank.product.code} · ${tank.code}`, value: quantity(litres, tank.product.unit), level, path: withId('/inventory', 'tankId', tank.id) };
  });
  const add = (finding: Omit<Finding, 'checkedAt'>): Finding => ({ ...finding, checkedAt });
  const registers = gaps.map(gap => ({ ...gap, path: `/sales/history/import?${new URLSearchParams({ productId: gap.productId, month: gap.missingFrom.slice(0, 7) })}` }));
  const missing = registers.map(gap => add({
    key: `dsr:${gap.productId}:${gap.lastAvailableDate}`, title: `${gap.productCode} records are missing`,
    severity: 'ATTENTION', agent: 'business-assistant', amount: `${gap.missingDates.length} missing day${gap.missingDates.length === 1 ? '' : 's'}`,
    impact: `Sales history is incomplete from ${gap.missingFrom} through ${gap.missingThrough}.`, action: 'Upload or review the missing sales register.',
    insufficient: true, records: [record('Historical sales register', gap.path)],
  }));
  const incomplete = shifts.map(shift => add({
    key: `shift:${shift.id}:${shift.status}`, title: `Shift #${shift.shiftNumber} ${shift.status === 'RECONCILIATION_REQUIRED' ? 'needs reconciliation' : 'is still in progress'}`,
    severity: shift.status === 'RECONCILIATION_REQUIRED' ? 'URGENT' : 'ATTENTION', agent: 'reconciliation-review', amount: null, insufficient: true,
    impact: 'Collections for this shift are provisional until shifts are closed and reconciled.',
    action: shift.status === 'RECONCILIATION_REQUIRED' ? 'Compare expected and actual collections and review the shift.' : 'Review the shift and finish the handover when ready.',
    records: [record(`Shift #${shift.shiftNumber}`, shift.status === 'RECONCILIATION_REQUIRED' ? withId('/reconciliation', 'shiftId', shift.id) : withId('/operations', 'shiftId', shift.id))],
  }));
  const replenishment = stock.filter(tank => tank.level === 'LOW' || tank.level === 'EMPTY');
  const stockFindings = stock.filter(tank => tank.level !== 'NORMAL').map(tank => add({
    key: `stock:${tank.id}:${tank.level}:${date}`, title: `${tank.title} · ${tank.level === 'EMPTY' ? 'book stock depleted' : tank.level === 'LOW' ? 'low stock' : tank.level === 'OVER_CAPACITY' ? 'above working capacity' : 'capacity unavailable'}`,
    severity: tank.level === 'EMPTY' ? 'URGENT' : 'ATTENTION', agent: 'inventory-watch', amount: tank.value,
    impact: tank.level === 'LOW' || tank.level === 'EMPTY' ? `Book stock is at or below the ${threshold}% alert threshold. Check supply coverage before the next shift.`
      : 'The stock reading needs a capacity or movement check.',
    action: 'Review the tank balance and latest readings.', records: [record('Tank stock timeline', tank.path)],
    ...(tank.level === 'UNAVAILABLE' ? { insufficient: true } : {}),
  }));
  const suppliers = invoices.flatMap(invoice => {
    const net = invoice.payments.reduce((amount, payment) => amount.minus(payment.amount), invoice.totalAmount);
    return net.gt(0) ? [{ id: invoice.id, title: `${invoice.supplier.name} · ${invoice.invoiceNumber}`, amount: money(net.toNumber()), dueDate: indiaDate(invoice.dueDate), path: withId('/purchases', 'invoiceId', invoice.id) }] : [];
  });
  const customerDues = customerFacts.flatMap(customer => customer.unpaid.flatMap(item =>
    item.stationId === stationId && item.dueDate && item.dueDate < dueThrough
      ? [{ id: item.id, title: customer.customerName, amount: money(item.remaining), dueDate: indiaDate(item.dueDate), disputed: Boolean(item.disputedAt), path: withId('/customers', 'customerId', customer.customerId) }] : []));
  customerDues.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id));
  const overdue = suppliers.filter(item => item.dueDate < date).map(item => add({
    key: `supplier:${item.id}:${item.dueDate}`, title: `Overdue invoice · ${item.title}`, amount: item.amount, severity: 'ATTENTION', agent: 'purchase-check',
    impact: `Payment was due ${item.dueDate}.`, action: 'Review the invoice and payment history.', records: [record('Purchase invoice', item.path)],
  }));
  const collectionGap = operating.collections.incomplete && !incomplete.length ? [add({
    key: `collections:${date}`, title: 'Some collections are unverified', amount: null, severity: 'ATTENTION', agent: 'reconciliation-review',
    impact: 'Some sales or shifts have no matching reconciliation. The collection total is incomplete.',
    action: 'Check the shift and collection records.', records: [record('Reconciliation records', '/reconciliation')], insufficient: true,
  })] : [];
  const noSales = !operating.sales.length;
  const specialistAttention = reviews.flatMap(review => review.findings.flatMap(item => {
    if (item.severity === 'INFORMATION') return [];
    // Shift and tank-level checks above already reflect the station's current records.
    if (/SHIFT_RECONCILIATION|INVENTORY_(LOW|EMPTY)/.test(item.type)) return [];
    const links = item.evidence.filter(row => safeRecordPath(row.resolverPath));
    if (!links.length) return [];
    const resources = links.map(row => row.resourceId || row.resolverPath).sort();
    const key = createHash('sha256').update(JSON.stringify([review.agentKey, item.type, item.title, resources, date])).digest('hex');
    return [{
      key: `review:${key}`, title: item.title, impact: item.whyItMatters,
      amount: typeof item.displayValue === 'number' ? item.displayValue.toLocaleString('en-IN', { maximumFractionDigits: 3 })
        : typeof item.displayValue === 'string' ? item.displayValue : null,
      severity: item.severity, agent: review.agentKey, checkedAt: item.calculatedAt, action: item.recommendedNextStep,
      records: links.map(row => record(row.label, row.resolverPath)),
    }];
  }));
  const needsAttention = [...new Map([...incomplete, ...stockFindings, ...missing, ...collectionGap, ...overdue, ...specialistAttention]
    .map(item => [item.key, item])).values()]
    .sort((left, right) => Number(right.severity === 'URGENT') - Number(left.severity === 'URGENT'));
  const byKey = new Map(preferences.map(preference => [preference.findingKey, preference]));
  const resolved = [
    ...approvals.flatMap(item => item.decidedAt ? [{ id: item.id, title: `${actionLabel(item.actionType)} ${item.status.toLowerCase()}`, detail: item.decisionNote || item.reason, closedAt: item.decidedAt, path: withId('/approvals', 'approvalId', item.id) }] : []),
    ...closedShifts.map(item => ({ id: item.id, title: `Shift #${item.shift.shiftNumber} reconciled`, detail: item.notes || 'The reconciliation and its collection records were saved.', closedAt: item.reconciledAt, path: withId('/reconciliation', 'shiftId', item.shift.id) })),
    ...resolvedAlerts.flatMap(item => item.resolvedAt ? [{ id: item.id, title: item.title, detail: 'Inventory Watch cleared the previous tank stock alert after the stock status changed.', closedAt: item.resolvedAt, path: item.evidenceSourceId ? withId('/inventory', 'tankId', item.evidenceSourceId) : '/inventory' }] : []),
  ].sort((left, right) => right.closedAt.getTime() - left.closedAt.getTime()).slice(0, 20);
  const sales = operating.sales.reduce((total, line) => total + line.value.toNumber(), 0);
  const creditHasMissingDueDates = customerFacts.flatMap(customer => customer.unpaid).some(item => item.stationId === stationId && !item.dueDate);
  const credit = customerFacts.flatMap(customer => customer.unpaid).filter(item => item.stationId === stationId).reduce((total, item) => total + item.remaining, 0);
  const specialist = ['reconciliation-review', 'inventory-watch', 'credit-watch', 'purchase-check', 'profit-insight', 'business-assistant'].map(key => {
    const agent = agentPresentation(key);
    const review = reviews.find(item => item.agentKey === key);
    const findings = review?.findings.map(item => ({
      id: item.findingId, title: item.title, impact: item.whyItMatters, amount: item.displayValue,
      action: item.recommendedNextStep, checkedAt: item.calculatedAt,
      records: item.evidence.filter(row => safeRecordPath(row.resolverPath)).map(row => record(row.label, row.resolverPath)),
    })) ?? [];
    if (!review) {
      const live = needsAttention.filter(item => item.agent === key);
      if (live.length) return { key, name: agent.name, checkedAt, findings: live.map(item => ({ id: item.key, ...item })) };
    }
    return { key, name: agent.name, checkedAt: review?.lastCompletedAt ?? null, findings };
  });
  const receiptLinks = receipts.map(item => ({
    id: item.id, title: item.supplierName,
    detail: item.lines.map(line => `${line.product.code} ${quantity(line.quantity.toNumber(), line.product.unit)}`).join(' · '),
    path: item.invoiceId ? withId('/purchases', 'invoiceId', item.invoiceId) : '/purchases',
  }));
  return {
    station, date, checkedAt, demo,
    coverage: { noSales, incompleteShifts: incomplete.length, collectionsIncomplete: operating.collections.incomplete, gaps: registers, stockUnavailable: !stock.length || stock.some(item => item.level === 'UNAVAILABLE') },
    attention: needsAttention.map(item => ({ ...item, agent: agentPresentation(item.agent).name,
      acknowledgedAt: byKey.get(item.key)?.acknowledgedAt ?? null, remindAt: byKey.get(item.key)?.remindAt ?? null })),
    summary: { sales, collections: operating.collections.actual?.toNumber() ?? null, credit, creditIssued: creditIssued._sum.amount?.toNumber() ?? 0, creditHasMissingDueDates,
      receipts: receiptLinks, stock, products: operating.sales.map(item => ({ code: item.product.code, volume: quantity(item.quantity.toNumber(), item.product.unit) })) },
    approvals: approvals.filter(item => item.status === 'PENDING').map(item => ({
      id: item.id, title: actionLabel(item.actionType), reason: item.reason, requester: item.requestedBy.name, requestedAt: item.requestedAt, path: withId('/approvals', 'approvalId', item.id),
    })),
    specialists: specialist, upcoming: { suppliers, customers: customerDues, replenishment }, resolved,
  };
}

export async function setBriefFindingPreference(scope: Scope, findingKey: string, action: 'ACKNOWLEDGE' | 'REMIND_LATER') {
  const brief = await dailyBriefWorkspace(scope, false);
  if (!brief.attention.some(item => item.key === findingKey)) throw new AppError(409, 'BRIEF_FINDING_CHANGED', 'This finding changed. Refresh the brief to review the current records.');
  const now = new Date();
  const identity = { ...scope, findingKey };
  const change = action === 'ACKNOWLEDGE' ? { acknowledgedAt: now, remindAt: null } : { remindAt: new Date(now.getTime() + 4 * 60 * 60_000) };
  return prisma.dailyBriefFindingPreference.upsert({
    where: { organizationId_stationId_userId_findingKey: identity },
    create: { ...identity, ...change }, update: change, select: { acknowledgedAt: true, remindAt: true },
  });
}
