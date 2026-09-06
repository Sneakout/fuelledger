import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { assertStockAvailable } from '../src/lib/stock.js';

const db = vi.hoisted(() => ({ station: { findMany: vi.fn() }, product: { findMany: vi.fn() }, inventoryLedger: { findMany: vi.fn() }, purchaseReceipt: { findMany: vi.fn() } }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));
const d = (n: number) => new Prisma.Decimal(n);

describe('inventory balances', () => {
  it('uses all movements across stations and compares physical stock at the reading time', async () => {
    const { bootstrap } = await import('../src/modules/inventory/service.js');
    const product = { id: 'fuel', name: 'Fuel', code: 'MS', unit: 'LITRE', category: 'FUEL' };
    const readingAt = new Date('2026-01-02');
    db.station.findMany.mockResolvedValue(['a', 'b'].map(id => ({ id, name: id, configurations: [{ tanks: [{ id: id + '-tank', code: 'T1', openingStock: d(1000), product, physicalReadings: [{ physicalStock: d(1100), dipReading: null, recordedAt: readingAt }], densityReadings: [] }] }] })));
    db.product.findMany.mockResolvedValue([{ id: 'lube', name: 'Oil', unit: 'PIECE', tankLinked: false }]);
    const entries = ['a', 'b'].flatMap(stationId => [
      { stationId, productId: 'fuel', tankId: stationId + '-tank', type: 'RECEIPT', quantityDelta: d(100), occurredAt: new Date('2026-01-01') },
      ...Array.from({ length: 100 }, () => ({ stationId, productId: 'fuel', tankId: stationId + '-tank', type: 'SALE', quantityDelta: d(-1), occurredAt: new Date('2026-01-03') })),
      { stationId, productId: 'lube', tankId: null, type: 'RECEIPT', quantityDelta: d(stationId === 'a' ? 200 : 300), occurredAt: readingAt },
      ...Array.from({ length: 100 }, () => ({ stationId, productId: 'lube', tankId: null, type: 'SALE', quantityDelta: d(-1), occurredAt: readingAt })),
      { stationId, productId: 'lube', tankId: null, type: 'ADJUSTMENT', quantityDelta: d(-2), occurredAt: readingAt },
    ]);
    db.inventoryLedger.findMany.mockImplementation(async (args) => args.take ? entries.slice(-args.take) : entries);
    db.purchaseReceipt.findMany.mockResolvedValue([]);
    const result = await bootstrap('org', ['a', 'b']);
    expect(result.ledger).toHaveLength(80);
    expect(result.tanks.map(row => row.bookStock)).toEqual([1000, 1000]);
    expect(result.tanks.map(row => row.bookStockAtReading)).toEqual([1100, 1100]);
    expect(result.tanks.map(row => row.variance)).toEqual([0, 0]);
    expect(result.untanked.map(row => row.bookStock)).toEqual([98, 198]);
    expect(db.inventoryLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', stationId: { in: ['a', 'b'] } }), select: expect.any(Object) }));
  });
});

describe('stock deduction guard', () => {
  it('includes tank opening stock and allows exact depletion', async () => {
    const tx = { tank: { findFirst: vi.fn().mockResolvedValue({ openingStock: d(100) }) }, inventoryLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantityDelta: d(-20) } }) } };
    await expect(assertStockAvailable(tx as unknown as Prisma.TransactionClient, { organizationId: 'o', stationId: 's', productId: 'p', tankId: 't' }, 80)).resolves.toBeUndefined();
    await expect(assertStockAvailable(tx as unknown as Prisma.TransactionClient, { organizationId: 'o', stationId: 's', productId: 'p', tankId: 't' }, 81)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });
  it('isolates packaged stock and explains missing receipts', async () => {
    const aggregate = vi.fn().mockResolvedValue({ _sum: { quantityDelta: null } });
    const tx = { inventoryLedger: { aggregate } } as unknown as Prisma.TransactionClient;
    await expect(assertStockAvailable(tx, { organizationId: 'o', stationId: 's', productId: 'oil' }, 1)).rejects.toThrow('missing delivery');
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'o', stationId: 's', productId: 'oil', tankId: null, occurredAt: { lte: expect.any(Date) } }) }));
  });
});
