import { describe, expect, it, vi } from 'vitest';
import { openingReadings } from '../src/modules/shifts/opening-readings.js';
import { Prisma } from '@prisma/client';
const at = new Date('2026-11-25T06:00:00Z');
const tanks = [{ id: 'tank', productId: 'MS', openingStock: 999 }];
const nozzles = [{ id: 'nozzle', productId: 'MS', openingMeter: 12627 }];
const register = (date = '2026-11-25', meter = 20000) => ({ id: 'register', productId: 'MS', updatedAt: at,
  rows: [{ date, tankReadings: [{ tankId: 'tank', openingStock: 5000 }], nozzleReadings: [{ nozzleId: 'nozzle', meterReading: meter }] }] });
const db = (records = [register()]) => ({ historicalSalesImport: { findMany: vi.fn().mockResolvedValue(records) }, sale: { findFirst: vi.fn().mockResolvedValue(null) } });
describe('DSR morning shift openings', () => {
  it('selects today’s confirmed morning instead of stale configuration or an earlier closing', async () => {
    const reader = db();
    const result = await openingReadings(reader as never, 'org', 'station', tanks, nozzles,
      { closedAt: new Date('2026-11-24T10:00:00Z'), nozzleReadings: [{ nozzleId: 'nozzle', closingMeter: new Prisma.Decimal(15000) }] }, at);
    expect(result.nozzles[0]).toMatchObject({ value: 20000, source: 'DSR', date: '2026-11-25' });
    expect(result.tanks[0]).toMatchObject({ value: 5000, registerId: 'register' });
    expect(reader.historicalSalesImport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', stationId: 'station' }) }));
  });
  it('never rewinds a later same-day shift closing', async () => {
    const reader = db();
    const result = await openingReadings(reader as never, 'org', 'station', tanks, nozzles,
      { closedAt: new Date('2026-11-25T04:00:00Z'), nozzleReadings: [{ nozzleId: 'nozzle', closingMeter: new Prisma.Decimal(21000) }] }, at);
    expect(result.nozzles[0]).toMatchObject({ value: 21000, source: 'PREVIOUS_SHIFT' });
    expect(result.tanks).toEqual([]);
    expect(reader.historicalSalesImport.findMany).not.toHaveBeenCalled();
  });
  it('does not silently use an old or future DSR as today’s opening', async () => {
    const result = await openingReadings(db([register('2026-11-24'), register('2026-11-26')]) as never, 'org', 'station', tanks, nozzles, null, at);
    expect(result.nozzles[0]).toMatchObject({ value: 12627, source: 'CONFIGURATION' });
    expect(result.tanks).toEqual([]);
  });
  it('blocks partial equipment coverage and already recorded morning sales', async () => {
    const partial = await openingReadings(db() as never, 'org', 'station', tanks, [...nozzles, { ...nozzles[0]!, id: 'missing' }], null, at);
    expect(partial.blockingReason).toMatch(/every active tank and nozzle/);
    const reader = db(); reader.sale.findFirst.mockResolvedValue({ id: 'recorded' });
    const result = await openingReadings(reader as never, 'org', 'station', tanks, nozzles, null, at);
    expect(result.blockingReason).toMatch(/Sales are already recorded/);
  });
  it('blocks a later DSR meter that reverses an earlier live closing', async () => {
    const result = await openingReadings(db() as never, 'org', 'station', tanks, nozzles, { closedAt: new Date('2026-11-24T12:00:00Z'), nozzleReadings: [{ nozzleId: 'nozzle', closingMeter: new Prisma.Decimal(21000) }] }, at);
    expect(result.blockingReason).toMatch(/below the previous shift/);
  });
  it('changes the review version when a saved DSR reading is corrected', async () => {
    const first = await openingReadings(db() as never, 'org', 'station', tanks, nozzles, null, at);
    const corrected = await openingReadings(db([register('2026-11-25', 20100)]) as never, 'org', 'station', tanks, nozzles, null, at);
    expect(first.version).not.toBe(corrected.version);
  });
});
