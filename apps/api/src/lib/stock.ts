import { Prisma } from '@prisma/client';
import { AppError } from './errors.js';

/** Run within the same serializable transaction as the stock deduction. */
export async function assertStockAvailable(tx: Prisma.TransactionClient, scope: { organizationId: string; stationId: string; productId: string; tankId?: string | null | undefined }, quantity: Prisma.Decimal.Value, at = new Date()) {
  const tank = scope.tankId ? await tx.tank.findFirst({ where: { id: scope.tankId, productId: scope.productId, configuration: { stationId: scope.stationId, station: { organizationId: scope.organizationId } } }, select: { openingStock: true } }) : null;
  if (scope.tankId && !tank) throw new AppError(409, 'TANK_NOT_FOUND', 'The stock tank is no longer available. Review the fuel station setup.');
  const balance = await tx.inventoryLedger.aggregate({ where: { ...scope, tankId: scope.tankId ?? null, occurredAt: { lte: at } }, _sum: { quantityDelta: true } });
  const available = new Prisma.Decimal(tank?.openingStock ?? 0).add(balance._sum.quantityDelta ?? 0);
  if (available.lessThan(quantity)) throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${available.toFixed(3)} units of recorded stock are available at this fuel station${scope.tankId ? ' in this tank' : ''}; ${new Prisma.Decimal(quantity).toFixed(3)} are required. Check the quantity and record any missing delivery or verified opening-stock adjustment in Inventory before retrying. Do not add stock unless it was actually received.`);
}
