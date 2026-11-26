import { beforeEach, describe, expect, it, vi } from 'vitest';
const { receipts } = vi.hoisted(() => ({ receipts: vi.fn() }));
vi.mock('../src/modules/shifts/historical-receipts.js', () => ({ historicalTankReceipts: receipts }));
import { resolveOpeningTime, validateOpeningSequence } from '../src/modules/shifts/opening-time.js';
import { openShiftSchema } from '@fuelledger/shared';
const at = new Date('2026-11-25T06:00:00Z'), recorded = new Date('2026-11-26T06:00:00Z');
beforeEach(() => receipts.mockReset().mockResolvedValue([]));
describe('selected opening times', () => {
 it('keeps entry time separate from the requested operational start', () => {
  expect(resolveOpeningTime(undefined, recorded)).toEqual(recorded);
  expect(resolveOpeningTime('2026-11-25T11:30:00+05:30', recorded)).toEqual(at);
 });
 it('rejects future, invalid and timezone-free opening dates', () => {
  expect(() => resolveOpeningTime('2026-11-27T06:00:00Z', recorded)).toThrow(expect.objectContaining({ code: 'SHIFT_OPENING_IN_FUTURE' }));
  expect(() => resolveOpeningTime('invalid', recorded)).toThrow(expect.objectContaining({ code: 'SHIFT_OPENING_TIME_INVALID' }));
  expect(openShiftSchema.shape.openedAt.safeParse('2026-11-25T11:30').success).toBe(false);
 });
 it.each(['OPEN','LOCKED'])('rejects an overlapping %s shift in the same station', async status => {
  const findFirst = vi.fn().mockResolvedValue({ id: 'later', status });
  await expect(validateOpeningSequence({ shift: { findFirst } } as never, 'org', 'station', at)).rejects.toMatchObject({ code: status === 'OPEN' ? 'SHIFT_ALREADY_OPEN' : 'SHIFT_OPENING_OVERLAP' });
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ stationId: 'station', station: { organizationId: 'org' }, status: { notIn: ['CANCELLED','DRAFT'] } }) }));
 });
 it('requires a known receipt time for an intraday start but does not change Open now', async () => {
  receipts.mockResolvedValue([{ businessDate: '2026-11-25', quantity: { gt: () => true } }]);
  const db = { shift: { findFirst: vi.fn().mockResolvedValue(null) }, inventoryLedger: { findFirst: vi.fn().mockResolvedValue(null) } };
  await expect(validateOpeningSequence(db as never, 'org', 'station', at)).rejects.toMatchObject({ code: 'SHIFT_OPENING_RECEIPT_TIME_REQUIRED' });
  await expect(validateOpeningSequence(db as never, 'org', 'station', at, false)).resolves.toBeUndefined();
 });
});
