import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { effectivePriceAt } from '../src/lib/effective-price.js';

describe('effectivePriceAt', () => {
  const history = [
    { price: new Prisma.Decimal(105), effectiveFrom: new Date('2026-09-10T00:00:00Z') },
    { price: new Prisma.Decimal(101), effectiveFrom: new Date('2026-09-01T00:00:00Z') },
    { price: new Prisma.Decimal(99), effectiveFrom: new Date('2026-08-01T00:00:00Z') },
  ];

  it('uses the latest price effective on the requested date', () => {
    expect(
      Number(effectivePriceAt(new Prisma.Decimal(88), history, new Date('2026-09-05T00:00:00Z'))),
    ).toBe(101);
  });

  it('does not activate a future price early', () => {
    expect(
      Number(effectivePriceAt(new Prisma.Decimal(88), history, new Date('2026-09-09T23:59:59Z'))),
    ).toBe(101);
  });
});
