import { Prisma } from '@prisma/client';
import { indiaDate } from '../../lib/india-time.js';
import type { readDailyOperatingFacts, readCustomerCreditFacts, readReceiptMessageFacts, readShiftMessageFacts, readTankAlertFacts } from './message-facts.js';

type ShiftFacts = NonNullable<Awaited<ReturnType<typeof readShiftMessageFacts>>>;
type ReceiptFacts = NonNullable<Awaited<ReturnType<typeof readReceiptMessageFacts>>>;
type CreditFacts = Awaited<ReturnType<typeof readCustomerCreditFacts>>[number];

export const money = (value: Prisma.Decimal | number) => Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
export const volume = (value: Prisma.Decimal | number, unit: string) => `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${unit === 'LITRE' ? 'L' : unit.toLowerCase()}`;
export const stockLevel = (stock: number, capacity: number, threshold: number) =>
  stock <= 0 ? 'EMPTY' : stock / capacity * 100 <= threshold ? 'LOW' : 'HEALTHY';

export const ownerTankName = (code: string) => {
  const numbered = code.trim().match(/^(?:T|Tank)[\s-]*(\d+)$/i);
  return numbered ? `Tank ${Number(numbered[1])}` : code;
};
const ownerFuelName = (code: string) => code === 'MS' ? 'MS/Petrol' : code === 'HSD' ? 'HSD/Diesel' : code;
const dailyVolume = (quantity: Prisma.Decimal, unit: string) => `${Number(quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit === 'LITRE' ? 'L' : unit.toLowerCase()}`;
const openedDescription = (at: Date) => {
  const time = at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  const date = at.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  return `Opened at ${time} IST on ${date} and is still not closed.`;
};

export function coreDailyMessage(facts: Awaited<ReturnType<typeof readDailyOperatingFacts>>, date: string, appUrl: string) {
  const sales = facts.sales.map(row => `${ownerFuelName(row.product.code)}: ${dailyVolume(row.quantity, row.product.unit)}`).join(', ');
  const collected = facts.collections.actual;
  const stock = facts.tanks.map(tank => `${tank.station.name} · ${ownerFuelName(tank.product.code)} · ${ownerTankName(tank.code)}: ${tank.stockIssues?.length ? 'Stock history needs review — open inventory' : dailyVolume(tank.bookStock, tank.product.unit)}`);
  const open = facts.openShifts ?? [];
  const salesAwaitClosing = open.some(shift => shift.openedAt <= facts.period.end);
  return [
    `FuelNerve · Daily operating summary · ${date}`,
    `Sales: ${sales || (salesAwaitClosing ? 'Shift sales are awaiting closing' : 'No sales recorded for this date')}`,
    `Collections (reconciled shifts + counter sales): ${collected ? money(collected) : 'No verified collections recorded'}${facts.collections.incomplete ? ' · Some shifts are pending' : ''}`,
    ...(open.length ? ['Shifts still open:', ...open.map(shift => `${shift.station.name} · Shift #${shift.shiftNumber}: ${openedDescription(shift.openedAt)}`)] : []),
    `Tank book stock:\n${stock.join('\n') || 'No active tanks'}`,
    `Review: ${appUrl}/reports`,
  ].join('\n\n');
}

export function stockAlertMessage(facts: NonNullable<Awaited<ReturnType<typeof readTankAlertFacts>>>, threshold: number, appUrl: string) {
  const tank = facts.tank;
  const subject = `${tank.product.code} tank ${tank.code}`.slice(0, 160);
  const level = stockLevel(facts.bookStock.toNumber(), tank.workingCapacity.toNumber(), threshold);
  const description = level === 'EMPTY' ? 'No available book stock remains.' : `Stock is at or below the ${threshold}% alert threshold.`;
  return `FuelNerve Stock Agent · ${facts.station.name}\n${subject}: ${volume(facts.bookStock, tank.product.unit)} book stock. ${description}\n\nReview: ${appUrl}/inventory?tankId=${encodeURIComponent(tank.id)}`;
}

