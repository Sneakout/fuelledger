import { safeTransaction } from '../../lib/safe-save.js';
import { calculateBookStock, type DensityReadingInput, type InventoryAdjustmentInput, type ReceiptInput, type TankReadingInput } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { effectivePriceAt } from '../../lib/effective-price.js';
import { assertStockAvailable } from '../../lib/stock.js';
import { postJournal } from '../accounting/service.js';

const tankInclude = { product: { select: { id: true, name: true, code: true, unit: true, category: true } }, physicalReadings: { take: 1, orderBy: { recordedAt: 'desc' as const } }, densityReadings: { take: 1, orderBy: { recordedAt: 'desc' as const } } } as const;
export async function bootstrap(organizationId: string,stationIds?:string[]) {
  const asOf = new Date();
  const [stations, products, ledger, receipts, movements] = await Promise.all([
    prisma.station.findMany({ where: { organizationId, active: true,...(stationIds?{id:{in:stationIds}}:{}) }, include: { configurations: { where: { active: true }, take: 1, include: { tanks: { where: { status: 'ACTIVE' }, include: tankInclude } } } } }),
    prisma.product.findMany({ where: { organizationId, active: true, inventoryTracked: true }, select: { id: true, name: true, code: true, unit: true, category: true, tankLinked: true } }),
    prisma.inventoryLedger.findMany({ where: { organizationId,...(stationIds?{stationId:{in:stationIds}}:{}) }, orderBy: { occurredAt: 'desc' }, take: 80, include: { product: { select: { name: true, code: true, unit: true } }, station: { select: { name: true, code: true } }, tank: { select: { code: true } } } }),
    prisma.purchaseReceipt.findMany({ where: { organizationId,...(stationIds?{stationId:{in:stationIds}}:{}) }, orderBy: { receivedAt: 'desc' }, take: 20, include: { station: { select: { name: true } }, lines: { include: { product: { select: { name: true, code: true, unit: true } }, tank: { select: { code: true } } } } } }),
    prisma.inventoryLedger.findMany({ where: { organizationId, ...(stationIds ? { stationId: { in: stationIds } } : {}), occurredAt: { lte: asOf } }, select: { stationId: true, productId: true, tankId: true, type: true, quantityDelta: true, occurredAt: true, product: { select: { tankLinked: true } }, tank: { select: { productId: true, configuration: { select: { stationId: true } } } } } }),
  ]);
  for (const movement of movements) {
    if ((movement.product.tankLinked && !movement.tankId) || (movement.tankId && (!movement.tank || movement.tank.productId !== movement.productId || movement.tank.configuration.stationId !== movement.stationId)))
      throw new AppError(409, 'STOCK_SCOPE_INVALID', 'A stock movement does not match its fuel station, product and tank. Review inventory consistency before continuing.');
  }
  const ledgerByTank = group(movements.filter(entry => entry.tankId), entry => entry.tankId!); const ledgerByStationProduct = group(movements.filter(entry => !entry.tankId), entry => `${entry.stationId}:${entry.productId}`);
  const tanks = stations.flatMap(station => station.configurations[0]?.tanks.map(tank => reconciliation({ station, tank, entries: ledgerByTank.get(tank.id) ?? [] })) ?? []);
  const untanked = stations.flatMap(station => products.filter(product => !product.tankLinked).map(product => reconciliation({ station, product, entries: ledgerByStationProduct.get(`${station.id}:${product.id}`) ?? [] })));
  return { asOf, stations, products, tanks, untanked, ledger, receipts };
}

export type StockMovementForAnalysis = { id: string; tankId: string | null; type: 'RECEIPT' | 'SALE' | 'ADJUSTMENT'; quantityDelta: Prisma.Decimal | number; occurredAt: Date; note: string | null };

export const stockAnalysisWindowDays = 14;
export const stockForecastMinimumSellingDays = 7;

