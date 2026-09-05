import type { Prisma } from '@prisma/client';

type PriceHistory = Array<{ price: Prisma.Decimal; effectiveFrom: Date }>;

export const effectivePriceAt = (
  currentPrice: Prisma.Decimal,
  history: PriceHistory,
  at = new Date(),
) => history.find((entry) => entry.effectiveFrom <= at)?.price ?? currentPrice;