export function shiftMessage(facts: ShiftFacts, correction = false) {
  if (facts.completeness !== 'COMPLETE' || !facts.closedAt || !facts.collections) return null;
  const collections = facts.collections;
  const difference = collections.difference;
  const sales = facts.sales.map(row => `${row.product.code}: ${volume(row.quantity, row.product.unit)}`).join(' · ');
  const tanks = facts.tanks.map(tank => `${tank.product.code} ${tank.code}: ${volume(tank.physicalClosing!, tank.product.unit)} measured · ${volume(tank.bookClosing!, tank.product.unit)} book`);
  return [
    `FuelNerve Shift Agent · Shift #${facts.shiftNumber} ${correction ? 'correction' : 'reconciled'} · ${facts.station.name}`,
    `Sales: ${sales || 'No sales recorded'}`,
    `Expected collection: ${money(collections.adjustedExpected)}${collections.adjustedExpected.eq(collections.expected) ? '' : ' after adjustments'}`,
    `Actual collection: ${money(collections.actual)}`,
    ...(!difference.isZero() ? [`${difference.lt(0) ? 'Shortage' : 'Excess'}: ${money(difference.abs())}`] : []),
    ...(tanks.length ? ['Closing tank stock:', ...tanks] : []),
  ].join('\n');
}

export function isRecentReceipt(receivedAt: Date, now: Date) {
  const age = now.getTime() - receivedAt.getTime();
  return age >= 0 && age < 86_400_000;
}

export function receiptMessage(facts: ReceiptFacts, appUrl?: string) {
  if (!facts.lines.length || facts.lines.some(line => line.invalidTankMapping)) return null;
  const invoice = facts.invoice;
  const deliveryLines = facts.lines.map(line => `${line.product.code}: ${volume(line.quantity, line.product.unit)}${line.tank ? ` → Tank ${line.tank.code}` : ''}`);
  const shortfalls = invoice?.products.flatMap(product => {
    const received = facts.lines.filter(line => line.product.id === product.id)
      .reduce((total, line) => total.plus(line.quantity), new Prisma.Decimal(0));
    return received.lt(product.quantity)
      ? [`${product.code}: ${volume(received, product.unit)} received of ${volume(product.quantity, product.unit)} invoiced`]
      : [];
  }) ?? [];
  return [
    `FuelNerve Purchase Agent · Stock received · ${facts.station.name}`,
    `Supplier: ${facts.supplierName} · Received: ${facts.receivedDate ?? indiaDate(facts.receivedAt)}${facts.receivedDate ? ' · unloading time not recorded' : ''}`,
    ...deliveryLines,
    ...(shortfalls.length ? [`Partial receipt: ${shortfalls.join(' · ')}`] : []),
    ...(invoice ? [
      `Invoice ${invoice.number}: ${money(invoice.totalAmount)}`,
      invoice.outstanding.lte(0) ? 'Payment status: Paid in full' : `Outstanding: ${money(invoice.outstanding)} · Due: ${indiaDate(invoice.dueDate)}`,
    ] : ['Invoice and payment details are unavailable for this receipt.']),
    ...(appUrl ? ['', `Review: ${appUrl}/purchases${invoice ? `?invoiceId=${encodeURIComponent(invoice.id)}` : ''}`] : []),
  ].join('\n');
}

export function customerReminderDraft(facts: CreditFacts, stationName: string) {
  if (!facts.stationId || facts.completeness !== 'COMPLETE' || facts.hasDisputedBalance || facts.overdueAmount <= 0) return null;
  const overdue = facts.unpaid.filter(entry => (entry.daysOverdue ?? 0) > 0);
  const earliestDue = overdue.reduce((earliest, entry) => entry.dueDate && entry.dueDate < earliest ? entry.dueDate : earliest, facts.calculatedAt);
  return {
    customerId: facts.customerId, stationId: facts.stationId, overdueAmount: facts.overdueAmount,
    dueDate: indiaDate(earliestDue), sourceIds: overdue.map(entry => entry.id), status: 'DRAFT' as const,
    message: `Payment reminder from ${stationName}\nDear ${facts.customerName}, ${money(facts.overdueAmount)} is overdue on your fuel account. The earliest unpaid due date was ${indiaDate(earliestDue)}. Please contact ${stationName} if you have already paid or need to check the balance.`,
  };
}
