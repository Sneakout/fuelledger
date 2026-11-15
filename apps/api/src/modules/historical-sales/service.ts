import { Prisma, type HistoricalSalesImport } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { HistoricalSalesImportInput, HistoricalSalesRowInput } from '@fuelledger/shared';
import { AppError } from '../../lib/errors.js';
import { indiaDayRange } from '../../lib/india-time.js';
import { prisma } from '../../lib/prisma.js';
import { calibrateDip, MASTER_20KL_UG_CALIBRATION } from '@fuelledger/shared';

const n = (value: unknown) => Number(value ?? 0);
const tolerance = 2;

export type HistoricalImportIssue = {
  date: string;
  level: 'WARNING' | 'ERROR';
  field: string;
  message: string;
};

export function validateHistoricalRows(rows: HistoricalSalesRowInput[]): HistoricalImportIssue[] {
  const sorted = [...rows].sort((left, right) => left.date.localeCompare(right.date));
  const issues: HistoricalImportIssue[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]!;
    const next = sorted[index + 1];
    if (row.totalStock !== undefined) {
      const expected = row.tankReadings.reduce((sum, reading) => sum + reading.openingStock, 0) + row.receiptQuantity;
      if (Math.abs(expected - row.totalStock) > tolerance) issues.push({ date: row.date, level: 'WARNING', field: 'totalStock', message: `Opening stock plus receipts is ${expected.toFixed(1)} L, not ${row.totalStock.toFixed(1)} L.` });
    }
    if (index > 0 && row.cumulativeSales !== undefined) {
      const previous = sorted[index - 1]!;
      if (previous.cumulativeSales !== undefined) {
        const expected = previous.cumulativeSales + row.salesQuantity;
        if (Math.abs(expected - row.cumulativeSales) > tolerance) issues.push({ date: row.date, level: 'WARNING', field: 'cumulativeSales', message: `Cumulative sales should continue near ${expected.toFixed(1)} L.` });
      }
    }
    if (!next) continue;
    const currentMeters = new Map(row.nozzleReadings.map(reading => [reading.nozzleId, reading.meterReading]));
    let movement = 0;
    for (const reading of next.nozzleReadings) {
      const current = currentMeters.get(reading.nozzleId);
      if (current === undefined) continue;
      if (reading.meterReading < current) issues.push({ date: next.date, level: 'ERROR', field: 'nozzleReadings', message: 'A nozzle meter reading moves backwards.' });
      else movement += reading.meterReading - current;
    }
    const calculatedSales = Math.max(0, movement - row.testingQuantity);
    if (Math.abs(calculatedSales - row.salesQuantity) > tolerance) issues.push({ date: row.date, level: 'WARNING', field: 'salesQuantity', message: `Meter movement less testing gives ${calculatedSales.toFixed(1)} L, not ${row.salesQuantity.toFixed(1)} L.` });
  }
  return issues;
}