/** Deterministic, read-only movement review. It never changes the inventory ledger. */
export function analyzeTankMovements(movements: StockMovementForAnalysis[], bookStock: number, asOf: Date) {
  const windowStart = new Date(asOf.getTime() - stockAnalysisWindowDays * 86_400_000);
  const recent = movements.filter(row => row.occurredAt >= windowStart && row.occurredAt <= asOf);
  const invalidDirection = recent.filter(row => (row.type === 'RECEIPT' && Number(row.quantityDelta) < 0) || (row.type === 'SALE' && Number(row.quantityDelta) > 0));
  const materialAdjustments = recent.filter(row => row.type === 'ADJUSTMENT' && Math.abs(Number(row.quantityDelta)) >= Math.max(500, Math.abs(bookStock) * .1));
  const completedDayEnd = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const salesByDay = new Map<string, number>();
  for (const row of recent.filter(row => row.type === 'SALE' && row.occurredAt < completedDayEnd)) {
    const day = row.occurredAt.toISOString().slice(0, 10);
    salesByDay.set(day, (salesByDay.get(day) ?? 0) + Math.abs(Number(row.quantityDelta)));
  }
  const sellingDays = [...salesByDay.entries()].sort(([left], [right]) => left.localeCompare(right));
  const latestCompletedDay = new Date(completedDayEnd.getTime() - 86_400_000).toISOString().slice(0, 10);
  const latestSales = salesByDay.get(latestCompletedDay) ?? 0;
  const priorSales = sellingDays.filter(([day]) => day < latestCompletedDay).map(([, litres]) => litres);
  const baseline = median(priorSales);
  const salesSpike = priorSales.length >= stockForecastMinimumSellingDays && latestSales >= 500 && baseline > 0 && latestSales >= baseline * 2;
  const unusualReasons = [
    ...invalidDirection.map(row => `${row.type} ${row.id} has an unexpected quantity direction`),
    ...materialAdjustments.map(row => `Adjustment ${row.id} changes stock by ${Math.abs(Number(row.quantityDelta)).toLocaleString('en-IN')} L`),
    ...(salesSpike ? [`Recorded sales on ${latestCompletedDay} were ${latestSales.toLocaleString('en-IN')} L, at least twice the ${baseline.toLocaleString('en-IN')} L median of ${priorSales.length} prior selling days`] : []),
  ];
  const consumptionSamples = sellingDays.map(([, litres]) => litres).filter(litres => litres > 0);
  const averageDailyConsumption = consumptionSamples.length ? consumptionSamples.reduce((sum, value) => sum + value, 0) / consumptionSamples.length : null;
  const forecastAvailable = consumptionSamples.length >= stockForecastMinimumSellingDays && averageDailyConsumption !== null && averageDailyConsumption > 0 && bookStock > 0;
  return {
    unusualMovement: unusualReasons.length > 0,
    unusualReasons,
    movementSample: { windowDays: stockAnalysisWindowDays, sellingDays: consumptionSamples.length, latestCompletedDay, latestSales, priorSellingDays: priorSales.length, priorMedianDailySales: baseline || null },
    runoutEstimate: forecastAvailable ? {
      estimatedDaysRemaining: bookStock / averageDailyConsumption!,
      averageDailyConsumption: averageDailyConsumption!,
      sampleSellingDays: consumptionSamples.length,
      windowDays: stockAnalysisWindowDays,
      assumption: `Current book stock divided by average recorded sales across ${consumptionSamples.length} selling days in the last ${stockAnalysisWindowDays} days; no future receipt or demand change is assumed.`,
    } : null,
    forecastWithheldReason: forecastAvailable ? null : bookStock <= 0 ? 'Runout is not estimated when recorded stock is empty or below zero.' : `At least ${stockForecastMinimumSellingDays} selling days within the last ${stockAnalysisWindowDays} days are required.`,
  };
}

