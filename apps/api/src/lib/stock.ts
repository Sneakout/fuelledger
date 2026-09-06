import { Prisma } from '@prisma/client';
import { AppError } from './errors.js';

type StockReader = Pick<Prisma.TransactionClient, 'tank' | 'inventoryLedger'>;

export type StockScope = {
  organizationId: string;
  stationId: string;
  productId: string;
  tankId?: string | null | undefined;
};

export type TankStockSource = {
  id: string;
  stationId: string;
  productId: string;
  openingStock: Prisma.Decimal.Value;
};

async function tankMovementDeltas(
  db: Pick<Prisma.TransactionClient, 'inventoryLedger'>,
  organizationId: string,
  tanks: TankStockSource[],
  occurredAt: Prisma.DateTimeFilter,
) {
  if (!tanks.length) return new Map<string, Prisma.Decimal>();
  const expected = new Map(tanks.map((tank) => [tank.id, tank]));
  const rows = await db.inventoryLedger.groupBy({
    by: ['tankId', 'stationId', 'productId'],
    where: {
      organizationId,
      tankId: { in: tanks.map((tank) => tank.id) },
      occurredAt,
    },
    _sum: { quantityDelta: true },
  });
  const result = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    if (!row.tankId) continue;
    const source = expected.get(row.tankId);
    if (
      !source ||
      source.stationId !== row.stationId ||
      source.productId !== row.productId
    )
      throw new AppError(
        409,
        'STOCK_SCOPE_INVALID',
        'A stock movement does not match its fuel station, product and tank. Review inventory consistency before continuing.',
      );
    result.set(row.tankId, new Prisma.Decimal(row._sum.quantityDelta ?? 0));
  }
  return result;
}

/** Authoritative book quantity for one station/product/tank scope at a stated time. */
export async function bookStockAt(
  db: StockReader,
  scope: StockScope,
  at = new Date(),
) {
  const tank = scope.tankId
    ? await db.tank.findFirst({
        where: {
          id: scope.tankId,
          productId: scope.productId,
          configuration: {
            stationId: scope.stationId,
            station: { organizationId: scope.organizationId },
          },
        },
        select: { openingStock: true },
      })
    : null;
  if (scope.tankId && !tank)
    throw new AppError(
      409,
      'TANK_NOT_FOUND',
      'The stock tank is no longer available. Review the fuel station setup.',
    );
  const movements = await db.inventoryLedger.aggregate({
    where: {
      organizationId: scope.organizationId,
      stationId: scope.stationId,
      productId: scope.productId,
      tankId: scope.tankId ?? null,
      occurredAt: { lte: at },
    },
    _sum: { quantityDelta: true },
  });
  return new Prisma.Decimal(tank?.openingStock ?? 0).add(
    movements._sum.quantityDelta ?? 0,
  );
}

/** Efficient form of bookStockAt for screens that show several configured tanks. */
export async function tankBookStocksAt(
  db: Pick<Prisma.TransactionClient, 'inventoryLedger'>,
  organizationId: string,
  tanks: TankStockSource[],
  at = new Date(),
) {
  if (!tanks.length) return new Map<string, Prisma.Decimal>();
  const movements = await tankMovementDeltas(db, organizationId, tanks, {
    lte: at,
  });
  const result = new Map(
    tanks.map((tank) => [tank.id, new Prisma.Decimal(tank.openingStock)]),
  );
  for (const tank of tanks)
    result.set(tank.id, result.get(tank.id)!.add(movements.get(tank.id) ?? 0));
  return result;
}

/** Net effective movements after one instant and through another. */
export async function tankMovementDeltasBetween(
  db: Pick<Prisma.TransactionClient, 'inventoryLedger'>,
  organizationId: string,
  tanks: TankStockSource[],
  after: Date,
  through: Date,
) {
  return tankMovementDeltas(db, organizationId, tanks, {
    gt: after,
    lte: through,
  });
}

/** Run within the same serializable transaction as the stock deduction. */
export async function assertStockAvailable(tx: Prisma.TransactionClient, scope: StockScope, quantity: Prisma.Decimal.Value, at = new Date()) {
  const available = await bookStockAt(tx, scope, at);
  if (available.lessThan(quantity)) throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${available.toFixed(3)} units of recorded stock are available at this fuel station${scope.tankId ? ' in this tank' : ''}; ${new Prisma.Decimal(quantity).toFixed(3)} are required. Check the quantity and record any missing delivery or verified opening-stock adjustment in Inventory before retrying. Do not add stock unless it was actually received.`);
}
