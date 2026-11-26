import { calculateHistoricalNozzleSales, type HistoricalSalesRowInput } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addIndiaDays, indiaDate, indiaDayRange, indiaMonthStart } from '../../lib/india-time.js';
import { historicalRowsWithSellingPrice, importRows } from '../historical-sales/service.js';

type Amount = Prisma.Decimal.Value;
type Shift = { id: string; stationId: string; shiftNumber: number; status: string; openedAt: Date; closedAt: Date | null;
 reconciliation: { collections: Array<{ paymentMethod: string; actualAmount: Amount }> } | null;
 nozzleReadings: Array<{ nozzleId?: string; testingQuantity: Amount; testingReturned: boolean }> };
type Sale = { id: string; stationId: string; shiftId: string | null; productId: string; kind: string; paymentMethod: string; quantity: Amount; totalAmount: Amount; occurredAt: Date;
 product: { inventoryTracked: boolean }; inventoryLedger: { unitCost: Amount | null; quantityDelta: Amount } | null };
type Expense = { stationId: string; amount: Amount; incurredAt: Date };
type Register = { stationId: string; productId: string; rows: HistoricalSalesRowInput[] };
type TestingCost = { shiftId: string; nozzleId?: string; amount: number };
const collected = (method: string) => !['CREDIT','FLEET'].includes(method);
const sum = <T>(rows: T[], value: (row: T) => number) => rows.reduce((total, row) => total + value(row), 0);

/** Operational days follow the actual opening date. Whole overnight shifts stay
 * together; no midnight interpolation, guessed cutoff or accounting-date rewrite. */
