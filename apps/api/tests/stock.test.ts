import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { assertStockAvailable, bookStockAt, tankBookStocksAt } from '../src/lib/stock.js';

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
      { stationId, productId: 'fuel', tankId: stationId + '-tank', type: 'RECEIPT', quantityDelta: d(100), occurredAt: new Date('2026-01-01'), product: { tankLinked: true }, tank: { productId: 'fuel', configuration: { stationId } } },
      ...Array.from({ length: 100 }, () => ({ stationId, productId: 'fuel', tankId: stationId + '-tank', type: 'SALE', quantityDelta: d(-1), occurredAt: new Date('2026-01-03'), product: { tankLinked: true }, tank: { productId: 'fuel', configuration: { stationId } } })),
      { stationId, productId: 'lube', tankId: null, type: 'RECEIPT', quantityDelta: d(stationId === 'a' ? 200 : 300), occurredAt: readingAt, product: { tankLinked: false }, tank: null },
      ...Array.from({ length: 100 }, () => ({ stationId, productId: 'lube', tankId: null, type: 'SALE', quantityDelta: d(-1), occurredAt: readingAt, product: { tankLinked: false }, tank: null })),
      { stationId, productId: 'lube', tankId: null, type: 'ADJUSTMENT', quantityDelta: d(-2), occurredAt: readingAt, product: { tankLinked: false }, tank: null },
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

describe('authoritative stock timeline', () => {
  it('uses only movements up to the requested time and keeps the complete scope', async () => {
    const at = new Date('2026-09-06T08:30:00.000Z');
    const aggregate = vi.fn().mockResolvedValue({ _sum: { quantityDelta: d(250) } });
    const tx = {
      tank: { findFirst: vi.fn().mockResolvedValue({ openingStock: d(8000) }) },
      inventoryLedger: { aggregate },
    } as unknown as Prisma.TransactionClient;
    await expect(bookStockAt(tx, { organizationId: 'org', stationId: 'station-a', productId: 'ms', tankId: 'tank-a' }, at)).resolves.toEqual(d(8250));
    expect(aggregate).toHaveBeenCalledWith({
      where: { organizationId: 'org', stationId: 'station-a', productId: 'ms', tankId: 'tank-a', occurredAt: { lte: at } },
      _sum: { quantityDelta: true },
    });
  });

  it('builds isolated balances for multiple fuel stations and rejects a mismatched ledger scope', async () => {
    const at = new Date('2026-09-06T08:30:00.000Z');
    const groupBy = vi.fn().mockResolvedValue([
      { tankId: 'tank-a', stationId: 'station-a', productId: 'ms', _sum: { quantityDelta: d(500) } },
      { tankId: 'tank-b', stationId: 'station-b', productId: 'hsd', _sum: { quantityDelta: d(-250) } },
    ]);
    const reader = { inventoryLedger: { groupBy } } as unknown as Pick<Prisma.TransactionClient, 'inventoryLedger'>;
    const balances = await tankBookStocksAt(reader, 'org', [
      { id: 'tank-a', stationId: 'station-a', productId: 'ms', openingStock: 8000 },
      { id: 'tank-b', stationId: 'station-b', productId: 'hsd', openingStock: 9000 },
    ], at);
    expect(balances.get('tank-a')).toEqual(d(8500));
    expect(balances.get('tank-b')).toEqual(d(8750));
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['tankId', 'stationId', 'productId'],
      where: { organizationId: 'org', tankId: { in: ['tank-a', 'tank-b'] }, occurredAt: { lte: at } },
    }));

    groupBy.mockResolvedValueOnce([
      { tankId: 'tank-a', stationId: 'station-b', productId: 'ms', _sum: { quantityDelta: d(1) } },
    ]);
    await expect(tankBookStocksAt(reader, 'org', [
      { id: 'tank-a', stationId: 'station-a', productId: 'ms', openingStock: 8000 },
    ], at)).rejects.toMatchObject({ code: 'STOCK_SCOPE_INVALID' });
  });
});
