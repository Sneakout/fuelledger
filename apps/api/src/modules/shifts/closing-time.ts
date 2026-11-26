import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';

export function resolveClosingTime(openedAt: Date, selected: string | undefined, recordedAt = new Date()) {
  const at = selected === undefined ? recordedAt : new Date(selected);
  if (!Number.isFinite(at.getTime())) throw new AppError(400, 'SHIFT_CLOSING_TIME_INVALID', 'Choose a valid closing date and time.');
  if (at < openedAt) throw new AppError(400, 'SHIFT_CLOSING_BEFORE_OPENING', 'Closing time cannot be before this shift opened.');
  if (at > recordedAt) throw new AppError(400, 'SHIFT_CLOSING_IN_FUTURE', 'Closing time cannot be in the future. Choose a past time or Close now.');
  return at;
}

/** Backdating must not strand existing sales or intersect another real shift. */
export async function validateClosingCutoff(db: Pick<Prisma.TransactionClient, 'sale' | 'shift'>,
  organizationId: string, shift: { id: string; stationId: string; openedAt: Date }, at: Date) {
  const [laterSale, overlap] = await Promise.all([
    db.sale.findFirst({ where: { organizationId, shiftId: shift.id, occurredAt: { gt: at } }, select: { id: true } }),
    db.shift.findFirst({ where: { stationId: shift.stationId, station: { organizationId }, id: { not: shift.id }, status: { not: 'CANCELLED' },
      openedAt: { lt: at }, OR: [{ closedAt: null }, { closedAt: { gt: shift.openedAt } }] }, select: { id: true } }),
  ]);
  if (laterSale) throw new AppError(409, 'SHIFT_SALES_AFTER_CLOSING', 'This shift has sales recorded after the selected closing time. Choose a later closing time or correct those sales first.');
  if (overlap) throw new AppError(409, 'SHIFT_CLOSING_OVERLAP', 'The selected time overlaps another shift. Review the shift dates before closing.');
}
