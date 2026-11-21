import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  sale: { findMany: vi.fn() },
  tank: { findMany: vi.fn() },
  shift: { findMany: vi.fn(), findFirst: vi.fn() },
  purchaseReceipt: { findFirst: vi.fn() },
  customer: { findMany: vi.fn() },
}));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../src/lib/stock.js', () => ({ bookStockAt: vi.fn().mockResolvedValue({ toNumber: () => 250 }) }));

import { readCustomerCreditFacts, readDailyOperatingFacts, readReceiptMessageFacts, readShiftMessageFacts } from '../src/modules/notifications/message-facts.js';

const scope = { organizationId: 'org', stationId: 'station' };
const station = { id: 'station', name: 'Station' };
const asOf = new Date('2026-11-17T12:00:00Z');
const d = (value: number) => new Prisma.Decimal(value);
const lineProduct = { id: 'hsd', name: 'Diesel', code: 'HSD', unit: 'LITRE', tankLinked: true };

beforeEach(() => vi.clearAllMocks());

describe('verified notification facts', () => {
  it('keeps live quantities by unit and reports only reconciled collections', async () => {
    db.tank.findMany.mockResolvedValue([]);
    db.sale.findMany.mockResolvedValue([
      { id: 's1', shiftId: 'night', product: lineProduct, quantity: d(12.25), totalAmount: d(1200) },
      { id: 's2', shiftId: 'open', product: { ...lineProduct, id: 'oil', code: 'OIL', unit: 'PIECE' }, quantity: d(2), totalAmount: d(600) },
    ]);
    db.shift.findMany.mockResolvedValue([{ id: 'night', reconciliation: {
      id: 'r1', reconciledAt: asOf, collections: [{ paymentMethod: 'UPI', actualAmount: d(100) }, { paymentMethod: 'CREDIT', actualAmount: d(50) }],
    } }]);
    const result = await readDailyOperatingFacts(scope, '2026-11-17', asOf);
    expect(result.sales.map(row => [row.product.unit, row.quantity.toNumber()])).toEqual([['LITRE', 12.25], ['PIECE', 2]]);
    expect(result.collections).toMatchObject({ actual: d(100), reconciliationIds: ['r1'], incomplete: true });
    expect(db.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      station: { id: 'station', organizationId: 'org', active: true },
      closedAt: { gte: new Date('2026-11-16T18:30:00Z'), lte: asOf },
    } }));
  });

  it('preserves physical close and handover values while reconciliation is pending', async () => {
    db.shift.findFirst.mockResolvedValue({
      station, shiftNumber: 2, manager: {id:'m',name:'Manager',organizationId:'org'}, users:[{user:{id:'a',name:'Ashok',organizationId:'org'}},{user:{id:'foreign',name:'Foreign',organizationId:'other'}}], openedAt: new Date('2026-11-16T17:00:00Z'), closedAt: asOf, closingCash: d(150),
      sales: [], reconciliation: null, nozzleAssignments: [{ nozzleId: 'n1', collectionAmount: d(75), user:{id:'a',name:'Ashok',organizationId:'org'}, nozzle:{code:'N1',dispenser:{code:'D1'},product:{code:'HSD'}} }], nozzleReadings: [],
      tankReadings: [{ id: 'reading', tankId: 'tank', closingDip: d(245), tank: { id: 'tank', code: 'T2', productId: 'hsd', product: lineProduct } }],
    });
    const result = await readShiftMessageFacts(scope, 'shift', asOf);
    expect(result).toMatchObject({ completeness: 'INCOMPLETE', collections: null, physicalClosingCash: d(150), staffHandovers: [{ collectionAmount: d(75) }] });
    expect(result?.managerName).toBe('Manager');
    expect(result?.assignedStaff).toEqual([{name:'Ashok',nozzles:['D1/N1 · HSD']}]);
    expect(result?.tanks[0]?.physicalClosing?.toNumber()).toBe(245);
    expect(result?.tanks[0]?.bookClosing?.toNumber()).toBe(250);
  });

  it('uses actual receipt timing and flags a tank linked fuel line without a tank', async () => {
    const invoiceDate = new Date('2026-11-01T00:00:00Z');
    db.purchaseReceipt.findFirst.mockResolvedValue({
      station, stationId: station.id, receivedAt: asOf, supplierName: 'Supplier',
      invoice: { id: 'invoice', organizationId: 'org', stationId: station.id, status: 'OPEN', invoiceDate, totalAmount: d(100), payments: [] },
      lines: [{ id: 'line', product: lineProduct, productId: 'hsd', quantity: d(10), tankId: null, tank: null }],
    });
    const result = await readReceiptMessageFacts(scope, 'receipt', asOf);
    expect(result).toMatchObject({ completeness: 'INCOMPLETE', receivedAt: asOf, invoice: { invoiceDate, outstanding: d(100) }, lines: [{ invalidTankMapping: true }] });
  });

  it('applies partial payments and ages the remaining amount by Indian calendar day', async () => {
    const occurredAt = new Date('2026-11-15T12:00:00Z');
    db.customer.findMany.mockResolvedValue([{ id: 'customer', name: 'Fleet', ledger: [
      { id: 'debit', amount: d(100.25), occurredAt, dueDate: new Date('2026-11-16T17:00:00Z'), disputedAt: occurredAt },
      { id: 'payment', amount: d(-40), occurredAt: asOf, dueDate: null },
      { id: 'future', amount: d(-60.25), occurredAt: new Date('2026-11-18T00:00:00Z'), dueDate: null },
    ] }]);
    const [result] = await readCustomerCreditFacts(scope, asOf, 'customer');
    expect(result).toMatchObject({ outstanding: 60.25, overdueAmount: 60.25, oldestDaysOverdue: 1, hasDisputedBalance: true });
  });
});
