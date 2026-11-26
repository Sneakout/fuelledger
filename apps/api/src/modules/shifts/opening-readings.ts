import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { HistoricalSalesRowInput } from '@fuelledger/shared';
import { indiaDate, indiaDayRange, indiaMonthStart } from '../../lib/india-time.js';

type Nozzle = { id: string; productId?: string; openingMeter: Prisma.Decimal.Value };
type Tank = { id: string; productId: string; openingStock: Prisma.Decimal.Value };
type Previous = { closedAt: Date | null; nozzleReadings: Array<{ nozzleId: string; closingMeter: Prisma.Decimal | null }> } | null;
export type OpeningReadings = {
  version: string;
  nozzles: Array<{ id: string; value: number; source: 'DSR' | 'PREVIOUS_SHIFT' | 'CONFIGURATION'; date: string | null }>;
  tanks: Array<{ id: string; value: number; date: string; registerId: string }>;
  blockingReason: string | null;
};

/** A morning DSR can start operations on its business date, never rewind a later live closing.
 * Its date is a business-day boundary, not an invented physical capture time. */
export async function openingReadings(db: Pick<Prisma.TransactionClient, 'historicalSalesImport' | 'sale'>,
  organizationId: string, stationId: string, tanks: Tank[], nozzles: Nozzle[], previous: Previous, at: Date): Promise<OpeningReadings> {
  const date = indiaDate(at), start = indiaDayRange(date).start;
  const result: OpeningReadings = {
    version: '', tanks: [], blockingReason: null,
    nozzles: nozzles.map(nozzle => {
      const prior = previous?.nozzleReadings.find(row => row.nozzleId === nozzle.id)?.closingMeter;
      return { id: nozzle.id, value: Number(prior ?? nozzle.openingMeter), source: prior != null ? 'PREVIOUS_SHIFT' : 'CONFIGURATION', date: null };
    }),
  };
  const registers = previous?.closedAt && previous.closedAt >= start ? [] : await db.historicalSalesImport.findMany({
    where: { organizationId, stationId, monthStart: { gte: indiaMonthStart(at), lte: at }, productId: { in: [...new Set(tanks.map(tank => tank.productId))] } },
    select: { id: true, productId: true, rows: true, updatedAt: true },
  });
  const versions: string[] = [];
  for (const register of registers) {
    const row = Array.isArray(register.rows) ? (register.rows as HistoricalSalesRowInput[]).find(row => row.date === date) : null;
    if (!row) continue;
    const productNozzles = nozzles.filter(nozzle => nozzle.productId === register.productId);
    const productTanks = tanks.filter(tank => tank.productId === register.productId);
    if (!productNozzles.length) continue;
    if (!Array.isArray(row.nozzleReadings) || !Array.isArray(row.tankReadings) ||
      productNozzles.some(nozzle => !row.nozzleReadings.some(reading => reading.nozzleId === nozzle.id && Number.isFinite(reading.meterReading) && reading.meterReading >= 0)) ||
      productTanks.some(tank => !row.tankReadings.some(reading => reading.tankId === tank.id && Number.isFinite(reading.calibration?.volumeLitres ?? reading.openingStock) && (reading.calibration?.volumeLitres ?? reading.openingStock) >= 0 && (!reading.calibration || reading.calibration.reviewConfirmed)))) {
      result.blockingReason = `The DSR for ${date} does not include verified readings for every active tank and nozzle of this product. Complete it before opening.`;
      continue;
    }
    for (const nozzle of productNozzles) {
      const target = result.nozzles.find(reading => reading.id === nozzle.id)!;
      const meter = row.nozzleReadings.find(reading => reading.nozzleId === nozzle.id)!.meterReading;
      const prior = previous?.nozzleReadings.find(reading => reading.nozzleId === nozzle.id)?.closingMeter;
      if (prior != null && meter < Number(prior) - 0.001)
        result.blockingReason = 'A DSR morning nozzle meter is below the previous shift’s closing meter. Review both readings before opening.';
      Object.assign(target, { value: meter, source: 'DSR', date });
    }
    result.tanks.push(...productTanks.map(tank => ({ id: tank.id, value: (() => { const reading = row.tankReadings.find(reading => reading.tankId === tank.id)!; return reading.calibration?.volumeLitres ?? reading.openingStock; })(), date, registerId: register.id })));
    versions.push(`${register.id}:${register.updatedAt.toISOString()}`);
    // Recorded sales after a morning baseline cannot also be recreated by closing
    // the same meters. Do not silently fall back to old configuration readings.
    const recorded = await db.sale.findFirst({ where: { organizationId, stationId, productId: register.productId, occurredAt: { gte: start, lte: at } }, select: { id: true } });
    if (recorded) result.blockingReason = `Sales are already recorded after the DSR morning readings on ${date}. Review those sales before using the same readings to open a shift.`;
  }
  result.nozzles.sort((a, b) => a.id.localeCompare(b.id));
  result.tanks.sort((a, b) => a.id.localeCompare(b.id));
  result.version = createHash('sha256').update(JSON.stringify([date, versions.sort(), result.nozzles, result.tanks])).digest('hex');
  return result;
}

export function savedOpeningSource(value: unknown): OpeningReadings | null {
  if (!value || typeof value !== 'object' || !('nozzles' in value) || !('tanks' in value)) return null;
  return value as OpeningReadings;
}
