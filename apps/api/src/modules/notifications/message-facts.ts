import { Prisma, type PaymentMethod } from '@prisma/client';
import { indiaDate, indiaDayRange } from '../../lib/india-time.js';
import { prisma } from '../../lib/prisma.js';
import { readTankStockTimelines } from '../../lib/historical-stock.js';
import { bookStockAt } from '../../lib/stock.js';
import { customerLedgerBalances } from '../customers/ledger-balances.js';

type Scope = { organizationId: string; stationId?: string };
type Product = { id: string; name: string; code: string; unit: string };
type Sale = { id: string; product: Product; quantity: Prisma.Decimal; totalAmount: Prisma.Decimal };
const product = { select: { id: true, name: true, code: true, unit: true, tankLinked: true } } as const;
const station = { select: { id: true, name: true } } as const;
const zero = () => new Prisma.Decimal(0);
const collectedMethod = (method: PaymentMethod) => method !== 'CREDIT' && method !== 'FLEET';
const stationScope = (scope: Scope) => ({ organizationId: scope.organizationId, ...(scope.stationId ? { id: scope.stationId } : {}) });
const stationIdFilter = (scope: Scope) => scope.stationId ? { stationId: scope.stationId } : {};

function productSales(sales: Sale[]) {
  const totals = new Map<string, { product: Product; quantity: Prisma.Decimal; value: Prisma.Decimal; saleIds: string[] }>();
  for (const sale of sales) {
    const row = totals.get(sale.product.id) ?? { product: sale.product, quantity: zero(), value: zero(), saleIds: [] };
    row.quantity = row.quantity.plus(sale.quantity);
    row.value = row.value.plus(sale.totalAmount);
    row.saleIds.push(sale.id);
    totals.set(sale.product.id, row);
  }
  return [...totals.values()].sort((a, b) => a.product.code.localeCompare(b.product.code));
}

function metadata(scope: Scope, start: Date, end: Date, calculatedAt: Date) {
  return { ...scope, period: { start, end }, calculatedAt };
}

function activeTanks(scope: Scope, tankId?: string) {
  return prisma.tank.findMany({
    where: {
      ...(tankId ? { id: tankId } : {}), status: 'ACTIVE', product: { active: true },
      configuration: { active: true, station: { ...stationScope(scope), active: true } },
    },
    include: { product, configuration: { select: { station } } },
    orderBy: [{ configuration: { station: { name: 'asc' } } }, { code: 'asc' }],
  });
}

async function tankBookStock(organizationId: string, stationId: string, tank: { id: string; productId: string }, asOf: Date) {
  return bookStockAt(prisma, { organizationId, stationId, productId: tank.productId, tankId: tank.id }, asOf);
}

export async function readTankAlertFacts(scope: Scope, tankId: string, asOf = new Date()) {
  const [tank] = await activeTanks(scope, tankId);
  if (!tank) return null;
  const station = tank.configuration.station;
  const bookStock = await tankBookStock(scope.organizationId, station.id, tank, asOf);
  const history=(await readTankStockTimelines(prisma,scope.organizationId,[{id:tank.id,stationId:station.id,productId:tank.productId,openingStock:tank.openingStock}],asOf)).get(tank.id);
  return { ...metadata({ ...scope, stationId: station.id }, asOf, asOf, asOf), station, tank, bookStock,
    stockIssues:history?.issues??[], completeness: tank.workingCapacity.gt(0) && !history?.issues.length ? 'COMPLETE' : 'INCOMPLETE' };
}

