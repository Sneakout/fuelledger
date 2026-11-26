import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { cancelShift, openShift, shiftOpeningPreview } from '../src/modules/shifts/service.js';
import { readLatestTankObservations } from '../src/lib/tank-observations.js';
const url = process.env.SHIFT_DSR_TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
suite('dated opening from confirmed DSRs in PostgreSQL', () => {
 afterAll(async () => { vi.useRealTimers(); await prisma.$disconnect(); });
 it('uses the selected day’s DSR, carries the preceding closing cash and preserves the actual entry time', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-26T06:00:00Z'));
  const org = await prisma.organization.create({ data: { name: 'Dated opening verification' } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Owner', email: `${org.id}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
  const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Station', code: 'S1', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
  const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
  const dispenser = await prisma.dispenser.create({ data: { configurationId: config.id, code: 'D1' } });
  const product = await prisma.product.create({ data: { organizationId: org.id, code: 'MS', name: 'Petrol', category: 'FUEL', unit: 'LITRE', tankLinked: true, meterLinked: true, sellingPrice: 100 } });
  const tank = await prisma.tank.create({ data: { configurationId: config.id, productId: product.id, code: 'T1', tankType: 'UNDERGROUND', dipMethod: 'MANUAL', nominalCapacity: 20000, workingCapacity: 19000, openingStock: 999 } });
  const nozzle = await prisma.nozzle.create({ data: { dispenserId: dispenser.id, productId: product.id, code: 'N1', openingMeter: 1000, tankMappings: { create: { tankId: tank.id } } } });
  const previous = await prisma.shift.create({ data: { stationId: station.id, configurationId: config.id, managerId: owner.id, shiftNumber: 1, status: 'LOCKED', openedAt: new Date('2026-11-24T06:00:00Z'), closedAt: new Date('2026-11-24T12:00:00Z'), openingCash: 0, closingCash: 50,
   tankReadings: { create: { tankId: tank.id, openingDip: 4600, closingDip: 4600 } }, nozzleReadings: { create: { nozzleId: nozzle.id, openingMeter: 19000, closingMeter: 19000 } } } });
  await prisma.historicalSalesImport.create({ data: { organizationId: org.id, stationId: station.id, productId: product.id, monthStart: new Date('2026-11-01'), sourceFileName: 'MS.pdf', sourceMimeType: 'application/pdf', sourceSize: 0, sourceContent: Buffer.from(''), sourceFingerprint: org.id, importedById: owner.id,
   rows: [ ['2026-11-25',5000,20000], ['2026-11-26',4500,20500] ].map(([date,stock,meter]) => ({ date, receiptQuantity: 0, testingQuantity: 0, tankReadings: [{ tankId: tank.id, openingStock: stock }], nozzleReadings: [{ nozzleId: nozzle.id, meterReading: meter }] })) } });
  await expect(shiftOpeningPreview(org.id, station.id, '2026-11-27T06:00:00Z')).rejects.toMatchObject({ code: 'SHIFT_OPENING_IN_FUTURE' });
  await expect(shiftOpeningPreview(org.id, station.id, '2026-11-24T10:00:00Z')).rejects.toMatchObject({ code: 'SHIFT_OPENING_OVERLAP' });
  await expect(shiftOpeningPreview('other-org', station.id, '2026-11-25T06:00:00Z')).rejects.toMatchObject({ code: 'STATION_NOT_FOUND' });
  const preview = await shiftOpeningPreview(org.id, station.id, '2026-11-25T06:00:00Z');
  const source = preview.station.openingReadings;
  expect(source.tanks[0]).toMatchObject({ value: 5000, date: '2026-11-25' });
  expect(source.nozzles[0]).toMatchObject({ value: 20000, source: 'DSR' });
  expect(Number(preview.station.lastClosing!.closingCash)).toBe(50);
  const shift = await openShift(org.id, { openedAt: '2026-11-25T06:00:00Z', openingReadingsVersion: source.version, stationId: station.id, managerId: owner.id, userIds: [owner.id], nozzleAssignments: [{ nozzleId: nozzle.id, userId: owner.id }], openingCash: 50, tankReadings: [{ id: tank.id, value: 5000 }], nozzleReadings: [{ id: nozzle.id, value: 20000 }] }, owner.id);
  expect(shift.openedAt).toEqual(new Date('2026-11-25T06:00:00Z'));
  expect(shift.openingTimeAudit).toMatchObject({ recordedAt: '2026-11-26T06:00:00.000Z', method: 'SELECTED', enteredById: owner.id });
  expect(shift.openingCashHandover).toMatchObject({ previousShiftId: previous.id, recordedAt: '2026-11-26T06:00:00.000Z', expectedOpening: '50.00' });
  const atOpening = await readLatestTankObservations(prisma, org.id, [{ id: tank.id, stationId: station.id, productId: product.id }], new Date('2026-11-25T07:00:00Z'));
  expect(atOpening.get(tank.id)).toMatchObject({ source: 'SHIFT_OPENING', precision: 'EXACT', volume: 5000, observedAt: '2026-11-25T06:00:00.000Z' });
  const current = await readLatestTankObservations(prisma, org.id, [{ id: tank.id, stationId: station.id, productId: product.id }]);
  expect(current.get(tank.id)).toMatchObject({ source: 'DSR', date: '2026-11-26', volume: 4500 });
  await cancelShift(org.id, owner.id, shift.id, 'Completed test of selected opening');
 }, 30000);
});
