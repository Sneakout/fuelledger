import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  shift: { findMany: vi.fn(), count: vi.fn() },
  sale: { count: vi.fn(), groupBy: vi.fn() },
  nozzleAttendantAssignment: { count: vi.fn() },
  shiftNozzleAssignment: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));

import { deactivateStaff, staffDeactivationCheck } from '../src/modules/access/service.js';

describe('staff deactivation safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.user.findFirst.mockResolvedValue({ id: 'staff-1', name: 'Ravi', role: 'STAFF' });
    db.shift.findMany.mockResolvedValue([]);
    db.shift.count.mockResolvedValue(8);
    db.sale.count.mockResolvedValue(42);
    db.nozzleAttendantAssignment.count.mockResolvedValue(1);
    db.shiftNozzleAssignment.findMany.mockResolvedValue([]);
    db.sale.groupBy.mockResolvedValue([]);
  });

  it('blocks deactivation while the attendant belongs to an open shift', async () => {
    db.shift.findMany.mockResolvedValue([
      { id: 'shift-1', shiftNumber: 12, station: { id: 'station-1', name: 'Saleema Petroleum' } },
    ]);

    await expect(deactivateStaff('org-1', 'staff-1', true)).rejects.toMatchObject({
      code: 'STAFF_DEACTIVATION_BLOCKED',
      status: 409,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('reports an unresolved attendant handover before deactivation', async () => {
    db.shiftNozzleAssignment.findMany.mockResolvedValue([
      {
        shiftId: 'shift-2',
        nozzleId: 'nozzle-1',
        collectionAmount: '850',
        shift: { shiftNumber: 11, station: { id: 'station-1', name: 'Saleema Petroleum' } },
      },
    ]);
    db.sale.groupBy.mockResolvedValue([
      { shiftId: 'shift-2', nozzleId: 'nozzle-1', _sum: { totalAmount: '1000' } },
    ]);

    const check = await staffDeactivationCheck('org-1', 'staff-1');

    expect(check.canDeactivate).toBe(false);
    expect(check.possibleAmountDue).toBe(150);
    expect(check.blockers.join(' ')).toMatch(/₹150.*unresolved/i);
  });

  it('deactivates without deleting historical shifts, sales or assignments', async () => {
    const tx = {
      nozzleAttendantAssignment: { deleteMany: vi.fn() },
      userSession: { deleteMany: vi.fn() },
      user: { update: vi.fn() },
    };
    db.$transaction.mockImplementation(async (work) => work(tx));

    const result = await deactivateStaff('org-1', 'staff-1', true);

    expect(tx.nozzleAttendantAssignment.deleteMany).toHaveBeenCalledWith({ where: { userId: 'staff-1' } });
    expect(tx.userSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'staff-1' } });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { active: false, loginEnabled: false },
    });
    expect(result).toMatchObject({ active: false, historyPreserved: true, clearedDefaultNozzles: 1 });
    expect(tx).not.toHaveProperty('shift');
    expect(tx).not.toHaveProperty('sale');
    expect(tx).not.toHaveProperty('shiftNozzleAssignment');
  });
});
