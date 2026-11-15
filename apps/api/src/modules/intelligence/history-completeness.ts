import { addIndiaDays, indiaDate } from '../../lib/india-time.js';
import { prisma } from '../../lib/prisma.js';

type DailyRecord = {
  stationId: string;
  stationName: string;
  productId: string;
  productCode: string;
  date: string;
};

export type MissingDailyRecords = {
  stationId: string;
  stationName: string;
  productId: string;
  productCode: string;
  lastAvailableDate: string;
  missingFrom: string;
  missingThrough: string;
  missingDates: string[];
};

/**
 * Finds the trailing calendar gap after the latest trusted daily record.
 * A record dated today means the product is current; future-dated records are
 * deliberately ignored so they cannot conceal a real gap.
 */
export function findMissingDailyRecords(records: DailyRecord[], today: string): MissingDailyRecords[] {
  const latestByProduct = new Map<string, DailyRecord>();
  for (const record of records) {
    if (record.date > today) continue;
    const key = `${record.stationId}:${record.productId}`;
    const current = latestByProduct.get(key);
    if (!current || record.date > current.date) latestByProduct.set(key, record);
  }

  return [...latestByProduct.values()].flatMap(record => {
    if (record.date >= today) return [];
    const missingDates: string[] = [];
    for (let date = addIndiaDays(record.date, 1); date <= today; date = addIndiaDays(date, 1)) missingDates.push(date);
    return [{
      stationId: record.stationId,
      stationName: record.stationName,
      productId: record.productId,
      productCode: record.productCode,
      lastAvailableDate: record.date,
      missingFrom: missingDates[0]!,
      missingThrough: missingDates.at(-1)!,
      missingDates,
    }];
  }).sort((left, right) => right.missingDates.length - left.missingDates.length || left.stationName.localeCompare(right.stationName) || left.productCode.localeCompare(right.productCode));
}

export async function missingDailyRecords(
  organizationId: string,
  permittedStationIds?: string[],
  stationId?: string,
  now = new Date(),
) {
  const allowedStationIds = stationId ? [stationId] : permittedStationIds;
  const stationFilter = allowedStationIds?.length ? { in: allowedStationIds } : undefined;
  const [imports, sales] = await Promise.all([
    prisma.historicalSalesImport.findMany({
      where: { organizationId, ...(stationFilter ? { stationId: stationFilter } : {}) },
      select: {
        rows: true,
        stationId: true,
        productId: true,
        station: { select: { name: true } },
        product: { select: { code: true } },
      },
    }),
    prisma.sale.groupBy({
      by: ['stationId', 'productId'],
      where: { organizationId, ...(stationFilter ? { stationId: stationFilter } : {}), product: { category: 'FUEL', active: true } },
      _max: { occurredAt: true },
    }),
  ]);

  const records: DailyRecord[] = [];
  const labels = new Map<string, { stationName: string; productCode: string }>();
  for (const item of imports) {
    labels.set(`${item.stationId}:${item.productId}`, { stationName: item.station.name, productCode: item.product.code });
    if (!Array.isArray(item.rows)) continue;
    for (const row of item.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const date = (row as { date?: unknown }).date;
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) records.push({ stationId: item.stationId, stationName: item.station.name, productId: item.productId, productCode: item.product.code, date });
    }
  }

  const unlabeled = sales.filter(item => !labels.has(`${item.stationId}:${item.productId}`));
  if (unlabeled.length) {
    const [stations, products] = await Promise.all([
      prisma.station.findMany({ where: { organizationId, id: { in: [...new Set(unlabeled.map(item => item.stationId))] } }, select: { id: true, name: true } }),
      prisma.product.findMany({ where: { organizationId, id: { in: [...new Set(unlabeled.map(item => item.productId))] } }, select: { id: true, code: true } }),
    ]);
    const stationNames = new Map(stations.map(item => [item.id, item.name]));
    const productCodes = new Map(products.map(item => [item.id, item.code]));
    for (const item of unlabeled) labels.set(`${item.stationId}:${item.productId}`, { stationName: stationNames.get(item.stationId) ?? 'Fuel station', productCode: productCodes.get(item.productId) ?? 'Fuel' });
  }

  for (const item of sales) {
    if (!item._max.occurredAt) continue;
    const label = labels.get(`${item.stationId}:${item.productId}`)!;
    records.push({ stationId: item.stationId, stationName: label.stationName, productId: item.productId, productCode: label.productCode, date: indiaDate(item._max.occurredAt) });
  }
  return findMissingDailyRecords(records, indiaDate(now));
}
