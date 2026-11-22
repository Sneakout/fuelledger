import { historicalTankReceipts } from './historical-receipts.js';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { shiftAtInstant, shiftContains } from '../../lib/shift-interval.js';
import { prisma } from '../../lib/prisma.js';

export const receiptDetails = {
  organizationId: true,
  stationId: true,
  referenceNo: true,
  supplierName: true,
  createdAt: true,
  receivedAt: true,
  invoice: { select: { invoiceNumber: true } },
  timingEvents: { orderBy: { changedAt: 'desc' }, take: 1, select: { changedAt: true, previousReceivedAt: true } },
} satisfies Prisma.PurchaseReceiptSelect;

type ReceiptDetails = Prisma.PurchaseReceiptGetPayload<{ select: typeof receiptDetails }>;

export function deliveryEvidence(movement: {
  id: string;
  quantityDelta: Prisma.Decimal;
  occurredAt: Date;
  receiptLine: { receipt: ReceiptDetails } | null;
}, boundary?: Date | null) {
  const receipt = movement.receiptLine?.receipt;
  const correction = receipt?.timingEvents[0];
  return {
    id: movement.id,
    quantity: movement.quantityDelta,
    occurredAt: movement.occurredAt,
    reference: receipt?.invoice?.invoiceNumber ?? receipt?.referenceNo ?? 'Stock receipt',
    supplier: receipt?.supplierName ?? null,
    recordedLate: Boolean(boundary && receipt && receipt.createdAt > boundary),
    correctedLate: Boolean(boundary && correction?.previousReceivedAt && correction.changedAt > boundary),
  };
}

const pageSize = 20;

export async function tankReceiptHistory(organizationId: string, stationId: string, before?: string) {
  return prisma.$transaction(async tx => {
    const scope = { organizationId, stationId, tankId: { not: null }, type: 'RECEIPT' as const };
    const historical = await historicalTankReceipts(tx, organizationId, stationId);
    const dsrCursor = historical.find(row => row.id === before);
    const cursor = dsrCursor ?? (before ? await tx.inventoryLedger.findFirst({
      where: { ...scope, id: before },
      select: { id: true, occurredAt: true },
    }) : null);
    if (before && !cursor) throw new AppError(404, 'RECEIPT_CURSOR_INVALID', 'Refresh the receipt history to continue.');

    const batch = await tx.inventoryLedger.findMany({
      where: {
        ...scope,
        ...(cursor ? { OR: [
          { occurredAt: { lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      select: {
        id: true, quantityDelta: true, occurredAt: true, productId: true,
        tank: { select: { id: true, code: true, productId: true, configuration: { select: { stationId: true } } } },
        product: { select: { code: true, unit: true, organizationId: true } },
        receiptLine: { select: { receipt: { select: receiptDetails } } },
      },
    });
    const rows = batch;
    const merge = <T extends { id: string; occurredAt: Date }>(posted: T[]) => {
      const combined = [...posted, ...historical.filter(row => !cursor || row.occurredAt < cursor.occurredAt || (row.occurredAt.getTime() === cursor.occurredAt.getTime() && row.id < cursor.id))]
        .sort((a,b) => b.occurredAt.getTime()-a.occurredAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      return { receipts: combined.slice(0,pageSize), nextCursor: combined.length > pageSize ? combined[pageSize-1]!.id : null };
    };
    const newest = rows[0]?.occurredAt;
    const oldest = rows.at(-1)?.occurredAt;
    if (!oldest || !newest) return merge([]);

    const station = { stationId, station: { organizationId } };
    const shiftFields = {
      id: true, shiftNumber: true, openedAt: true, closedAt: true,
      tankReadings: { select: { tankId: true } },
    } satisfies Prisma.ShiftSelect;
    const correctedTimes = [...new Set(rows.flatMap(row => {
      const receipt = row.receiptLine?.receipt;
      const previous = receipt?.timingEvents[0]?.previousReceivedAt;
      return previous && receipt?.organizationId === organizationId && receipt.stationId === stationId ? [previous.getTime()] : [];
    }))];
    const [intervals, prior, next, earlierAssignments] = await Promise.all([
      tx.shift.findMany({
        where: { ...station, openedAt: { lte: newest }, OR: [{ closedAt: null }, { closedAt: { gt: oldest } }] },
        select: shiftFields,
        orderBy: { openedAt: 'asc' },
      }),
      tx.shift.findFirst({
        where: { ...station, closedAt: { lte: oldest } },
        select: { id: true },
      }),
      tx.shift.findFirst({
        where: { ...station, openedAt: { gt: newest } },
        select: shiftFields,
        orderBy: { openedAt: 'asc' },
      }),
      Promise.all(correctedTimes.map(async timestamp => {
        try {
          return [timestamp, await shiftAtInstant(tx, organizationId, stationId, new Date(timestamp))] as const;
        } catch (error) {
          if (error instanceof AppError && error.code === 'SHIFT_INTERVAL_OVERLAP') return [timestamp, null] as const;
          throw error;
        }
      })),
    ]);

    const previousShifts = new Map(earlierAssignments);
    return merge(rows.map(movement => {
        const at = movement.occurredAt;
        const containing = intervals.filter(shift => shiftContains(shift, at));
        const during = containing[0];
        const following = intervals.find(shift => shift.openedAt > at) ?? next;
        const hadShift = Boolean(prior || intervals.some(shift => shift.openedAt <= at));
        const assigned = during ?? following;
        const validTank = movement.tank?.configuration.stationId === stationId &&
          movement.tank.productId === movement.productId && movement.product.organizationId === organizationId;
        const receipt = movement.receiptLine?.receipt;
        const validReceipt = !receipt || (receipt.organizationId === organizationId && receipt.stationId === stationId);
        const oldTime = validReceipt ? receipt?.timingEvents[0]?.previousReceivedAt : null;
        const previousShift = oldTime ? previousShifts.get(oldTime.getTime()) : null;
        return {
          ...deliveryEvidence(validReceipt ? movement : { ...movement, receiptLine: null }, during ? during.closedAt : following?.openedAt),
          previousShift: previousShift && previousShift.id !== assigned?.id ? { id: previousShift.id, number: previousShift.shiftNumber } : null,
          period: containing.length > 1 ? 'OVERLAP' as const : during ? 'DURING' as const : hadShift ? 'GAP' as const : 'BEFORE_FIRST' as const,
          shiftId: containing.length > 1 ? null : assigned?.id ?? null,
          shiftNumber: containing.length > 1 ? null : assigned?.shiftNumber ?? null,
          tankInShift: assigned?.tankReadings.some(reading => reading.tankId === movement.tank?.id) ?? null,
          tank: validTank ? movement.tank!.code : null,
          product: validTank ? movement.product.code : null,
          unit: validTank ? movement.product.unit : null,
          receiptScopeMismatch: !validReceipt,
          timingMismatch: Boolean(receipt && receipt.receivedAt.getTime() !== at.getTime()),
        };
      }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
