import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { indiaDate } from '../../lib/india-time.js';
import { historicalTankReceipts } from './historical-receipts.js';

export function resolveOpeningTime(selected: string | undefined, recordedAt = new Date()) {
  const at = selected === undefined ? recordedAt : new Date(selected);
  if (!Number.isFinite(at.getTime())) throw new AppError(400, 'SHIFT_OPENING_TIME_INVALID', 'Choose a valid opening date and time.');
  if (at > recordedAt) throw new AppError(400, 'SHIFT_OPENING_IN_FUTURE', 'Opening time cannot be in the future. Choose a past time or Open now.');
  return at;
}

/** New shifts are appended to the station timeline. An open-ended historical
 * shift cannot be inserted across a later completed or running shift. */
export async function validateOpeningSequence(db: Pick<Prisma.TransactionClient, 'shift' | 'historicalSalesImport' | 'inventoryLedger' | 'tank'>,
  organizationId: string, stationId: string, at: Date, requireTimedReceipts = true) {
  const conflict = await db.shift.findFirst({ where: { stationId, station: { organizationId }, status: { notIn: ['CANCELLED', 'DRAFT'] },
    OR: [{ closedAt: null }, { closedAt: { gt: at } }] }, orderBy: { openedAt: 'desc' }, select: { id: true, status: true, closedAt: true } });
  if (conflict) throw new AppError(409, conflict.status === 'OPEN' ? 'SHIFT_ALREADY_OPEN' : 'SHIFT_OPENING_OVERLAP',
    conflict.status === 'OPEN' ? 'Close or cancel the current shift before opening another one.' : 'Opening time must be at or after the latest shift’s closing time. Review the shift dates.');
  if (!requireTimedReceipts) return;
  const untimed = (await historicalTankReceipts(db, organizationId, stationId)).some(receipt => receipt.businessDate === indiaDate(at) && receipt.quantity.gt(0));
  const untimedPurchase = await db.inventoryLedger.findFirst({ where: { organizationId, stationId, type: 'RECEIPT', receiptLine: { receipt: { receivedDate: indiaDate(at), createdAt: { gt: at } } } }, select: { id: true } });
  if (untimedPurchase) throw new AppError(409, 'SHIFT_OPENING_RECEIPT_TIME_REQUIRED', 'A delivery on this opening date has no unloading time. Set its actual stock received time in Purchases before choosing this opening time.');
  if (untimed) throw new AppError(409, 'SHIFT_OPENING_RECEIPT_TIME_REQUIRED', 'A DSR receipt on the opening date has no actual receipt time. Record its delivery with the actual received time so FuelNerve can separate opening stock from receipts during the shift.');
}