async function equipment(organizationId: string, stationId: string, productId: string) {
  const station = await prisma.station.findFirst({
    where: { id: stationId, organizationId, active: true },
    select: {
      id: true, name: true,
      configurations: { where: { active: true }, take: 1, orderBy: { version: 'desc' }, select: {
        tanks: { where: { productId, status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { id: true, code: true, nominalCapacity: true, workingCapacity: true, openingStock: true, tankType: true } },
        dispensers: { where: { status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { code: true, nozzles: { where: { productId, status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { id: true, code: true, openingMeter: true } } } },
      } },
    },
  });
  const product = await prisma.product.findFirst({ where: { id: productId, organizationId, active: true, category: 'FUEL', tankLinked: true, meterLinked: true }, select: { id: true, name: true, code: true, sellingPrice: true } });
  if (!station || !product || !station.configurations[0]) throw new AppError(404, 'HISTORICAL_IMPORT_SETUP_NOT_FOUND', 'Choose a configured fuel station and an active metered fuel product.');
  const configuration = station.configurations[0];
  const nozzles = configuration.dispensers.flatMap(dispenser => dispenser.nozzles.map(nozzle => ({ ...nozzle, dispenserCode: dispenser.code })));
  if (!configuration.tanks.length || !nozzles.length) throw new AppError(409, 'HISTORICAL_IMPORT_EQUIPMENT_MISSING', 'This product needs at least one active tank and nozzle before its history can be imported.');
  return { station, product, tanks: configuration.tanks, nozzles };
}

export async function historicalImportSetup(organizationId: string, stationId: string) {
  const products = await prisma.product.findMany({
    where: { organizationId, active: true, category: 'FUEL', tankLinked: true, meterLinked: true, tanks: { some: { configuration: { stationId, active: true }, status: 'ACTIVE' } }, nozzles: { some: { dispenser: { configuration: { stationId, active: true } }, status: 'ACTIVE' } } },
    select: { id: true, name: true, code: true, sellingPrice: true }, orderBy: { code: 'asc' },
  });
  const details = await Promise.all(products.map(product => equipment(organizationId, stationId, product.id)));
  return { products: details.map(({ product, tanks, nozzles }) => ({ product, tanks, nozzles })) };
}

export async function listHistoricalImports(organizationId: string, stationId: string) {
  return prisma.historicalSalesImport.findMany({ where: { organizationId, stationId }, select: { id: true, monthStart: true, sourceFileName: true, cutoverApplied: true, createdAt: true, product: { select: { name: true, code: true } }, importedBy: { select: { name: true } } }, orderBy: { monthStart: 'desc' } });
}

export async function historicalImportSource(organizationId: string, id: string) {
  const source = await prisma.historicalSalesImport.findFirst({ where: { id, organizationId }, select: { sourceFileName: true, sourceMimeType: true, sourceContent: true } });
  if (!source) throw new AppError(404, 'HISTORICAL_IMPORT_NOT_FOUND', 'The imported register could not be found.');
  return source;
}

export async function createHistoricalImport(organizationId: string, userId: string, input: HistoricalSalesImportInput) {
  const setup = await equipment(organizationId, input.stationId, input.productId);
  const allowedTanks = new Map(setup.tanks.map(tank => [tank.id, tank]));
  const allowedNozzles = new Map(setup.nozzles.map(nozzle => [nozzle.id, nozzle]));
  for (const row of input.rows) {
    if (row.tankReadings.some(reading => !allowedTanks.has(reading.tankId)) || row.nozzleReadings.some(reading => !allowedNozzles.has(reading.nozzleId))) throw new AppError(400, 'HISTORICAL_IMPORT_EQUIPMENT_INVALID', 'Every tank and nozzle must belong to the selected product and fuel station.');
    for (const reading of row.tankReadings) {
      const tank = allowedTanks.get(reading.tankId)!;
      const usesMasterChart = tank.tankType === 'UNDERGROUND' && n(tank.nominalCapacity) === 20_000;
      if ((!usesMasterChart || reading.dipReading === undefined) && reading.openingStock > n(tank.workingCapacity)) throw new AppError(400, 'HISTORICAL_IMPORT_CAPACITY_EXCEEDED', `${tank.code} exceeds its safe working capacity on ${row.date}.`);
      if (!usesMasterChart || reading.dipReading === undefined) continue;
      const calibration = calibrateDip(reading.dipReading);
      if (calibration.status !== 'OK') throw new AppError(400, 'DIP_CALIBRATION_INVALID', `${tank.code} dip on ${row.date} is outside the approved ${MASTER_20KL_UG_CALIBRATION.entries[0]!.dipCm}-${MASTER_20KL_UG_CALIBRATION.entries.at(-1)!.dipCm} cm calibration range.`);
      if (!reading.calibration || reading.calibration.chartId !== calibration.chartId || Math.abs(reading.openingStock - calibration.volumeLitres) > 0.001) throw new AppError(400, 'DIP_CALIBRATION_REQUIRED', `${tank.code} stock on ${row.date} must use the approved 20 KL dip calibration chart.`);
      if ((reading.calibration.differenceLitres ?? 0) > reading.calibration.toleranceLitres && !reading.calibration.reviewConfirmed) throw new AppError(400, 'DIP_CALIBRATION_REVIEW_REQUIRED', `Confirm the ${tank.code} dip/volume mismatch on ${row.date} before importing.`);
    }
  }
  const issues = validateHistoricalRows(input.rows);
  if (issues.some(issue => issue.level === 'ERROR')) throw new AppError(400, 'HISTORICAL_IMPORT_INVALID', 'Correct the meter readings that move backwards before importing.', issues);
  const sorted = [...input.rows].sort((left, right) => left.date.localeCompare(right.date));
  const sourceContent = Buffer.from(input.sourceContentBase64, 'base64');
  if (sourceContent.byteLength !== input.sourceSize) throw new AppError(400, 'HISTORICAL_SOURCE_INVALID', 'The attached register could not be verified. Attach it again.');
  if (createHash('sha256').update(sourceContent).digest('hex') !== input.sourceFingerprint) throw new AppError(400, 'HISTORICAL_SOURCE_INVALID', 'The attached register fingerprint does not match its content.');
  const monthStart = indiaDayRange(`${input.month}-01`).start;
  const existing = await prisma.historicalSalesImport.findFirst({ where: { organizationId, OR: [{ sourceFingerprint: input.sourceFingerprint }, { stationId: input.stationId, productId: input.productId, monthStart }] }, select: { id: true } });
  if (existing) throw new AppError(409, 'HISTORICAL_IMPORT_EXISTS', 'This source file or product month has already been imported.');
  if (input.applyCutover) {
    const [shift, sale, ledger, reading] = await Promise.all([
      prisma.shift.findFirst({ where: { stationId: input.stationId }, select: { id: true } }),
      prisma.sale.findFirst({ where: { stationId: input.stationId }, select: { id: true } }),
      prisma.inventoryLedger.findFirst({ where: { stationId: input.stationId }, select: { id: true } }),
      prisma.tankReading.findFirst({ where: { stationId: input.stationId }, select: { id: true } }),
    ]);
    if (shift || sale || ledger || reading) throw new AppError(409, 'HISTORICAL_CUTOVER_LOCKED', 'Live operations already exist. Import the history without changing current tank or nozzle balances.');
  }
  return prisma.$transaction(async tx => {
    const record = await tx.historicalSalesImport.create({ data: { organizationId, stationId: input.stationId, productId: input.productId, monthStart, sourceFileName: input.sourceFileName, sourceMimeType: input.sourceMimeType, sourceSize: input.sourceSize, sourceContent, sourceFingerprint: input.sourceFingerprint, rows: sorted as unknown as Prisma.InputJsonValue, cutoverApplied: input.applyCutover, importedById: userId }, select: { id: true, monthStart: true, sourceFileName: true, cutoverApplied: true, createdAt: true, product: { select: { name: true, code: true } }, importedBy: { select: { name: true } } } });
    if (input.applyCutover) {
      const latest = sorted.at(-1)!;
      await Promise.all(latest.tankReadings.map(reading => tx.tank.update({ where: { id: reading.tankId }, data: { openingStock: new Prisma.Decimal(reading.openingStock) } })));
      await Promise.all(latest.nozzleReadings.map(reading => tx.nozzle.update({ where: { id: reading.nozzleId }, data: { openingMeter: new Prisma.Decimal(reading.meterReading) } })));
    }
    return { record, issues };
  });
}

export function importRows(record: Pick<HistoricalSalesImport, 'rows'>): HistoricalSalesRowInput[] {
  return Array.isArray(record.rows) ? record.rows as unknown as HistoricalSalesRowInput[] : [];
}
