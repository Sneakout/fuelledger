import { describe, expect, it } from 'vitest';
import { deriveHistoricalNozzleSales } from '@fuelledger/shared';
import { validateHistoricalRows } from '../src/modules/historical-sales/service.js';

const nozzleId = 'cm12345678901234567890123';
const tankId = 'cm22345678901234567890123';
const row = (date: string, meterReading: number, salesQuantity: number, testingQuantity = 0) => ({
  date,
  tankReadings: [{ tankId, openingStock: 5000 }],
  receiptQuantity: 0,
  nozzleReadings: [{ nozzleId, meterReading }],
  testingQuantity,
  salesQuantity,
  sellingPrice: 100,
});

describe('historical sales register validation', () => {
  it('accepts sales that reconcile to the next opening meter less testing', () => {
    expect(validateHistoricalRows([row('2026-11-01', 1000, 90, 10), row('2026-11-02', 1100, 0)])).toEqual([]);
  });

  it('flags backwards meters as an error', () => {
    expect(validateHistoricalRows([row('2026-11-01', 1000, 0), row('2026-11-02', 900, 0)]).some(issue => issue.level === 'ERROR')).toBe(true);
  });

  it('flags a material mismatch without silently changing the register', () => {
    const issues = validateHistoricalRows([row('2026-11-01', 1000, 40), row('2026-11-02', 1100, 0)]);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'salesQuantity', level: 'WARNING' })]));
  });

  it('derives product sales from all nozzle movements less testing', () => {
    const secondNozzleId = 'cm32345678901234567890123';
    const first = { ...row('2026-11-01', 1000, 999, 10), nozzleReadings: [{ nozzleId, meterReading: 1000 }, { nozzleId: secondNozzleId, meterReading: 2000 }] };
    const second = { ...row('2026-11-02', 1125, 0), nozzleReadings: [{ nozzleId, meterReading: 1125 }, { nozzleId: secondNozzleId, meterReading: 2075 }] };
    const derived = deriveHistoricalNozzleSales([first, second]);
    expect(derived[0]?.salesQuantity).toBe(190);
    expect(derived[1]?.salesQuantity).toBe(0);
  });
});
