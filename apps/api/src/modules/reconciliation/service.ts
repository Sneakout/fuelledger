import type { ReconciliationInput } from '@fuelledger/shared';
import { paymentMethods } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const reconciliationInclude = { collections: { orderBy: { paymentMethod: 'asc' as const } }, reconciledBy: { select: { id: true, name: true, role: true } } } as const;
const shiftInclude = { station: { select: { id: true, name: true, code: true } }, manager: { select: { id: true, name: true, role: true } }, reconciliation: { include: reconciliationInclude } } as const;
export async function bootstrap(organizationId: string,stationIds?:string[]) {
  const shifts = await prisma.shift.findMany({ where: { station: { organizationId,...(stationIds?{id:{in:stationIds}}:{}) }, status: { in: ['RECONCILIATION_REQUIRED', 'LOCKED'] } }, orderBy: { closedAt: 'desc' }, take: 30, include: shiftInclude });
  const expectedRows = shifts.length ? await prisma.sale.groupBy({ by: ['shiftId','paymentMethod'], where: { shiftId: { in: shifts.map(shift => shift.id) } }, _sum: { totalAmount: true } }) : [];
  return { shifts: shifts.map(shift => presentShift(shift, expectedRows)) };
}
export async function reconcile(organizationId: string, userId: string, shiftId: string, input: ReconciliationInput) {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, station: { organizationId } }, include: shiftInclude });
  if (!shift) throw new AppError(404,'SHIFT_NOT_FOUND','This shift was not found.');
  if (shift.status === 'LOCKED' || shift.reconciliation) throw new AppError(409,'SHIFT_LOCKED','This shift is already reconciled and locked.');
  if (shift.status !== 'RECONCILIATION_REQUIRED') throw new AppError(409,'SHIFT_NOT_READY','Close the shift before reconciling collections.');
  const sales = await prisma.sale.groupBy({ by: ['paymentMethod'], where: { shiftId }, _sum: { totalAmount: true } });
  const expected = new Map(sales.map(row => [row.paymentMethod, Number(row._sum.totalAmount ?? 0)]));
  for (const collection of input.collections) { if (collection.adjustmentAmount !== 0 && (!collection.adjustmentReason || collection.adjustmentReason.trim().length < 3)) throw new AppError(400,'ADJUSTMENT_REASON_REQUIRED','Explain every manual adjustment.'); if ((expected.get(collection.paymentMethod) ?? 0) + collection.adjustmentAmount < 0) throw new AppError(400,'ADJUSTMENT_INVALID','An adjustment cannot make expected collections negative.'); }
  return prisma.$transaction(async tx => {
    const reconciliation = await tx.shiftReconciliation.create({ data: { shiftId, reconciledById: userId, notes: input.notes || null, collections: { create: input.collections.map(collection => { const expectedAmount = expected.get(collection.paymentMethod) ?? 0; const adjustedExpected = expectedAmount + collection.adjustmentAmount; return { paymentMethod: collection.paymentMethod, expectedAmount: new Prisma.Decimal(expectedAmount), actualAmount: new Prisma.Decimal(collection.actualAmount), adjustmentAmount: new Prisma.Decimal(collection.adjustmentAmount), adjustmentReason: collection.adjustmentAmount === 0 ? null : collection.adjustmentReason!, varianceAmount: new Prisma.Decimal(collection.actualAmount - adjustedExpected) }; }) } }, include: reconciliationInclude });
    const locked = await tx.shift.update({ where: { id: shiftId }, data: { status: 'LOCKED' }, include: shiftInclude });
    return presentShift({ ...locked, reconciliation }, input.collections.map(collection => ({ shiftId, paymentMethod: collection.paymentMethod, _sum: { totalAmount: new Prisma.Decimal(expected.get(collection.paymentMethod) ?? 0) } })));
  });
}
function presentShift(shift: any, expectedRows: Array<{ shiftId: string; paymentMethod: string; _sum: { totalAmount: Prisma.Decimal | null } }>) {
  const expected = Object.fromEntries(paymentMethods.map(method => [method, Number(expectedRows.find(row => row.shiftId === shift.id && row.paymentMethod === method)?._sum.totalAmount ?? 0)]));
  const suggestedActual = { ...expected, CASH: Math.max(0, Number(shift.closingCash ?? 0) - Number(shift.openingCash)) };
  const collections = shift.reconciliation?.collections ?? [];
  const totals = collections.length ? collections.reduce((result: { expected:number;adjustedExpected:number;actual:number;variance:number }, row: any) => ({ expected: result.expected + Number(row.expectedAmount), adjustedExpected: result.adjustedExpected + Number(row.expectedAmount) + Number(row.adjustmentAmount), actual: result.actual + Number(row.actualAmount), variance: result.variance + Number(row.varianceAmount) }), { expected:0, adjustedExpected:0, actual:0, variance:0 }) : null;
  return { ...shift, expected, suggestedActual, totals };
}
