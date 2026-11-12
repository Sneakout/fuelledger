import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    station: { findMany: vi.fn(), findFirst: vi.fn() },
    sale: { findMany: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));

import { buildSalesHistory } from '../src/modules/reports/service.js';

describe('sales history RSP valuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.station.findMany.mockResolvedValue([]);
  });

  it('values litres sold using the RSP recorded on each sale', async () => {
    db.sale.findMany.mockResolvedValue([
      {
        occurredAt: new Date('2026-11-12T06:30:00.000Z'),
        quantity: 10,
        unitPrice: 110,
        totalAmount: 999,
        product: { id: 'ms', name: 'Motor Spirit', code: 'MS', unit: 'LITRE' },
      },
      {
        occurredAt: new Date('2026-11-12T07:30:00.000Z'),
        quantity: 5,
        unitPrice: 112,
        totalAmount: 999,
        product: { id: 'ms', name: 'Motor Spirit', code: 'MS', unit: 'LITRE' },
      },
    ]);

    const result = await buildSalesHistory('org', {
      startDate: '2026-11-12',
      endDate: '2026-11-12',
    });

    expect(result.daily).toEqual([
      expect.objectContaining({ quantity: 15, revenue: 1660, transactions: 2 }),
    ]);
    expect(result.summary).toEqual({ quantity: 15, revenue: 1660, transactions: 2 });
  });
});
