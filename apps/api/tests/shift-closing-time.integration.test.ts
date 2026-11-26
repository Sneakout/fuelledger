import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { bootstrap, closeShift, openShift, shiftClosingPreview } from '../src/modules/shifts/service.js';
import { reconcile } from '../src/modules/reconciliation/service.js';
import { readShiftMessageFacts } from '../src/modules/notifications/message-facts.js';
import { shiftAtInstant } from '../src/lib/shift-interval.js';
const url = process.env.SHIFT_DSR_TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
suite('backdated shift closing in isolated PostgreSQL', () => {
  afterAll(async () => { vi.useRealTimers(); await prisma.$disconnect(); });
  it('uses the selected cutoff for receipts, sales, testing, journals and the next handover, preserving entry time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-25T06:00:00Z'));
    const org = await prisma.organization.create({ data: { name: 'Closing time verification' } });
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Owner', email: `${org.id}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
    const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Station', code: 'S1', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const dispenser = await prisma.dispenser.create({ data: { configurationId: config.id, code: 'D1' } });
    const product = await prisma.product.create({ data: { organizationId: org.id, code: 'MS', name: 'Petrol', category: 'FUEL', unit: 'LITRE', tankLinked: true, meterLinked: true, sellingPrice: 100, purchasePrice: 90 } });
    const tank = await prisma.tank.create({ data: { configurationId: config.id, productId: product.id, code: 'T1', tankType: 'UNDERGROUND', dipMethod: 'MANUAL', nominalCapacity: 20000, workingCapacity: 19000, openingStock: 10000 } });
    const nozzle = await prisma.nozzle.create({ data: { dispenserId: dispenser.id, productId: product.id, code: 'N1', openingMeter: 1000, tankMappings: { create: { tankId: tank.id } } } });
    const shift = await openShift(org.id, { stationId: station.id, managerId: owner.id, userIds: [owner.id], nozzleAssignments: [{ nozzleId: nozzle.id, userId: owner.id }], openingCash: 0, tankReadings: [{ id: tank.id, value: 10000 }], nozzleReadings: [{ id: nozzle.id, value: 1000 }] }, owner.id);
    const selected = new Date('2026-11-25T12:00:00Z');
    await prisma.inventoryLedger.createMany({ data: [
      { organizationId: org.id, stationId: station.id, productId: product.id, tankId: tank.id, type: 'RECEIPT', quantityDelta: 500, occurredAt: new Date('2026-11-25T08:00:00Z') },
      { organizationId: org.id, stationId: station.id, productId: product.id, tankId: tank.id, type: 'RECEIPT', quantityDelta: 2000, occurredAt: new Date('2026-11-25T13:00:00Z') },
    ] });
    vi.setSystemTime(new Date('2026-11-26T06:00:00Z'));
    const input = { closedAt: selected.toISOString(), closingCash: 9500, tankReadings: [{ id: tank.id, value: 10400 }], nozzleReadings: [{ id: nozzle.id, value: 1100, testingQuantity: 5, testingReturned: false }], nozzleCollections: [{ nozzleId: nozzle.id, amount: 9500 }] };
    await expect(closeShift(org.id, shift.id, { ...input, closedAt: '2026-11-25T05:00:00Z' }, owner.id)).rejects.toMatchObject({ code: 'SHIFT_CLOSING_BEFORE_OPENING' });
    await expect(closeShift(org.id, shift.id, { ...input, closedAt: '2026-11-27T06:00:00Z' }, owner.id)).rejects.toMatchObject({ code: 'SHIFT_CLOSING_IN_FUTURE' });
    const afterSale = await prisma.sale.create({ data: { organizationId: org.id, stationId: station.id, productId: product.id, shiftId: shift.id, employeeId: owner.id, tankId: tank.id, nozzleId: nozzle.id, kind: 'METERED', paymentMethod: 'OTHER', quantity: 1, unitPrice: 100, totalAmount: 100, occurredAt: new Date('2026-11-25T13:00:00Z') } });
    await expect(closeShift(org.id, shift.id, input, owner.id)).rejects.toMatchObject({ code: 'SHIFT_SALES_AFTER_CLOSING' });
    await prisma.sale.delete({ where: { id: afterSale.id } });
    const preview = await shiftClosingPreview(org.id, shift.id, selected.toISOString());
    expect(Number(preview.shift.tankReadings[0].stockBridge.received)).toBe(500);
    expect(preview.closingAt).toEqual(selected);
    const closed = await closeShift(org.id, shift.id, input, owner.id);
    expect(closed.closedAt).toEqual(selected);
    expect(closed.closingTimeAudit).toEqual({ recordedAt: '2026-11-26T06:00:00.000Z', enteredById: owner.id, method: 'SELECTED', closedAt: selected.toISOString() });
    const sales = await prisma.sale.findMany({ where: { shiftId: shift.id } });
    expect(sales).toHaveLength(1); expect(Number(sales[0]!.quantity)).toBe(95); expect(sales[0]!.occurredAt).toEqual(selected);
    const postings = await prisma.inventoryLedger.findMany({ where: { organizationId: org.id, type: { in: ['SALE', 'ADJUSTMENT'] } } });
    expect(postings).toHaveLength(2); expect(postings.every(post => post.occurredAt.getTime() === selected.getTime())).toBe(true);
    expect(postings.map(post => Number(post.quantityDelta)).sort((a,b) => a-b)).toEqual([-95, -5]);
    const journals = await prisma.journal.findMany({ where: { organizationId: org.id } });
    expect(journals).toHaveLength(2); expect(journals.every(journal => journal.journalDate.getTime() === selected.getTime())).toBe(true);
    expect(await shiftAtInstant(prisma, org.id, station.id, new Date('2026-11-25T13:00:00Z'))).toBeNull();
    const next = (await bootstrap(org.id)).stations[0]!;
    expect(Number(next.availableTankStock[0]!.expectedOpening)).toBe(12400);
    expect(Number(next.lastClosing!.nozzleReadings[0]!.value)).toBe(1100);
    await expect(closeShift(org.id, shift.id, input, owner.id)).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' });
    expect(await prisma.sale.count({ where: { shiftId: shift.id } })).toBe(1);
    await reconcile(org.id, owner.id, shift.id, {
      collections: (['CASH','UPI','CARD','CREDIT','FLEET','OTHER'] as const).map(paymentMethod => ({ paymentMethod,
        adjustmentAmount: paymentMethod === 'CASH' ? 9500 : paymentMethod === 'OTHER' ? -9500 : 0,
        actualAmount: paymentMethod === 'CASH' ? 9500 : 0, adjustmentReason: 'Verified payment split' })), creditAllocations: [],
    });
    const allocated = await prisma.journal.findFirst({ where: { organizationId: org.id, sourceType: 'SHIFT_RECONCILIATION' } });
    expect(allocated!.journalDate).toEqual(selected);
    const reconciliation = await prisma.shiftReconciliation.findUniqueOrThrow({ where: { shiftId: shift.id } });
    const facts = await readShiftMessageFacts({ organizationId: org.id, stationId: station.id }, shift.id, new Date(Math.max(Date.now(), reconciliation.reconciledAt.getTime() + 1)));
    expect(facts).toMatchObject({ openedAt: new Date('2026-11-25T06:00:00Z'), closedAt: selected, closingRecordedAt: new Date('2026-11-26T06:00:00Z'), completeness: 'COMPLETE' });
  }, 30000);
});
