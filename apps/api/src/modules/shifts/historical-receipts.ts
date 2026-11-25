import { Prisma } from '@prisma/client';
import type { HistoricalSalesRowInput } from '@fuelledger/shared';
import { indiaDate, indiaDayRange } from '../../lib/india-time.js';

/** Read confirmed registers only. DSR receipt quantities are daily product totals,
 * so posted deliveries on the same day are components, never extra deliveries. */
export async function historicalTankReceipts(tx: Pick<Prisma.TransactionClient, 'historicalSalesImport' | 'inventoryLedger' | 'tank'>, organizationId: string, stationId: string) {
  const registers = await tx.historicalSalesImport.findMany({
    where: { organizationId, stationId, product: { organizationId, tankLinked: true } },
    select: { id: true, productId: true, rows: true, product: { select: { code: true, unit: true } } },
  });
  const dated = registers.flatMap(register => Array.isArray(register.rows) ? (register.rows as HistoricalSalesRowInput[]).flatMap(row => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row?.date ?? '') || !Number.isFinite(row.receiptQuantity) || row.receiptQuantity <= 0 || row.date > indiaDate() || !Array.isArray(row.tankReadings)) return [];
    try { return [{ register, row, at: indiaDayRange(row.date).start }]; } catch { return []; }
  }) : []);
  if (!dated.length) return [];
  const dates = dated.map(item => item.row.date).sort();
  const [posted, tanks] = await Promise.all([
    tx.inventoryLedger.findMany({ where: { organizationId, stationId, type: 'RECEIPT', tankId: { not: null },
      productId: { in: [...new Set(dated.map(item => item.register.productId))] },
      occurredAt: { gte: indiaDayRange(dates[0]!).start, lt: indiaDayRange(dates.at(-1)!).endExclusive } },
      select: { productId: true, occurredAt: true, quantityDelta: true } }),
    tx.tank.findMany({ where: { configuration: { stationId, station: { organizationId } }, product: { organizationId } },
      select: { id: true, code: true, productId: true } }),
  ]);
  const totals = new Map<string, Prisma.Decimal>();
  for (const movement of posted) {
    const key = `${movement.productId}:${indiaDate(movement.occurredAt)}`;
    totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).add(movement.quantityDelta));
  }
  return dated.flatMap(({ register, row, at }) => {
    const declared = new Prisma.Decimal(row.receiptQuantity);
    const postedQuantity = totals.get(`${register.productId}:${row.date}`) ?? new Prisma.Decimal(0);
    // Fully represented receipts already appear with their precise purchase times.
    if (postedQuantity.sub(declared).abs().lte('.001')) return [];
    const remaining = Prisma.Decimal.max(0, declared.sub(postedQuantity));
    const ids = [...new Set(row.tankReadings.map(reading => reading.tankId))];
    const tank = ids.length === 1 ? tanks.find(item => item.id === ids[0] && item.productId === register.productId) : null;
    return [{
      id: `dsr:${register.id}:${row.date}`, source: 'DSR' as const, importId: register.id, businessDate: row.date, sourceUrl: `/sales/history/import?stationId=${encodeURIComponent(stationId)}&productId=${encodeURIComponent(register.productId)}&month=${row.date.slice(0,7)}`,
      quantity: remaining, dsrQuantity: declared, postedQuantity,
      occurredAt: at, reference: 'Confirmed historical DSR', supplier: null,
      recordedLate: false, correctedLate: false, previousShift: null,
      period: 'DATE_ONLY' as const, shiftId: null, shiftNumber: null, tankInShift: null,
      tankId: tank?.id ?? null, productId: register.productId, tank: tank?.code ?? null, product: register.product.code, unit: register.product.unit,
      receiptScopeMismatch: false, timingMismatch: false,
      allocationRequired: !tank, overlapMismatch: postedQuantity.gt(declared),
    }];
  });
}
