import { describe, expect, it } from 'vitest';
import { calculateHistoricalStockGainLoss, calculateHistoricalTankSales, calculateHistoricalTotalStock, deriveHistoricalSalesMetrics, deriveHistoricalTotalStock, type HistoricalSalesRowInput } from './index.js';

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