export async function stockAnalyticsForNerve(organizationId: string, stationId: string, asOf: Date) {
  const rows = await prisma.inventoryLedger.findMany({
    where: { organizationId, stationId, tankId: { not: null }, occurredAt: { gte: new Date(asOf.getTime() - stockAnalysisWindowDays * 86_400_000), lte: asOf } },
    select: { id: true, tankId: true, type: true, quantityDelta: true, occurredAt: true, note: true },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  return group(rows, row => row.tankId!);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function reconciliation({ station, tank, product, entries }: { station?: { id: string; name: string; code: string }; tank?: { id: string; code: string; openingStock: Prisma.Decimal; product: { id: string; name: string; code: string; unit: string; category: string }; physicalReadings: Array<{ physicalStock: Prisma.Decimal; dipReading: Prisma.Decimal | null; recordedAt: Date }>; densityReadings: Array<{ density: Prisma.Decimal; recordedAt: Date }> }; product?: { id: string; name: string; code: string; unit: string }; entries: Array<{ type: string; quantityDelta: Prisma.Decimal; occurredAt: Date }> }) {
  const item = tank?.product ?? product!;
  const opening = Number(tank?.openingStock ?? 0);
  const totals = (movements: typeof entries) => ({
    receipts: sum(movements.filter(entry => entry.type === 'RECEIPT')),
    sales: Math.abs(sum(movements.filter(entry => entry.type === 'SALE'))),
    adjustments: sum(movements.filter(entry => entry.type === 'ADJUSTMENT')),
  });
  const movements = totals(entries);
  const bookStock = calculateBookStock({ openingBalance: opening, receipts: movements.receipts, sales: movements.sales, approvedAdjustments: movements.adjustments });
  const reading = tank?.physicalReadings[0];
  const densityReading = tank?.densityReadings[0];
  const physicalStock = reading ? Number(reading.physicalStock) : null;
  const readingMovements = reading ? totals(entries.filter(entry => entry.occurredAt <= reading.recordedAt)) : null;
  const bookStockAtReading = readingMovements ? calculateBookStock({ openingBalance: opening, receipts: readingMovements.receipts, sales: readingMovements.sales, approvedAdjustments: readingMovements.adjustments }) : null;
  return { station, tank: tank ? { id: tank.id, code: tank.code } : null, product: item, opening, receipts: movements.receipts, sales: movements.sales, adjustments: movements.adjustments, bookStock, physicalStock, bookStockAtReading, variance: physicalStock === null || bookStockAtReading === null ? null : physicalStock - bookStockAtReading, dipReading: reading?.dipReading ? Number(reading.dipReading) : null, readAt: reading?.recordedAt ?? null, density: densityReading ? Number(densityReading.density) : null, densityRecordedAt: densityReading?.recordedAt ?? null };
}
const sum = (entries: Array<{ quantityDelta: Prisma.Decimal }>) => entries.reduce((total, entry) => total + Number(entry.quantityDelta), 0);
const group = <T>(values: T[], key: (value: T) => string) => values.reduce((map, value) => { const id = key(value); map.set(id, [...(map.get(id) ?? []), value]); return map; }, new Map<string, T[]>());
export async function receive(organizationId: string, userId: string, input: ReceiptInput) {
  const station = await prisma.station.findFirst({ where: { id: input.stationId, organizationId, active: true } }); if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'Choose an active fuel station.');
  const products = await prisma.product.findMany({ where: { organizationId, id: { in: input.lines.map(line => line.productId) }, active: true, inventoryTracked: true } }); if (products.length !== new Set(input.lines.map(line => line.productId)).size) throw new AppError(400, 'PRODUCT_NOT_INVENTORIED', 'Every receipt line must use an active inventory product.');
  return safeTransaction(prisma, async tx => { const receipt = await tx.purchaseReceipt.create({ data: { organizationId, stationId: station.id, supplierName: input.supplierName, referenceNo: input.referenceNo || null, receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(), notes: input.notes || null, createdById: userId } }); for (const line of input.lines) { const product = products.find(item => item.id === line.productId)!; const tank = line.tankId ? await tx.tank.findFirst({ where: { id: line.tankId, productId: product.id, configuration: { stationId: station.id, active: true }, status: 'ACTIVE' } }) : null; if (line.tankId && !tank) throw new AppError(400, 'TANK_MAPPING_INVALID', 'The selected tank must be active at this fuel station and hold this product.'); if (product.tankLinked && !tank) throw new AppError(400, 'TANK_REQUIRED', `${product.name} must be received into its configured tank.`); const receiptLine = await tx.receiptLine.create({ data: { receiptId: receipt.id, productId: product.id, tankId: tank?.id ?? null, quantity: new Prisma.Decimal(line.quantity), unitCost: new Prisma.Decimal(line.unitCost) } }); await tx.inventoryLedger.create({ data: { organizationId, stationId: station.id, productId: product.id, tankId: tank?.id ?? null, type: 'RECEIPT', quantityDelta: new Prisma.Decimal(line.quantity), unitCost: new Prisma.Decimal(line.unitCost), receiptLineId: receiptLine.id, occurredAt: receipt.receivedAt, createdById: userId } }); } const total=input.lines.reduce((sum,line)=>sum+line.quantity*line.unitCost,0);await postJournal(tx,{organizationId,stationId:station.id,createdById:userId,journalDate:receipt.receivedAt,reference:`GRN-${receipt.id.slice(-8)}`,description:`Goods receipt from ${input.supplierName}`,sourceType:'PURCHASE_RECEIPT',sourceId:receipt.id,lines:[{account:'1200',debit:total},{account:'2000',credit:total}]});return receipt; });
}
export async function adjustInTransaction(tx: Prisma.TransactionClient, organizationId: string, userId: string, input: InventoryAdjustmentInput) {
  const product = await tx.product.findFirst({ where: { id: input.productId, organizationId, active: true, inventoryTracked: true }, include: { purchasePriceHistory: { where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_INVENTORIED', 'Choose an active inventory product.');
  const purchasePrice = effectivePriceAt(product.purchasePrice, product.purchasePriceHistory);
  const tank = input.tankId ? await tx.tank.findFirst({ where: { id: input.tankId, productId: product.id, configuration: { stationId: input.stationId, station: { organizationId } }, status: 'ACTIVE' } }) : null;
  if (input.tankId && !tank) throw new AppError(400, 'TANK_MAPPING_INVALID', 'The selected tank is not valid for this product and fuel station.');
  if (product.tankLinked && !tank) throw new AppError(400, 'TANK_REQUIRED', `${product.name} needs a tank adjustment.`);
  if (input.quantityDelta < 0) await assertStockAvailable(tx, { organizationId, stationId: input.stationId, productId: product.id, tankId: tank?.id }, -input.quantityDelta);
  const entry = await tx.inventoryLedger.create({ data: { organizationId, stationId: input.stationId, productId: product.id, tankId: tank?.id ?? null, type: 'ADJUSTMENT', quantityDelta: new Prisma.Decimal(input.quantityDelta), unitCost: purchasePrice, note: input.notes, createdById: userId } });
  const amount = new Prisma.Decimal(Math.abs(input.quantityDelta)).mul(purchasePrice);
  await postJournal(tx, { organizationId, stationId: input.stationId, createdById: userId, journalDate: entry.occurredAt, reference: `ADJ-${entry.id.slice(-8)}`, description: `Inventory adjustment: ${product.name}`, sourceType: 'INVENTORY_ADJUSTMENT', sourceId: entry.id, lines: input.quantityDelta > 0 ? [{ account: '1200', debit: amount }, { account: '5100', credit: amount }] : [{ account: '5100', debit: amount }, { account: '1200', credit: amount }] });
  return entry;
}

export async function adjust(organizationId: string, userId: string, input: InventoryAdjustmentInput) {
  return safeTransaction(prisma, tx => adjustInTransaction(tx, organizationId, userId, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function recordTankReading(organizationId: string, userId: string, input: TankReadingInput) { const tank = await prisma.tank.findFirst({ where: { id: input.tankId, configuration: { stationId: input.stationId, station: { organizationId } }, status: 'ACTIVE' } }); if (!tank) throw new AppError(400, 'TANK_NOT_FOUND', 'Choose an active tank at this fuel station.'); return prisma.tankReading.create({ data: { organizationId, stationId: input.stationId, tankId: tank.id, physicalStock: new Prisma.Decimal(input.physicalStock), dipReading: input.dipReading === null || input.dipReading === undefined ? null : new Prisma.Decimal(input.dipReading), notes: input.notes || null, recordedById: userId } }); }
export async function recordDensity(organizationId: string, userId: string, input: DensityReadingInput) { const tank = await prisma.tank.findFirst({ where: { id: input.tankId, configuration: { stationId: input.stationId, station: { organizationId } }, status: 'ACTIVE', product: { category: 'FUEL' } } }); if (!tank) throw new AppError(400, 'FUEL_TANK_NOT_FOUND', 'Choose an active petrol or diesel tank at this fuel station.'); return prisma.tankDensityReading.create({ data: { organizationId, stationId: input.stationId, tankId: tank.id, density: new Prisma.Decimal(input.density), recordedById: userId } }); }
