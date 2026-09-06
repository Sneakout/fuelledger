import { describe, expect, it, vi } from 'vitest';
import { affectsClosedShift, shiftAtInstant } from '../src/lib/shift-interval.js';

describe('shift receipt intervals', () => {
  it('uses a half-open interval so a delivery at closing belongs to the next boundary', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { shift: { findMany } } as any;
    const at = new Date('2026-09-06T10:00:00.000Z');
    expect(await shiftAtInstant(db, 'org', 'station', at)).toBeNull();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ openedAt: { lte: at }, OR: [{ closedAt: null }, { closedAt: { gt: at } }] }) }));
  });

  it('identifies a backdated receipt inside a closed shift', async () => {
    const shift = { id: 'shift', shiftNumber: 4, status: 'LOCKED', openedAt: new Date('2026-09-06T06:00:00.000Z'), closedAt: new Date('2026-09-06T10:00:00.000Z') };
    const result = await shiftAtInstant({ shift: { findMany: vi.fn().mockResolvedValue([shift]) } } as any, 'org', 'station', new Date('2026-09-06T08:00:00.000Z'));
    expect(result).toEqual(shift);
    expect(affectsClosedShift(result)).toBe(true);
  });

  it('rejects overlapping shifts instead of assigning one receipt twice', async () => {
    const shifts = [{ id: 'a' }, { id: 'b' }];
    await expect(shiftAtInstant({ shift: { findMany: vi.fn().mockResolvedValue(shifts) } } as any, 'org', 'station', new Date())).rejects.toMatchObject({ code: 'SHIFT_INTERVAL_OVERLAP' });
  });
});
