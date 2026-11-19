import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import type { OpenShiftInput } from '@fuelledger/shared';
import { cashHandoverSnapshot } from '../src/modules/shifts/cash-handover.js';

const now = new Date('2026-11-19T06:00:00Z');
const previous = { id: 'previous-shift', closingCash: new Prisma.Decimal('1000.25') };
const input = (actual: number, added = 0, removed = 0, reason?: string): OpenShiftInput => ({
  stationId: 'station', managerId: 'manager', userIds: ['manager'], nozzleAssignments: [], tankReadings: [], nozzleReadings: [],
  openingCash: actual,
  cashHandover: { previousShiftId: previous.id, previousClosingCash: 1000.25, added, removed, reason },
});

describe('physical cash handover', () => {
  it('preserves previous cash and records the actor without a money movement', () => {
    expect(cashHandoverSnapshot(input(1000.25), previous, 'owner', now)).toMatchObject({
      previousClosingCash: '1000.25', expectedOpening: '1000.25', actualOpening: '1000.25', difference: '0.00', enteredById: 'owner', recordedAt: now.toISOString(),
    });
  });
  it('calculates decimal additions and withdrawals exactly and keeps shortages visible', () => {
    expect(cashHandoverSnapshot(input(200.2, 0.1, 800.1, 'Cash handed to owner; count short'), previous, 'owner', now)).toMatchObject({ expectedOpening: '200.25', actualOpening: '200.20', difference: '-0.05' });
    expect(cashHandoverSnapshot(input(1001.25, 0, 0, 'Extra cash found'), previous, 'owner', now).difference).toBe('1.00');
  });
  it('requires reasons for removals, additions and differences even from older clients', () => {
    for (const row of [input(1000.25, 10, 10), input(0), { ...input(0), cashHandover: undefined }])
      expect(() => cashHandoverSnapshot(row, previous, 'owner', now)).toThrow(/reason/);
  });
  it('rejects stale or cross-station previous shift references', () => {
    expect(() => cashHandoverSnapshot(input(1000.25), { ...previous, id: 'another-station-shift' }, 'owner', now)).toThrow(/changed/);
    expect(() => cashHandoverSnapshot(input(1000.25), { ...previous, closingCash: new Prisma.Decimal(1200) }, 'owner', now)).toThrow(/changed/);
  });
  it('does not treat a missing prior count as zero and allows a first-shift counted float', () => {
    expect(cashHandoverSnapshot({ ...input(500), cashHandover: undefined }, null, 'owner', now)).toMatchObject({ previousClosingCash: null, expectedOpening: null, actualOpening: '500.00', difference: null });
    const missing = { ...input(500), cashHandover: { previousShiftId: previous.id, previousClosingCash: null, added: 0, removed: 0 } };
    expect(() => cashHandoverSnapshot(missing, { ...previous, closingCash: null }, 'owner', now)).toThrow(/reason/);
  });
  it('rejects impossible withdrawals, non-finite numbers and fractional paise', () => {
    for (const row of [input(0, 0, 2000, 'Owner withdrawal'), input(1.001), input(NaN), input(Infinity), input(-1)])
      expect(() => cashHandoverSnapshot(row, previous, 'owner', now)).toThrow();
  });
});
