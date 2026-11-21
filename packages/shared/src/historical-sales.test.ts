import { describe, expect, it } from 'vitest';
import { calculateHistoricalSalesValue, calculateHistoricalStockGainLoss, calculateHistoricalTankSales, calculateHistoricalTotalStock, deriveHistoricalSalesMetrics, deriveHistoricalTotalStock, type HistoricalSalesRowInput } from './index.js';

const row = (overrides: Partial<HistoricalSalesRowInput> = {}): HistoricalSalesRowInput => ({
  date: '2026-11-01',
  tankReadings: [{ tankId: 'cm1234567890123456789012', openingStock: 7_950.2 }],
  receiptQuantity: 0,
  totalStock: 7_927.83,
  nozzleReadings: [{ nozzleId: 'cm1234567890123456789013', meterReading: 15_086.173 }],
  testingQuantity: 25,
  salesQuantity: 0,
  sellingPrice: 94,
  ...overrides,
});

describe('historical total stock', () => {
  it('adds calibrated morning stock and all load received that day', () => {
    expect(calculateHistoricalTotalStock(row({ receiptQuantity: 8_000 }))).toBe(15_950.2);
  });

  it('replaces an OCR total with the authoritative derived value', () => {
    expect(deriveHistoricalTotalStock([row()])[0]?.totalStock).toBe(7_950.2);
  });
});

describe('historical derived sales metrics', () => {
  it('calculates daily sales value from derived litres and the recorded RSP', () => {
    expect(calculateHistoricalSalesValue(row({ salesQuantity: 1_234.567, sellingPrice: 94.25 }))).toBe(116_357.94);
  });

  it('uses the following morning readings and returns testing fuel to the tank', () => {
    const nozzle2 = 'cm1234567890123456789014';
    const first = row({
      nozzleReadings: [
        { nozzleId: 'cm1234567890123456789013', meterReading: 10_000 },
        { nozzleId: nozzle2, meterReading: 20_000 },
      ],
      testingQuantity: 25,
    });
    const second = row({
      date: '2026-11-02',
      tankReadings: [{ tankId: 'cm1234567890123456789012', openingStock: 7_750.2 }],
      nozzleReadings: [
        { nozzleId: 'cm1234567890123456789013', meterReading: 10_125 },
        { nozzleId: nozzle2, meterReading: 20_100 },
      ],
      testingQuantity: 0,
    });

    expect(calculateHistoricalTankSales(first, second)).toBe(200);
    expect(calculateHistoricalStockGainLoss(first, second)).toBe(0);
    const derived = deriveHistoricalSalesMetrics([first, second]);
    expect(derived[0]).toMatchObject({ salesQuantity: 200, cumulativeSales: 200, stockGainLoss: 0 });
    expect(derived[1]).toMatchObject({ salesQuantity: 0, cumulativeSales: 200 });
    expect(derived[1]?.stockGainLoss).toBeUndefined();
  });

  it('calculates cumulative sales dynamically across completed days', () => {
    const second = row({ date: '2026-11-02', tankReadings: [{ tankId: 'cm1234567890123456789012', openingStock: 7_850.2 }], nozzleReadings: [{ nozzleId: 'cm1234567890123456789013', meterReading: 15_186.173 }], testingQuantity: 10 });
    const third = row({ date: '2026-11-03', tankReadings: [{ tankId: 'cm1234567890123456789012', openingStock: 7_700.2 }], nozzleReadings: [{ nozzleId: 'cm1234567890123456789013', meterReading: 15_346.173 }], testingQuantity: 0 });
    const derived = deriveHistoricalSalesMetrics([row(), second, third]);
    expect(derived.map(item => item.cumulativeSales)).toEqual([75, 225, 225]);
    expect(derived.map(item => item.stockGainLoss)).toEqual([-25, 0, undefined]);
  });
});

it('never assigns a multi-day meter change to a single day across a gap', () => {
  const first = row({ testingQuantity: 0 });
  const third = row({ date: '2026-11-03', nozzleReadings: [{ ...first.nozzleReadings[0]!, meterReading: 15486.173 }] });
  expect(deriveHistoricalSalesMetrics([first, third])[0]?.salesQuantity).toBe(0);
  expect(calculateHistoricalTankSales(first, third)).toBeUndefined();
  const second = row({ date: '2026-11-02', testingQuantity: 0, nozzleReadings: [{ ...first.nozzleReadings[0]!, meterReading: 15286.173 }] });
  expect(deriveHistoricalSalesMetrics([first, second, third]).map(day => day.salesQuantity)).toEqual([200, 200, 0]);
});

it('separates newly added facts from automatically recalculated adjacent-day metrics', async () => {
  const { historicalSalesChanges } = await import('./index.js');
  const first = row();
  const second = row({ date: '2026-11-02' });
  expect(historicalSalesChanges([first], [{ ...first, salesQuantity: 100, totalStock: 7950.2 }, second])).toEqual({ added: ['2026-11-02'], updated: [], removed: [] });
  expect(historicalSalesChanges([first], [{ ...first, testingQuantity: 30 }]).updated).toEqual(['2026-11-01']);
  expect(historicalSalesChanges([first, second], [second]).removed).toEqual(['2026-11-01']);
});

it('compares saved JSON facts independently of object key order', async () => {
  const { historicalSalesChanges } = await import('./index.js');
  const first = row({tankReadings:[{tankId:'tank',dipReading:83,openingStock:7950.2,calibration:{chartId:'chart',volumeLitres:7950.2,toleranceLitres:2,interpolated:false,reviewConfirmed:true}}]});
  const reordered = { ...first, tankReadings: first.tankReadings.map(reading => ({ openingStock:reading.openingStock, calibration:Object.fromEntries(Object.entries(reading.calibration!).reverse()) as typeof reading.calibration, dipReading:reading.dipReading, tankId:reading.tankId })) };
  expect(historicalSalesChanges([first],[reordered]).updated).toEqual([]);
});
