import { describe, expect, it } from 'vitest';
import { addIndiaDays, indiaDate, indiaDayRange, indiaDayStart, indiaMonthStart } from './india-time.js';

describe('India business time', () => {
  it('changes business date at India midnight, not UTC midnight', () => {
    expect(indiaDate(new Date('2026-11-06T18:29:59.999Z'))).toBe('2026-11-06');
    expect(indiaDate(new Date('2026-11-06T18:30:00.000Z'))).toBe('2026-11-07');
  });

  it('builds exact half-open India day ranges independent of server timezone', () => {
    const range = indiaDayRange('2026-11-07');
    expect(range.start.toISOString()).toBe('2026-11-06T18:30:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-11-07T18:30:00.000Z');
    expect(indiaDayStart(new Date('2026-11-07T17:00:00Z')).toISOString()).toBe(range.start.toISOString());
  });

  it('handles month and year boundaries as India calendar dates', () => {
    expect(addIndiaDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(indiaMonthStart(new Date('2026-11-30T20:00:00Z')).toISOString()).toBe('2026-11-30T18:30:00.000Z');
  });
});
