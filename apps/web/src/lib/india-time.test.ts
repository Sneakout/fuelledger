import { describe, expect, it } from 'vitest';
import { addIndiaDays, indiaCalendarDateIso, indiaDate, indiaDateTimeLocal, indiaMonthStart } from './india-time';

describe('India business dates', () => {
  it('changes date at midnight in India, not midnight UTC', () => {
    expect(indiaDate('2026-11-06T18:29:59.999Z')).toBe('2026-11-06');
    expect(indiaDate('2026-11-06T18:30:00.000Z')).toBe('2026-11-07');
  });

  it('uses the India month when UTC is still on the previous date', () => {
    expect(indiaMonthStart('2026-11-30T20:00:00.000Z')).toBe('2026-12-01');
    expect(addIndiaDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('builds India wall-clock values for date-time controls', () => {
    expect(indiaDateTimeLocal('2026-11-06T18:30:00.000Z')).toBe('2026-11-07T00:00');
    expect(indiaCalendarDateIso('2026-11-07')).toBe('2026-11-06T18:30:00.000Z');
  });
});
