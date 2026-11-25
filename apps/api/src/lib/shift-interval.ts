import { Prisma, ShiftStatus } from '@prisma/client';
import { AppError } from './errors.js';

type ShiftReader = Pick<Prisma.TransactionClient, 'shift'>;

export type ShiftAtInstant = {
  id: string;
  shiftNumber: number;
  status: ShiftStatus;
  openedAt: Date;
  closedAt: Date | null;
};

type ShiftBounds = Pick<ShiftAtInstant, 'openedAt' | 'closedAt'>;

export const shiftContains = (shift: ShiftBounds, instant: Date) =>
  shift.openedAt <= instant && (!shift.closedAt || instant < shift.closedAt);

export const shiftMovementWindow = (shift: ShiftBounds, asOf: Date): Prisma.DateTimeFilter => ({
  gte: shift.openedAt,
  ...(shift.closedAt ? { lt: shift.closedAt } : { lte: asOf }),
});

/** Shift intervals are half-open: openedAt <= instant < closedAt. */
export async function shiftAtInstant(
  db: ShiftReader,
  organizationId: string,
  stationId: string,
  instant: Date,
): Promise<ShiftAtInstant | null> {
  const shifts = await db.shift.findMany({
    where: {
      stationId,
      status: { not: 'CANCELLED' },
      station: { organizationId },
      openedAt: { lte: instant },
      OR: [{ closedAt: null }, { closedAt: { gt: instant } }],
    },
    orderBy: { openedAt: 'desc' },
    take: 2,
    select: { id: true, shiftNumber: true, status: true, openedAt: true, closedAt: true },
  });
  if (shifts.length > 1)
    throw new AppError(409, 'SHIFT_INTERVAL_OVERLAP', 'Two shifts overlap this stock receipt time. Review shift history before continuing.');
  return shifts[0] ?? null;
}

export const affectsClosedShift = (shift: ShiftAtInstant | null) =>
  Boolean(shift?.closedAt);
