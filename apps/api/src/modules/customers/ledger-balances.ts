import { Prisma } from '@prisma/client';
import { indiaDate } from '../../lib/india-time.js';

export function customerLedgerBalances<T extends { amount: Prisma.Decimal; occurredAt: Date; dueDate: Date | null; id?: string }>(entries: T[], asOf: Date) {
  const ledger = entries.filter(entry => entry.occurredAt <= asOf);
  const outstanding = ledger.reduce((total, entry) => total.plus(entry.amount), new Prisma.Decimal(0));
  let credits = ledger.reduce((total, entry) => entry.amount.lt(0) ? total.minus(entry.amount) : total, new Prisma.Decimal(0));
  const ageing = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
  const asOfDay = Date.parse(indiaDate(asOf));
  const unpaid = ledger.filter(entry => entry.amount.gt(0))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id ?? '').localeCompare(b.id ?? ''))
    .flatMap(entry => {
      const applied = Prisma.Decimal.min(credits, entry.amount);
      credits = credits.minus(applied);
      const remaining = entry.amount.minus(applied);
      if (remaining.isZero()) return [];
      const daysOverdue = entry.dueDate ? Math.max(0, (asOfDay - Date.parse(indiaDate(entry.dueDate))) / 86_400_000) : null;
      const days = daysOverdue ?? 0;
      const bucket = days === 0 ? 'current' : days <= 30 ? 'days1to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'days90plus';
      ageing[bucket] += remaining.toNumber();
      return [{ ...entry, remaining: remaining.toNumber(), daysOverdue }];
    });
  return { outstanding: outstanding.toNumber(), ageing, unpaid };
}
