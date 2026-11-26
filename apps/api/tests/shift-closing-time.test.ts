import { describe, expect, it, vi } from 'vitest';
import { resolveClosingTime, validateClosingCutoff } from '../src/modules/shifts/closing-time.js';
import { closeShiftSchema } from '@fuelledger/shared';
const opening = new Date('2026-11-25T06:00:00Z'), now = new Date('2026-11-26T06:00:00Z');
describe('shift closing times', () => {
  it('defaults to submission time and accepts a past time with an explicit timezone', () => {
    expect(resolveClosingTime(opening, undefined, now)).toEqual(now);
    expect(resolveClosingTime(opening, '2026-11-25T22:00:00+05:30', now)).toEqual(new Date('2026-11-25T16:30:00Z'));
    expect(resolveClosingTime(opening, opening.toISOString(), now)).toEqual(opening);
  });
  it.each([
    ['2026-11-25T05:59:59Z','SHIFT_CLOSING_BEFORE_OPENING'],
    ['2026-11-26T06:00:01Z','SHIFT_CLOSING_IN_FUTURE'],
    ['invalid','SHIFT_CLOSING_TIME_INVALID'],
  ])('rejects %s on the server', (value, code) => {
    expect(() => resolveClosingTime(opening, value, now)).toThrow(expect.objectContaining({ code }));
  });
  it('rejects local time without an offset in the API schema', () => {
    expect(closeShiftSchema.shape.closedAt.safeParse('2026-11-25T18:00').success).toBe(false);
    expect(closeShiftSchema.shape.closedAt.safeParse('2026-11-25T18:00:00+05:30').success).toBe(true);
  });
  it('prevents stranding saved sales after the selected cutoff and scopes the lookup', async () => {
    const sale = vi.fn().mockResolvedValue({ id: 'sale' });
    const db = { sale: { findFirst: sale }, shift: { findFirst: vi.fn().mockResolvedValue(null) } };
    const at = new Date('2026-11-25T12:00:00Z');
    await expect(validateClosingCutoff(db as never, 'org', { id: 's', stationId: 'station', openedAt: opening }, at)).rejects.toMatchObject({ code: 'SHIFT_SALES_AFTER_CLOSING' });
    expect(sale).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org', shiftId: 's', occurredAt: { gt: at } } }));
  });
  it('rejects overlapping real shifts, while excluding cancelled shifts from the query', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'other' });
    await expect(validateClosingCutoff({ sale: { findFirst: vi.fn().mockResolvedValue(null) }, shift: { findFirst } } as never, 'org', { id: 's', stationId: 'station', openedAt: opening }, now)).rejects.toMatchObject({ code: 'SHIFT_CLOSING_OVERLAP' });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ stationId: 'station', status: { not: 'CANCELLED' }, id: { not: 's' } }) }));
  });
});