export async function readDailyOperatingFacts(scope: Scope, date: string, asOf = new Date()) {
  const { start, endExclusive } = indiaDayRange(date);
  const end = new Date(Math.min(asOf.getTime(), endExclusive.getTime() - 1));
  const stationFilter = { ...stationScope(scope), active: true };
  const [sales, tanks, shifts, openShifts] = await Promise.all([
    prisma.sale.findMany({
      where: { organizationId: scope.organizationId, station: stationFilter, occurredAt: { gte: start, lte: end } },
      select: { id: true, product, quantity: true, totalAmount: true, shiftId: true, paymentMethod: true },
    }),
    activeTanks(scope),
    prisma.shift.findMany({
      where: { station: stationFilter, closedAt: { gte: start, lte: end } },
      select: { id: true, reconciliation: { select: { id: true, reconciledAt: true, collections: { select: { paymentMethod: true, actualAmount: true } } } } },
    }),
    // Attention items describe older shifts still open now, even in a recovered
    // report. Never confuse the report cutoff with current operational status.
    prisma.shift.findMany({
      where: { station: stationFilter, status: 'OPEN', closedAt: null, openedAt: { lt: indiaDayRange(indiaDate(asOf)).start } },
      select: { id: true, shiftNumber: true, openedAt: true, station },
      orderBy: { openedAt: 'asc' },
    }),
  ]);
  const timelines=await readTankStockTimelines(prisma,scope.organizationId,tanks.map(tank=>({id:tank.id,stationId:tank.configuration.station.id,productId:tank.productId,openingStock:tank.openingStock})),end);
  const stockIssues=[...timelines.values()].flatMap(timeline=>timeline.issues);
  const reconciled = shifts.flatMap(shift => shift.reconciliation && shift.reconciliation.reconciledAt <= asOf && shift.reconciliation.collections.length ? [shift.reconciliation] : []);
  const actual = reconciled.flatMap(row => row.collections).filter(row => collectedMethod(row.paymentMethod));
  const closedShiftIds = new Set(shifts.map(shift => shift.id));
  const incomplete = shifts.length !== reconciled.length || sales.some(sale => sale.shiftId !== null && !closedShiftIds.has(sale.shiftId)) || openShifts.some(shift => shift.openedAt <= end);
  const counterCollections = sales.filter(sale => sale.shiftId === null && collectedMethod(sale.paymentMethod));
  return {
    ...metadata(scope, start, end, asOf),
    stockIssues,
    completeness: incomplete || stockIssues.length || !tanks.length ? 'INCOMPLETE' : 'COMPLETE',
    openShifts,
    sales: productSales(sales),
    collections: {
      actual: reconciled.length || counterCollections.length ? counterCollections.reduce((sum, sale) => sum.plus(sale.totalAmount), actual.reduce((sum, row) => sum.plus(row.actualAmount), zero())) : null,
      reconciliationIds: reconciled.map(row => row.id),
      incomplete,
    },
    tanks: await Promise.all(tanks.map(async tank => ({
      id: tank.id, code: tank.code, product: tank.product, station: tank.configuration.station,
      bookStock: await tankBookStock(scope.organizationId, tank.configuration.station.id, tank, end),
      stockIssues:timelines.get(tank.id)?.issues??[],
    }))),
  };
}

