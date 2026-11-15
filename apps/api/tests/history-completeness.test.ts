import { describe, expect, it } from 'vitest';
import { findMissingDailyRecords } from '../src/modules/intelligence/history-completeness.js';

const record = (date: string, productId = 'hsd', productCode = 'HSD') => ({ stationId: 'station-1', stationName: 'Saleema Petroleum', productId, productCode, date });

describe('daily history completeness', () => {
  it('lists every calendar day after the latest available record through today', () => {
    expect(findMissingDailyRecords([record('2026-11-10'), record('2026-11-12')], '2026-11-15')).toEqual([expect.objectContaining({
      lastAvailableDate: '2026-11-12',
      missingFrom: '2026-11-13',
      missingThrough: '2026-11-15',
      missingDates: ['2026-11-13', '2026-11-14', '2026-11-15'],
    })]);
  });

  it('does not remind when a trusted record already exists today', () => {
    expect(findMissingDailyRecords([record('2026-11-15')], '2026-11-15')).toEqual([]);
  });

  it('tracks each fuel product independently and ignores future-dated records', () => {
    const result = findMissingDailyRecords([
      record('2026-11-14'),
      record('2026-11-20'),
      record('2026-11-12', 'ms', 'MS'),
    ], '2026-11-15');
    expect(result).toEqual([
      expect.objectContaining({ productCode: 'MS', missingDates: ['2026-11-13', '2026-11-14', '2026-11-15'] }),
      expect.objectContaining({ productCode: 'HSD', missingDates: ['2026-11-15'] }),
    ]);
  });
});
