import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { db } = vi.hoisted(() => ({
  db: {
    station: { findMany: vi.fn(), findFirst: vi.fn() },
    sale: { findMany: vi.fn() },
    historicalSalesImport: { findMany: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));

import { buildSalesHistory } from '../src/modules/reports/service.js';

describe('sales history RSP valuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.station.findMany.mockResolvedValue([]);
    db.historicalSalesImport.findMany.mockResolvedValue([]);
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

  it('uses the product price effective on the DSR date when the imported RSP is zero', async () => {
    db.sale.findMany.mockResolvedValue([]);
    db.historicalSalesImport.findMany.mockResolvedValue([{
      rows: [{ date: '2026-11-12', tankReadings: [{ tankId: 'tank', openingStock: 1000 }], receiptQuantity: 0, nozzleReadings: [{ nozzleId: 'nozzle', meterReading: 1000 }], testingQuantity: 0, salesQuantity: 100, sellingPrice: 0 }],
      product: {
        id: 'hsd', name: 'High Speed Diesel', code: 'HSD', unit: 'LITRE', sellingPrice: new Prisma.Decimal(110),
        sellingPriceHistory: [
          { price: new Prisma.Decimal(110), effectiveFrom: new Date('2026-11-15T00:00:00.000Z') },
          { price: new Prisma.Decimal(96), effectiveFrom: new Date('2026-11-01T00:00:00.000Z') },
        ],
      },
    }]);

    const result = await buildSalesHistory('org', { startDate: '2026-11-12', endDate: '2026-11-12' });

    expect(result.daily).toEqual([expect.objectContaining({ quantity: 100, revenue: 9600, source: 'HISTORICAL_IMPORT' })]);
    expect(result.summary).toEqual({ quantity: 100, revenue: 9600, transactions: 1 });
  });

  it('carries a user-recorded RSP forward until a later explicit change', async () => {
    db.sale.findMany.mockResolvedValue([]);
    db.historicalSalesImport.findMany.mockResolvedValue([{
      rows: [
        { date: '2026-11-01', tankReadings: [], receiptQuantity: 0, nozzleReadings: [], testingQuantity: 0, salesQuantity: 100, sellingPrice: 96 },
        { date: '2026-11-02', tankReadings: [], receiptQuantity: 0, nozzleReadings: [], testingQuantity: 0, salesQuantity: 50, sellingPrice: 0 },
        { date: '2026-11-03', tankReadings: [], receiptQuantity: 0, nozzleReadings: [], testingQuantity: 0, salesQuantity: 25, sellingPrice: 98 },
        { date: '2026-11-04', tankReadings: [], receiptQuantity: 0, nozzleReadings: [], testingQuantity: 0, salesQuantity: 10, sellingPrice: 0 },
      ],
      product: { id: 'hsd', name: 'High Speed Diesel', code: 'HSD', unit: 'LITRE', sellingPrice: new Prisma.Decimal(0), sellingPriceHistory: [] },
    }]);

    const result = await buildSalesHistory('org', { startDate: '2026-11-01', endDate: '2026-11-04' });

    expect(result.daily.map(row => row.revenue)).toEqual([9600, 4800, 2450, 980]);
    expect(result.summary.revenue).toBe(17830);
  });
});