export async function readShiftMessageFacts(scope: Scope, shiftId: string, asOf = new Date()) {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, station: stationScope(scope), openedAt: { lte: asOf } },
    include: {
      station,
      sales: { where: { organizationId: scope.organizationId, ...stationIdFilter(scope), occurredAt: { lte: asOf } }, select: { id: true, product, quantity: true, totalAmount: true } },
      reconciliation: { include: { collections: true } },
      tankReadings: { include: { tank: { include: { product } } } },
      manager: { select: { id: true, name: true, organizationId: true } },
      users: { include: { user: { select: { id: true, name: true, organizationId: true } } } },
      nozzleAssignments: { select: { nozzleId: true, collectionAmount: true, user: { select: { id: true, name: true, organizationId: true } }, nozzle: { select: { code: true, product: { select: { code: true } }, dispenser: { select: { code: true } } } } } },
      nozzleReadings: { select: { nozzleId: true, testingQuantity: true, testingReturned: true } },
    },
  });
  if (!shift) return null;
  const closedAt = shift.closedAt && shift.closedAt <= asOf ? shift.closedAt : null;
  const reconciliation = closedAt && shift.reconciliation && shift.reconciliation.reconciledAt <= asOf ? shift.reconciliation : null;
  const channels = reconciliation?.collections ?? [];
  const moneyChannels = channels.filter(row => collectedMethod(row.paymentMethod));
  const collections = reconciliation && channels.length ? {
    reconciliationId: reconciliation.id,
    channels,
    expected: moneyChannels.reduce((sum, row) => sum.plus(row.expectedAmount), zero()),
    adjustedExpected: moneyChannels.reduce((sum, row) => sum.plus(row.expectedAmount).plus(row.adjustmentAmount), zero()),
    actual: moneyChannels.reduce((sum, row) => sum.plus(row.actualAmount), zero()),
    difference: moneyChannels.reduce((sum, row) => sum.plus(row.varianceAmount), zero()),
  } : null;
  const tanks = await Promise.all(shift.tankReadings.map(async row => ({
    readingId: row.id, tankId: row.tankId, code: row.tank.code, product: row.tank.product,
    physicalClosing: closedAt ? row.closingDip : null,
    bookClosing: closedAt ? await tankBookStock(scope.organizationId, shift.station.id, row.tank, closedAt) : null,
  })));
  return {
    ...metadata({ ...scope, stationId: shift.station.id }, shift.openedAt, closedAt ?? asOf, asOf),
    completeness: closedAt && collections && tanks.every(tank => tank.physicalClosing !== null) ? 'COMPLETE' : 'INCOMPLETE',
    shiftId, shiftNumber: shift.shiftNumber, station: shift.station, closedAt, sales: productSales(shift.sales), collections, tanks,
    openedAt: shift.openedAt,
    openingRecordedAt: (() => {
      const audit = shift.openingTimeAudit as { recordedAt?: string } | null;
      const recorded = audit?.recordedAt ? new Date(audit.recordedAt) : null;
      return recorded && Number.isFinite(recorded.getTime()) ? recorded : null;
    })(),
    closingRecordedAt: (() => {
      const audit = shift.closingTimeAudit as { recordedAt?: string } | null;
      const recorded = audit?.recordedAt ? new Date(audit.recordedAt) : null;
      return recorded && Number.isFinite(recorded.getTime()) ? recorded : null;
    })(),
    managerName: shift.manager?.organizationId === scope.organizationId ? shift.manager.name : null,
    assignedStaff: (() => {
      const team = new Map<string, { name: string; nozzles: string[] }>();
      for (const assignment of shift.users ?? []) if (assignment.user.organizationId === scope.organizationId) team.set(assignment.user.id, { name: assignment.user.name, nozzles: [] });
      for (const assignment of shift.nozzleAssignments) {
        if (assignment.user?.organizationId !== scope.organizationId) continue;
        const member = team.get(assignment.user.id) ?? { name: assignment.user.name, nozzles: [] };
        member.nozzles.push(`${assignment.nozzle.dispenser.code}/${assignment.nozzle.code} · ${assignment.nozzle.product.code}`);
        team.set(assignment.user.id, member);
      }
      return [...team.values()].map(member => ({ ...member, nozzles: [...new Set(member.nozzles)].sort() })).sort((a,b) => a.name.localeCompare(b.name));
    })(),
    staffHandovers: closedAt ? shift.nozzleAssignments : [],
    physicalClosingCash: closedAt ? shift.closingCash : null,
    testing: closedAt ? shift.nozzleReadings : [],
  };
}

