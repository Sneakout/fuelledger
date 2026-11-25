import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { bootstrap, cancelShift, closeShift, openShift, shiftDetails } from '../src/modules/shifts/service.js';
import { shiftAtInstant } from '../src/lib/shift-interval.js';
import { readLatestTankObservations } from '../src/lib/tank-observations.js';
import { indiaDayRange } from '../src/lib/india-time.js';
const url = process.env.SHIFT_DSR_TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;

suite('cancel and replace a shift from confirmed DSR mornings in PostgreSQL', () => {
  afterAll(async () => { vi.useRealTimers(); await prisma.$disconnect(); });
  it('preserves history, uses all tank/nozzle baselines, deduplicates receipts and captures closing sales once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-25T06:00:00Z'));
    const org = await prisma.organization.create({ data: { name: 'DSR replacement verification' } });
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Owner', email: `${org.id}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
    const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Station', code: 'S1', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const dispenser = await prisma.dispenser.create({ data: { configurationId: config.id, code: 'D1' } });
    const equipment = await Promise.all(['MS', 'HSD'].map(async (code, index) => {
      const product = await prisma.product.create({ data: { organizationId: org.id, code, name: code, category: 'FUEL', unit: 'LITRE', tankLinked: true, meterLinked: true, sellingPrice: 100, purchasePrice: 90 } });
      const tank = await prisma.tank.create({ data: { configurationId: config.id, productId: product.id, code: `T${index + 1}`, tankType: 'UNDERGROUND', dipMethod: 'MANUAL', nominalCapacity: 20000, workingCapacity: 19000, openingStock: 999 } });
      const nozzle = await prisma.nozzle.create({ data: { dispenserId: dispenser.id, productId: product.id, code: `N${index + 1}`, openingMeter: 12627, tankMappings: { create: { tankId: tank.id } } } });
      const row = { date: '2026-11-25', tankReadings: [{ tankId: tank.id, openingStock: 5000 + index * 1000 }], nozzleReadings: [{ nozzleId: nozzle.id, meterReading: 20000 + index * 10000 }], receiptQuantity: index === 0 ? 1000 : 0, testingQuantity: 0 };
      const register = await prisma.historicalSalesImport.create({ data: { organizationId: org.id, stationId: station.id, productId: product.id, monthStart: new Date('2026-11-01'), sourceFileName: `${code}.pdf`, sourceMimeType: 'application/pdf', sourceSize: 0, sourceContent: Buffer.from(''), sourceFingerprint: `${org.id}:${code}`, importedById: owner.id, rows: [row] } });
      return { product, tank, nozzle, register, row };
    }));
    const mistaken = await prisma.shift.create({ data: { stationId: station.id, configurationId: config.id, managerId: owner.id, shiftNumber: 1, openedAt: new Date('2026-11-24T13:03:00Z'), openingCash: 0, status: 'OPEN', users: { create: { userId: owner.id } }, tankReadings: { create: equipment.map(({ tank }) => ({ tankId: tank.id, openingDip: 999 })) }, nozzleReadings: { create: equipment.map(({ nozzle }) => ({ nozzleId: nozzle.id, openingMeter: 12627 })) } } });
    await cancelShift(org.id, owner.id, mistaken.id, 'Opened before the latest DSR was entered');
    expect(await prisma.shift.findUnique({ where: { id: mistaken.id } })).toMatchObject({ status: 'CANCELLED', closedAt: null, cancellation: expect.objectContaining({ cancelledById: owner.id }) });
    expect(await prisma.sale.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.inventoryLedger.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.journal.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.nerveReviewJob.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await shiftAtInstant(prisma, org.id, station.id, new Date())).toBeNull();
    const observations = await readLatestTankObservations(prisma, org.id, equipment.map(({ tank, product }) => ({ id: tank.id, stationId: station.id, productId: product.id })));
    expect([...observations.values()].every(row => row.source === 'DSR' && row.precision === 'MORNING')).toBe(true);
    const workspace = await bootstrap(org.id);
    expect(workspace.shifts).toHaveLength(0);
    expect(workspace.cancelledShifts).toHaveLength(1);
    const source = workspace.stations[0]!.openingReadings;
    const input = { stationId: station.id, managerId: owner.id, userIds: [owner.id], nozzleAssignments: equipment.map(({ nozzle }) => ({ nozzleId: nozzle.id, userId: owner.id })), openingCash: 0,
      tankReadings: source.tanks.map(({ id, value }) => ({ id, value })), nozzleReadings: source.nozzles.map(({ id, value }) => ({ id, value })), openingReadingsVersion: source.version };
    const changed = equipment[0]!;
    await prisma.historicalSalesImport.update({ where: { id: changed.register.id }, data: { rows: [{ ...changed.row, nozzleReadings: [{ nozzleId: changed.nozzle.id, meterReading: 20100 }] }] } });
    await expect(openShift(org.id, input, owner.id)).rejects.toMatchObject({ code: 'OPENING_SOURCE_CHANGED' });
    const refreshed = (await bootstrap(org.id)).stations[0]!.openingReadings;
    const replacement = await openShift(org.id, { ...input, openingReadingsVersion: refreshed.version, nozzleReadings: refreshed.nozzles.map(({ id, value }) => ({ id, value })) }, owner.id);
    expect(replacement.shiftNumber).toBe(2);
    expect(replacement.nozzleReadings.map((row: any) => Number(row.openingMeter)).sort()).toEqual([20100, 30000]);
    const ms = equipment[0]!;
    await prisma.inventoryLedger.create({ data: { organizationId: org.id, stationId: station.id, tankId: ms.tank.id, productId: ms.product.id, type: 'RECEIPT', quantityDelta: 400, occurredAt: new Date('2026-11-25T04:00:00Z') } });
    const detail = await shiftDetails(org.id, replacement.id);
    expect(Number(detail.openingStockReview.find(row => row.code === ms.tank.code)!.expectedOpening)).toBe(5000);
    expect(Number(detail.tankReadings.find((row: any) => row.tankId === ms.tank.id)!.stockBridge.received)).toBe(1000);
    const reused = await readLatestTankObservations(prisma, org.id, [{ id: ms.tank.id, stationId: station.id, productId: ms.product.id }]);
    expect(reused.get(ms.tank.id)).toMatchObject({ source: 'DSR', observedAt: null, volume: 5000 });
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    const closing = { closingCash: 0, tankReadings: equipment.map(({ tank }) => ({ id: tank.id, value: 5900 })), nozzleReadings: refreshed.nozzles.map(({ id, value }) => ({ id, value: value + 100, testingQuantity: 0, testingReturned: true })), nozzleCollections: equipment.map(({ nozzle }) => ({ nozzleId: nozzle.id, amount: 10000 })) };
    await expect(closeShift(org.id, replacement.id, { ...closing, nozzleReadings: refreshed.nozzles.map(({ id, value }) => ({ id, value: value + 7000, testingQuantity: 0, testingReturned: true })) })).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
    expect(await prisma.sale.count({ where: { shiftId: replacement.id } })).toBe(0);
    await closeShift(org.id, replacement.id, closing);
    expect(await prisma.sale.findMany({ where: { shiftId: replacement.id }, select: { quantity: true } })).toEqual([{ quantity: expect.anything() }, { quantity: expect.anything() }]);
    expect((await prisma.sale.findMany({ where: { shiftId: replacement.id } })).map(row => Number(row.quantity))).toEqual([100, 100]);
    await expect(closeShift(org.id, replacement.id, closing)).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' });
    await expect(cancelShift(org.id, owner.id, replacement.id, 'Already operated')).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' });
    // Once tomorrow's DSR confirms the same daily sales/receipts, live components
    // remain components of that day, not additional consumption or receipts.
    for (const item of equipment) {
      const meter = refreshed.nozzles.find(row => row.id === item.nozzle.id)!.value;
      await prisma.historicalSalesImport.update({ where: { id: item.register.id }, data: { rows: [{ ...item.row, nozzleReadings: [{ nozzleId: item.nozzle.id, meterReading: meter }] }, { ...item.row, date: '2026-11-26', receiptQuantity: 0, tankReadings: [{ tankId: item.tank.id, openingStock: 5900 }], nozzleReadings: [{ nozzleId: item.nozzle.id, meterReading: meter + 100 }] }] } });
    }
    vi.setSystemTime(new Date('2026-11-26T06:00:00Z'));
    const next = await bootstrap(org.id);
    expect(next.stations[0]!.openingReadings.nozzles.every(row => row.source === 'DSR')).toBe(true);
    expect(next.stations[0]!.availableTankStock.map(row => Number(row.value))).toEqual([5900, 5900]);
  }, 30000);
});
