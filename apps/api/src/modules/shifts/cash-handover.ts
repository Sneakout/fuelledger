import { Prisma } from '@prisma/client';
import type { OpenShiftInput } from '@fuelledger/shared';
import { AppError } from '../../lib/errors.js';

/** A custody snapshot, not a supplier payment, expense or accounting journal. */
export function cashHandoverSnapshot(
  input: OpenShiftInput,
  previous: { id: string; closingCash: Prisma.Decimal | null } | null,
  enteredById: string | null,
  recordedAt: Date,
) {
  const handover = input.cashHandover;
  const prior = previous?.closingCash == null ? null : new Prisma.Decimal(previous.closingCash);
  if (handover && (handover.previousShiftId !== (previous?.id ?? null) ||
    (handover.previousClosingCash === null ? prior !== null : prior === null || !prior.equals(handover.previousClosingCash)))) {
    throw new AppError(409, 'CASH_HANDOVER_STALE', 'The previous shift cash has changed. Refresh the opening details and review the cash handover again.');
  }
  const amount = (value: number, label: string) => {
    if (!Number.isFinite(value) || value < 0 || value > 9999999999.99 || !new Prisma.Decimal(value).equals(new Prisma.Decimal(value).toDecimalPlaces(2)))
      throw new AppError(400, 'CASH_HANDOVER_INVALID', `Enter ${label} as a non-negative amount with at most two decimal places.`);
    return new Prisma.Decimal(value);
  };
  const actual = amount(input.openingCash, 'actual opening cash');
  const added = amount(handover?.added ?? 0, 'cash added');
  const removed = amount(handover?.removed ?? 0, 'cash removed');
  const expected = prior === null ? null : prior.add(added).minus(removed);
  if (expected?.isNegative()) throw new AppError(400, 'CASH_HANDOVER_INVALID', 'Cash removed cannot exceed previous closing cash plus cash added.');
  const difference = expected === null ? null : actual.minus(expected);
  // Older clients can explicitly explain their opening count in opening notes.
  const reason = (handover ? handover.reason : input.notes)?.trim() || null;
  if ((added.gt(0) || removed.gt(0) || difference?.abs().gte(0.01) || (previous && prior === null)) && !reason)
    throw new AppError(400, 'CASH_HANDOVER_REASON_REQUIRED', 'Add a cash handover reason for cash added, cash removed, a counted difference or an unavailable previous closing balance.');
  return {
    previousShiftId: previous?.id ?? null,
    previousClosingCash: prior?.toFixed(2) ?? null,
    added: added.toFixed(2), removed: removed.toFixed(2),
    expectedOpening: expected?.toFixed(2) ?? null,
    actualOpening: actual.toFixed(2), difference: difference?.toFixed(2) ?? null,
    reason, enteredById, recordedAt: recordedAt.toISOString(),
  };
}
