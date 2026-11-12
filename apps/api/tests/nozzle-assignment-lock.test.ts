import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  station: { findFirst: vi.fn() },
  user: { count: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));

import { saveNozzleAssignments } from '../src/modules/access/service.js';

describe('nozzle assignment lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not let staff defaults rewrite an open shift assignment', async () => {
    db.station.findFirst.mockResolvedValue({
      configurations: [{ dispensers: [{ nozzles: [{ id: 'nozzle-1' }] }] }],
      shifts: [{
        id: 'shift-1',
        managerId: 'manager-1',
        users: [{ userId: 'staff-1' }],
      }],
    });

    await expect(
      saveNozzleAssignments('org-1', 'station-1', {
        assignments: [{ nozzleId: 'nozzle-1', userId: 'staff-1' }],
      }),
    ).rejects.toMatchObject({ code: 'NOZZLE_ASSIGNMENTS_LOCKED', status: 409 });
    expect(db.user.count).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
