import { describe, expect, it } from 'vitest';
import { calculateHistoricalTotalStock, deriveHistoricalTotalStock, type HistoricalSalesRowInput } from './index.js';

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
