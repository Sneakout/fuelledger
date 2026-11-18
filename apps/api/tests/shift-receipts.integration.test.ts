import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { tankOpeningBalances } from '../src/lib/stock.js';
import { createInvoice, updateInvoice } from '../src/modules/purchases/service.js';
import { bootstrap, closeShift, openShift, shiftDetails } from '../src/modules/shifts/service.js';
import { tankReceiptHistory } from '../src/modules/shifts/receipt-history.js';

const url = process.env.SHIFT_RECEIPTS_TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
const time = (hour: number) => new Date(Date.UTC(2025, 8, 6, hour));

suite('shift receipt timeline against isolated PostgreSQL', () => {
  afterAll(() => prisma.$disconnect());

  it('assigns MS and HSD deliveries once, recalculates after correction and preserves recorded dips and journals', async () => {
    const { id: organizationId } = await prisma.organization.create({ data: { name: 'Shift receipt verification' } });
    const owner = await prisma.user.create({ data: { organizationId, name: 'Owner', email: `${organizationId}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
    const stationData = { organizationId, addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' };
    const station = await prisma.station.create({ data: { ...stationData, name: 'First station', code: 'S1' } });
    const other = await prisma.station.create({ data: { ...stationData, name: 'Second station', code: 'S2' } });
    const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const otherConfig = await prisma.stationConfiguration.create({ data: { stationId: other.id, version: 1 } });
    const tankData = { nominalCapacity: 20000, workingCapacity: 19000, openingStock: 1000, tankType: 'UNDERGROUND' as const, dipMethod: 'MANUAL' as const };
    const [ms, hsd] = await Promise.all(['MS', 'HSD'].map(code => prisma.product.create({ data: { organizationId, code, name: code, category: 'FUEL', unit: 'LITRE', inventoryTracked: true, tankLinked: true } })));
    const [msTank, hsdTank, otherTank] = await Promise.all([
      prisma.tank.create({ data: { ...tankData, configurationId: config.id, productId: ms!.id, code: 'T1' } }),
      prisma.tank.create({ data: { ...tankData, configurationId: config.id, productId: hsd!.id, code: 'T2' } }),
      prisma.tank.create({ data: { ...tankData, configurationId: otherConfig.id, productId: ms!.id, code: 'T1' } }),
    ]);
    const tankIds = [msTank.id, hsdTank.id];
    const first = await prisma.shift.create({ data: { stationId: station.id, configurationId: config.id, managerId: owner.id, shiftNumber: 1, openedAt: time(6), closedAt: time(10), status: 'LOCKED', openingCash: 0, tankReadings: { create: tankIds.map(tankId => ({ tankId, openingDip: 1100, closingDip: 1200 })) } } });
    const second = await prisma.shift.create({ data: { stationId: station.id, configurationId: config.id, managerId: owner.id, shiftNumber: 2, openedAt: time(12), closedAt: time(16), status: 'LOCKED', openingCash: 0, tankReadings: { create: tankIds.map(tankId => ({ tankId, openingDip: 1500, closingDip: 1500 })) } } });
    const supplier = await prisma.supplier.create({ data: { organizationId, name: 'Supplier', code: 'OIL' } });
    const invoice = async (reference: string, hour: number, quantity: number) =>
      createInvoice(organizationId, owner.id, {
        stationId: station.id, supplierId: supplier.id, invoiceNumber: reference, invoiceDate: '2025-09-01', dueDate: '2025-09-01', taxAmount: 0,
        receiveNow: true, paidNow: false, receivedAt: time(hour).toISOString(), receiptTimingReason: 'Verified physical receipt time',
        lines: [msTank, hsdTank].map(tank => ({ productId: tank.productId, tankId: tank.id, description: tank.code, quantity, unitCost: 10, taxRate: 0 })),
      });
    await invoice('PRE', 5, 100);
    const correction = await invoice('CLOSE', 10, 300);
    await invoice('OPEN', 12, 70);
    await invoice('DURING', 13, 80);
    await invoice('NEXT', 16, 190);
    await prisma.inventoryLedger.create({ data: { organizationId, stationId: other.id, productId: msTank.productId, tankId: otherTank.id, type: 'RECEIPT', quantityDelta: 900, occurredAt: time(10) } });
    await prisma.inventoryLedger.createMany({ data: [msTank, hsdTank].map(tank => ({
      organizationId, stationId: station.id, productId: tank.productId, tankId: tank.id, type: 'ADJUSTMENT', quantityDelta: -5, note: 'Nozzle testing not returned · D1 / N1 · shift #1', occurredAt: time(10),
    })) });

    const source = [msTank, hsdTank].map(tank => ({ ...tank, stationId: station.id }));
    const previous = await prisma.shift.findUniqueOrThrow({ where: { id: first.id }, include: { tankReadings: true } });
    const opening = await tankOpeningBalances(prisma, organizationId, source, time(12), previous);
    expect([...opening.values()].map(row => [Number(row.received), Number(row.expectedOpening)])).toEqual([[300, 1500], [300, 1500]]);
    const firstReview = await shiftDetails(organizationId, first.id);
    expect(firstReview.openingStockReview.map(row => Number(row.expectedOpening))).toEqual([1100, 1100]);
    expect(firstReview.tankReadings.map(row => Number(row.stockBridge?.received))).toEqual([0, 0]);
    expect(firstReview.tankReadings.map(row => Number(row.stockBridge?.postedTestingLoss))).toEqual([5, 5]);
    const secondReview = await shiftDetails(organizationId, second.id);
    expect(secondReview.tankReadings.map(row => Number(row.stockBridge?.received))).toEqual([150, 150]);

    const history = await tankReceiptHistory(organizationId, station.id);
    expect(history.receipts.map(row => [row.reference, row.period, row.shiftNumber])).toEqual([
      ['NEXT', 'GAP', null], ['NEXT', 'GAP', null], ['DURING', 'DURING', 2], ['DURING', 'DURING', 2],
      ['OPEN', 'DURING', 2], ['OPEN', 'DURING', 2], ['CLOSE', 'GAP', 2], ['CLOSE', 'GAP', 2], ['PRE', 'BEFORE_FIRST', 1], ['PRE', 'BEFORE_FIRST', 1],
    ]);
    expect(new Set(history.receipts.map(row => row.id)).size).toBe(10);
    expect((await tankReceiptHistory(organizationId, other.id)).receipts).toHaveLength(1);
    await expect(tankReceiptHistory(organizationId, other.id, history.receipts[0]!.id)).rejects.toMatchObject({ code: 'RECEIPT_CURSOR_INVALID' });
    const journalBefore = await prisma.journal.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, include: { lines: true } });
    const dipsBefore = await prisma.shiftTankReading.findMany({ where: { shiftId: { in: [first.id, second.id] } }, orderBy: { id: 'asc' } });

    await updateInvoice(organizationId, owner.id, correction.id, {
      version: correction.version, invoiceNumber: 'CLOSE', invoiceDate: '2025-09-01', dueDate: '2025-09-01',
      refreshPrices: false, markPaid: false, correctionReason: 'Verified arrival was before the first shift closed', receivedAt: time(9).toISOString(),
    });
    const corrected = await tankReceiptHistory(organizationId, station.id);
    expect(corrected.receipts).toHaveLength(10);
    expect(corrected.receipts.filter(row => row.reference === 'CLOSE').map(row => [row.shiftNumber, row.period, row.correctedLate])).toEqual([[1, 'DURING', true], [1, 'DURING', true]]);
    expect((await shiftDetails(organizationId, first.id)).tankReadings.map(row => Number(row.stockBridge?.received))).toEqual([300, 300]);
    expect((await shiftDetails(organizationId, second.id)).openingStockReview.map(row => [Number(row.expectedOpening), Number(row.actual)])).toEqual([[1200, 1500], [1200, 1500]]);
    const workspace = await bootstrap(organizationId, [station.id]);
    expect(workspace.stations).toHaveLength(1);
    expect(workspace.stations[0]!.availableTankStock.map(row => [Number(row.received), Number(row.expectedOpening)])).toEqual([[190, 1690], [190, 1690]]);
    expect(await prisma.shiftTankReading.findMany({ where: { shiftId: { in: [first.id, second.id] } }, orderBy: { id: 'asc' } })).toEqual(dipsBefore);
    expect(await prisma.journal.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, include: { lines: true } })).toEqual(journalBefore);

    await updateInvoice(organizationId, owner.id, correction.id, {
      version: correction.version + 1, invoiceNumber: 'CLOSE', invoiceDate: '2025-09-01', dueDate: '2025-09-01',
      refreshPrices: false, markPaid: false, correctionReason: 'Corrected against delivery timestamp', receivedAt: time(10).toISOString(),
    });
    const movedBack = (await tankReceiptHistory(organizationId, station.id)).receipts.filter(row => row.reference === 'CLOSE');
    expect(movedBack.map(row => [row.period, row.shiftNumber, row.previousShift?.number])).toEqual([['GAP', 2, 1], ['GAP', 2, 1]]);
    const rechecked = await shiftDetails(organizationId, first.id);
    expect(rechecked.tankReadings.map(row => Number(row.stockBridge?.received))).toEqual([0, 0]);
    expect(rechecked.receiptTimingChanges).toEqual([expect.objectContaining({ previousReceivedAt: time(9), receivedAt: time(10) })]);

    const active = await openShift(organizationId, {
      stationId: station.id, managerId: owner.id, userIds: [owner.id], openingCash: 0,
      tankReadings: tankIds.map(id => ({ id, value: 1690 })), nozzleReadings: [], nozzleAssignments: [],
    });
    await createInvoice(organizationId, owner.id, {
      stationId: station.id, supplierId: supplier.id, invoiceNumber: 'LIVE', invoiceDate: '2025-09-01', dueDate: '2025-09-01',
      taxAmount: 0, receiveNow: true, paidNow: false,
      lines: [msTank, hsdTank].map(tank => ({ productId: tank.productId, tankId: tank.id, description: tank.code, quantity: 50, unitCost: 10, taxRate: 0 })),
    });
    const activeReview = await shiftDetails(organizationId, active.id);
    expect(activeReview.tankReadings.map(row => [Number(row.openingDip), Number(row.stockBridge?.received)])).toEqual([[1690, 50], [1690, 50]]);
    expect((await tankReceiptHistory(organizationId, station.id)).receipts.filter(row => row.reference === 'LIVE').map(row => row.shiftNumber)).toEqual([3, 3]);
    await closeShift(organizationId, active.id, {
      closingCash: 0, tankReadings: tankIds.map(id => ({ id, value: 1740 })), nozzleReadings: [], nozzleCollections: [],
    });
    const closed = await shiftDetails(organizationId, active.id);
    expect(closed.tankReadings.map(row => [Number(row.openingDip), Number(row.stockBridge?.received), Number(row.closingDip)])).toEqual([[1690, 50, 1740], [1690, 50, 1740]]);

    await prisma.inventoryLedger.createMany({ data: Array.from({ length: 22 }, () => ({
      organizationId, stationId: other.id, productId: msTank.productId, tankId: otherTank.id, type: 'RECEIPT', quantityDelta: 1, occurredAt: time(10),
    })) });
    const firstPage = await tankReceiptHistory(organizationId, other.id);
    const secondPage = await tankReceiptHistory(organizationId, other.id, firstPage.nextCursor!);
    expect(firstPage.receipts).toHaveLength(20);
    expect(secondPage.receipts).toHaveLength(3);
    expect(new Set([...firstPage.receipts, ...secondPage.receipts].map(row => row.id)).size).toBe(23);
  });
});
