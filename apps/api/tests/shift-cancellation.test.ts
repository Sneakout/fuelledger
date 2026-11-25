import { beforeEach, describe, expect, it, vi } from 'vitest';
const { db } = vi.hoisted(() => ({ db: { $transaction: vi.fn() } }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));
import { cancelShift } from '../src/modules/shifts/service.js';
const empty = () => ({ id: 'shift', shiftNumber: 1, status: 'OPEN', closedAt: null, closingCash: null,
  _count: { sales: 0 }, reconciliation: null, tankReadings: [{ closingDip: null }], nozzleReadings: [{ closingMeter: null, testingQuantity: 0 }], nozzleAssignments: [{ collectionAmount: null }] });
let tx: any;
beforeEach(() => {
  tx = { user: { findFirst: vi.fn().mockResolvedValue({ id: 'owner', name: 'Owner' }) }, shift: { findFirst: vi.fn().mockResolvedValue(empty()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  db.$transaction.mockImplementation(async work => work(tx));
});
describe('mistaken shift cancellation', () => {
  it('keeps an audited cancellation without closing or deleting a shift', async () => {
    expect(await cancelShift('org', 'owner', 'shift', 'Opened using old readings')).toMatchObject({ status: 'CANCELLED', shiftNumber: 1 });
    expect(tx.shift.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'shift', station: { organizationId: 'org' } } }));
    expect(tx.shift.updateMany).toHaveBeenCalledWith({ where: { id: 'shift', status: 'OPEN' }, data: { status: 'CANCELLED', cancellation: expect.objectContaining({ reason: 'Opened using old readings', cancelledById: 'owner', cancelledAt: expect.any(String) }) } });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('allows only the organization’s active owner', async () => {
    tx.user.findFirst.mockResolvedValue(null);
    await expect(cancelShift('org', 'staff', 'shift', 'Opened by mistake')).rejects.toMatchObject({ status: 403 });
    expect(tx.shift.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    { _count: { sales: 1 } }, { reconciliation: { id: 'reconciliation' } }, { closingCash: 0 },
    { tankReadings: [{ closingDip: 0 }] }, { nozzleReadings: [{ closingMeter: 0, testingQuantity: 0 }] },
    { nozzleReadings: [{ closingMeter: null, testingQuantity: 5 }] }, { nozzleAssignments: [{ collectionAmount: 0 }] },
  ])('rejects saved activity, including zero-valued saved counts: %j', async activity => {
    tx.shift.findFirst.mockResolvedValue({ ...empty(), ...activity });
    await expect(cancelShift('org', 'owner', 'shift', 'Opened by mistake')).rejects.toMatchObject({ code: 'SHIFT_HAS_ACTIVITY' });
    expect(tx.shift.updateMany).not.toHaveBeenCalled();
  });
  it('rejects closing/cancellation races', async () => {
    tx.shift.updateMany.mockResolvedValue({ count: 0 });
    await expect(cancelShift('org', 'owner', 'shift', 'Opened by mistake')).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' });
  });
});