export function composeYesterdayPerformance(input: { date: string; stations: Array<{ id: string; name: string }>; shifts: Shift[]; sales: Sale[]; expenses: Expense[]; registers: Register[]; testingCosts: TestingCost[] }) {
 const { date } = input, shifts = input.shifts.filter(shift => !['CANCELLED','DRAFT'].includes(shift.status));
 const owned = shifts.filter(shift => indiaDate(shift.openedAt) === date), ids = new Set(owned.map(shift => shift.id));
 const issues: string[] = [];
 const belongs = (stationId: string, at: Date) => {
  const matches = shifts.filter(shift => shift.stationId === stationId && shift.openedAt <= at && (!shift.closedAt || at < shift.closedAt));
  if (matches.length > 1) issues.push('Overlapping shifts need review before the daily figures can be confirmed.');
  return indiaDate(matches[0]?.openedAt ?? at) === date;
 };
 const sales = input.sales.filter(sale => sale.shiftId ? ids.has(sale.shiftId) : belongs(sale.stationId, sale.occurredAt));
 const expenses = input.expenses.filter(expense => belongs(expense.stationId, expense.incurredAt));
 const pendingClosings = owned.filter(shift => !shift.closedAt).length;
 const closed = owned.filter(shift => shift.closedAt);
 const pendingReconciliations = closed.filter(shift => !shift.reconciliation?.collections.length).length;
 let revenue = sum(sales, sale => Number(sale.totalAmount)), volume = sum(sales.filter(sale => sale.kind === 'METERED'), sale => Number(sale.quantity));
 let historicalQuantity = 0, historicalDays = 0, missingPrice = false, incompleteDsr = false;
 // Merge duplicate representations by station + product + operational day.
 // Actual live prices remain authoritative for their covered litres.
 const groups = new Map<string, { stationId: string; productId: string; rows: Map<string, HistoricalSalesRowInput> }>();
 for (const register of input.registers) {
  const key = `${register.stationId}:${register.productId}`;
  const group = groups.get(key) ?? { stationId: register.stationId, productId: register.productId, rows: new Map() };
  for (const row of register.rows) group.rows.set(row.date, row);
  groups.set(key, group);
 }
 for (const group of groups.values()) {
  const row = group.rows.get(date); if (!row) continue;
  const next = group.rows.get(addIndiaDays(date, 1));
  const quantity = next && row.nozzleReadings.length ? calculateHistoricalNozzleSales(row, next) : undefined;
  if (quantity === undefined || !Number.isFinite(quantity)) { incompleteDsr = true; continue; }
  historicalDays++;
  const live = sum(sales.filter(sale => sale.stationId === group.stationId && sale.productId === group.productId), sale => Number(sale.quantity));
  if (live - quantity > .001) { issues.push('Recorded shift litres exceed a confirmed DSR total. Review the overlap.'); continue; }
  const remainder = Math.max(0, quantity - live);
  historicalQuantity += remainder; volume += remainder;
  if (remainder > .001) {
   if (!(row.sellingPrice > 0)) missingPrice = true;
   else revenue += remainder * row.sellingPrice;
  }
 }
 const hasData = closed.length > 0 || sales.length > 0 || historicalDays > 0;
 let costs = 0, missingCosts = false;
 for (const sale of sales) if (sale.product.inventoryTracked && Number(sale.quantity) > 0) {
  if (!sale.inventoryLedger || !(Number(sale.inventoryLedger.unitCost) > 0)) missingCosts = true;
  else costs += new Prisma.Decimal(sale.inventoryLedger.quantityDelta).abs().mul(sale.inventoryLedger.unitCost!).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
 }
 const testing = input.testingCosts.filter(cost => ids.has(cost.shiftId));
 costs += sum(testing, cost => cost.amount);
 if (closed.some(shift => shift.nozzleReadings.some(reading => !reading.testingReturned && Number(reading.testingQuantity) > .001 &&
   sum(testing.filter(cost => cost.shiftId === shift.id && (!reading.nozzleId || cost.nozzleId === reading.nozzleId)), cost => cost.amount) <= .005))) missingCosts = true;
 const expenseTotal = sum(expenses, expense => Number(expense.amount));
 const carryIn = shifts.filter(shift => indiaDate(shift.openedAt) < date && (!shift.closedAt || indiaDate(shift.closedAt) > date));
 if (!owned.length && carryIn.length) issues.push('A shift started earlier and spans this date. Its full results belong to its opening date; there are no separate daily meter readings to split it.');
 const missingMorning = incompleteDsr && !closed.some(shift => indiaDate(shift.closedAt!) > date);
 const incomplete = pendingClosings > 0 || missingMorning || (!hasData && carryIn.length > 0);
 const verified = sum(closed.flatMap(shift => shift.reconciliation?.collections ?? []).filter(row => collected(row.paymentMethod)), row => Number(row.actualAmount))
   + sum(sales.filter(sale => !sale.shiftId && collected(sale.paymentMethod)), sale => Number(sale.totalAmount));
 const collectionsPending = pendingClosings > 0 || pendingReconciliations > 0 || historicalQuantity > .001 || issues.length > 0;
 const profitPending = incomplete || missingPrice || missingCosts || historicalQuantity > .001 || issues.length > 0;
 const starts = owned.map(shift => shift.openedAt.getTime()), ends = closed.map(shift => shift.closedAt!.getTime());
 return { date, status: issues.length ? 'REVIEW' as const : incomplete ? 'PENDING' as const : hasData ? 'RECORDED' as const : 'NO_DATA' as const,
  start: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
  end: ends.length && !pendingClosings ? new Date(Math.max(...ends)).toISOString() : null,
  closedShifts: closed.length, pendingClosings, pendingReconciliations, missingMorning,
  sales: hasData && !missingPrice ? revenue : null, meteredVolume: hasData && (volume > .001 || !incomplete) ? volume : null,
  verifiedCollected: hasData ? verified : null, collected: hasData && !collectionsPending ? verified : null,
  netProfit: hasData && !profitPending ? new Prisma.Decimal(revenue).sub(costs).sub(expenseTotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber() : null,
  expenses: expenseTotal, historicalProducts: historicalDays,
  collectionsReason: pendingClosings ? 'Awaiting shift closing' : pendingReconciliations ? 'Awaiting reconciliation' : historicalQuantity > .001 ? 'Collections not recorded for DSR sales' : issues.length ? 'Figures need review' : 'Verified cash, UPI, card & other',
  profitReason: incomplete ? 'Awaiting final shift figures' : historicalQuantity > .001 || missingCosts ? 'Product costs are incomplete' : missingPrice ? 'Selling price needs review' : issues.length ? 'Figures need review' : 'After recorded product cost and expenses',
  issues: [...new Set(issues)],
  periods: input.stations.flatMap(station => { const rows = owned.filter(shift => shift.stationId === station.id); if (!rows.length) return []; return [{ stationId: station.id, name: station.name,
   start: new Date(Math.min(...rows.map(row => row.openedAt.getTime()))).toISOString(),
   end: rows.every(row => row.closedAt) ? new Date(Math.max(...rows.map(row => row.closedAt!.getTime()))).toISOString() : null }]; }),
 };
}

export async function readYesterdayPerformance(organizationId: string, stationIds: string[] | undefined, now = new Date()) {
 return prisma.$transaction(async tx => {
 const date = addIndiaDays(indiaDate(now), -1), start = indiaDayRange(date).start;
 const scope = { organizationId, ...(stationIds ? { id: { in: stationIds } } : {}) };
 const stationWhere = stationIds ? { stationId: { in: stationIds } } : {};
 const [stations, shifts, sales, expenses, registers] = await Promise.all([
  tx.station.findMany({ where: { ...scope, active: true }, select: { id: true, name: true } }),
  tx.shift.findMany({ where: { station: { ...scope, active: true }, status: { notIn: ['CANCELLED','DRAFT'] }, openedAt: { lte: now }, OR: [{ closedAt: null }, { closedAt: { gte: start } }] },
   select: { id: true, stationId: true, shiftNumber: true, status: true, openedAt: true, closedAt: true, reconciliation: { select: { collections: { select: { paymentMethod: true, actualAmount: true } } } }, nozzleReadings: { select: { nozzleId: true, testingQuantity: true, testingReturned: true } } } }),
  tx.sale.findMany({ where: { organizationId, ...stationWhere, station: { ...scope, active: true }, occurredAt: { gte: start, lte: now } }, select: { id: true, stationId: true, shiftId: true, productId: true, kind: true, paymentMethod: true, quantity: true, totalAmount: true, occurredAt: true, product: { select: { inventoryTracked: true } }, inventoryLedger: { select: { unitCost: true, quantityDelta: true } } } }),
  tx.expense.findMany({ where: { organizationId, ...stationWhere, station: { ...scope, active: true }, incurredAt: { gte: start, lte: now } }, select: { stationId: true, amount: true, incurredAt: true } }),
  tx.historicalSalesImport.findMany({ where: { organizationId, ...stationWhere, station: { ...scope, active: true }, monthStart: { gte: indiaMonthStart(start), lte: now } }, select: { stationId: true, productId: true, rows: true, product: { select: { sellingPrice: true, sellingPriceHistory: { orderBy: { effectiveFrom: 'desc' } } } } } }),
 ]);
 const owned = shifts.filter(shift => indiaDate(shift.openedAt) === date);
 const testing = owned.length ? await tx.journalLine.findMany({ where: { account: { code: '5000', organizationId }, journal: { organizationId, ...stationWhere, sourceType: 'SHIFT_TESTING', OR: owned.map(shift => ({ sourceId: { startsWith: `${shift.id}:` } })) } }, select: { debit: true, credit: true, journal: { select: { sourceId: true } } } }) : [];
 return composeYesterdayPerformance({ date, stations, shifts, sales, expenses,
  registers: registers.map(record => ({ stationId: record.stationId, productId: record.productId, rows: historicalRowsWithSellingPrice(importRows(record), { ...record.product, sellingPrice: new Prisma.Decimal(0) }) })),
  testingCosts: testing.map(line => ({ shiftId: owned.find(shift => line.journal.sourceId.startsWith(`${shift.id}:`))!.id, nozzleId: line.journal.sourceId.split(':').at(-1)!, amount: Number(line.debit) - Number(line.credit) })),
 });
 }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