export async function readReceiptMessageFacts(scope: Scope, receiptId: string, asOf = new Date()) {
  const receipt = await prisma.purchaseReceipt.findFirst({
    where: { id: receiptId, organizationId: scope.organizationId, station: stationScope(scope), receivedAt: { lte: asOf }, createdAt: { lte: asOf } },
    include: {
      station,
      invoice: { include: { lines: { select: { quantity: true, product } }, payments: { where: { paidAt: { lte: asOf } } } } },
      lines: { include: { product, tank: { select: { id: true, code: true, productId: true, configuration: { select: { stationId: true } } } } } },
    },
  });
  if (!receipt) return null;
  const invoice = receipt.invoice?.organizationId === scope.organizationId && receipt.invoice.stationId === receipt.stationId && receipt.invoice.status !== 'VOID' ? receipt.invoice : null;
  const payments = invoice?.payments.filter(payment => payment.organizationId === scope.organizationId && payment.stationId === receipt.stationId) ?? [];
  const paidAmount = payments.reduce((sum, payment) => sum.plus(payment.amount), zero());
  const lines = receipt.lines.map(line => ({
    id: line.id, product: line.product, quantity: line.quantity,
    tank: line.tank && line.tank.productId === line.productId && line.tank.configuration.stationId === receipt.stationId
      ? { id: line.tank.id, code: line.tank.code } : null,
    invalidTankMapping: Boolean((line.product.tankLinked || line.tankId)
      && (!line.tank || line.tank.productId !== line.productId || line.tank.configuration.stationId !== receipt.stationId)),
  }));
  const invoiced = new Map<string, Product & { quantity: Prisma.Decimal }>();
  for (const line of invoice?.lines ?? []) {
    if (!line.product) continue;
    const previous = invoiced.get(line.product.id);
    invoiced.set(line.product.id, { ...line.product, quantity: (previous?.quantity ?? zero()).plus(line.quantity) });
  }
  return {
    ...metadata({ ...scope, stationId: receipt.stationId }, receipt.receivedAt, receipt.receivedAt, asOf),
    completeness: invoice && lines.length && lines.every(line => !line.invalidTankMapping) ? 'COMPLETE' : 'INCOMPLETE',
    receiptId, station: receipt.station, supplierName: receipt.supplierName, receivedAt: receipt.receivedAt, lines,
    invoice: invoice ? {
      id: invoice.id, version: invoice.version, number: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate,
      products: [...invoiced.values()].sort((a, b) => a.code.localeCompare(b.code)),
      totalAmount: invoice.totalAmount, paidAmount, outstanding: invoice.totalAmount.minus(paidAmount),
      payments: payments.map(({ id, origin, amount, paidAt }) => ({ id, origin, amount, paidAt })),
    } : null,
  };
}

export async function readCustomerCreditFacts(scope: Scope, asOf = new Date(), customerId?: string, db: Pick<Prisma.TransactionClient, "customer"> = prisma) {
  const customers = await db.customer.findMany({
    where: { ...(customerId ? { id: customerId } : {}), organizationId: scope.organizationId, active: true },
    select: { id: true, name: true, ledger: {
      where: { organizationId: scope.organizationId, ...stationIdFilter(scope), occurredAt: { lte: asOf } },
      select: { id: true, stationId: true, amount: true, occurredAt: true, dueDate: true, disputedAt: true },
    } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return customers.map(customer => {
    const balance = customerLedgerBalances(customer.ledger, asOf);
    const overdue = balance.unpaid.filter(entry => (entry.daysOverdue ?? 0) > 0);
    const earliest = customer.ledger.reduce((date, entry) => entry.occurredAt < date ? entry.occurredAt : date, asOf);
    return {
      ...metadata(scope, earliest, asOf, asOf),
      completeness: balance.unpaid.some(entry => entry.daysOverdue === null) ? 'INCOMPLETE' : 'COMPLETE',
      customerId: customer.id, customerName: customer.name, ...balance,
      ledgerEntryIds: customer.ledger.map(entry => entry.id),
      overdueAmount: overdue.reduce((sum, entry) => sum.plus(entry.remaining), zero()).toNumber(),
      oldestDaysOverdue: overdue.length ? Math.max(...overdue.map(entry => entry.daysOverdue!)) : null,
      hasDisputedBalance: balance.unpaid.some(entry => entry.disputedAt && entry.disputedAt <= asOf),
    };
  });
}
