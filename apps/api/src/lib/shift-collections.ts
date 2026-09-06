import { AppError } from './errors.js';

export type CustomerAllocation = { customerId: string; paymentMethod: string; amount: number };
/** Existing sale debts are included in allocations for review, never posted twice. */
export function additionalCustomerDebt(allocations: CustomerAllocation[], existing: CustomerAllocation[]) {
  const remaining = new Map<string, number>();
  const key = (row: CustomerAllocation) => `${row.customerId}:${row.paymentMethod}`;
  for (const row of existing) remaining.set(key(row), (remaining.get(key(row)) ?? 0) + row.amount);
  const added = allocations.map(row => {
    if (!['CREDIT', 'FLEET'].includes(row.paymentMethod)) return 0;
    const covered = Math.min(row.amount, remaining.get(key(row)) ?? 0);
    remaining.set(key(row), (remaining.get(key(row)) ?? 0) - covered);
    return row.amount - covered;
  });
  if ([...remaining.values()].some(amount => amount > 0.01)) throw new AppError(409, 'RECORDED_CREDIT_REQUIRED', 'Keep customer amounts already recorded in Sales assigned to those same customers. Correct the original sale before changing its customer or payment method.');
  return added;
}

export function collectionDifferences(rows: Array<{ actualAmount: number; expectedAmount: number; adjustmentAmount: number }>) {
  return rows.reduce((totals, row) => {
    const difference = row.actualAmount - row.expectedAmount - row.adjustmentAmount;
    return { shortage: totals.shortage + Math.max(0, -difference), excess: totals.excess + Math.max(0, difference) };
  }, { shortage: 0, excess: 0 });
}
