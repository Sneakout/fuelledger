import { InventoryMovementType, Prisma } from '@prisma/client';
import { readTankStockTimelines, type HistoricalStockReader } from './historical-stock.js';
import { AppError } from './errors.js';

type StockReader = Pick<Prisma.TransactionClient, 'tank'> & HistoricalStockReader;

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

type TankMovementTotals = {
  net: Prisma.Decimal;
  received: Prisma.Decimal;
  adjustments: Prisma.Decimal;
};

const emptyTankMovementTotals = (): TankMovementTotals => ({
  net: new Prisma.Decimal(0),
  received: new Prisma.Decimal(0),
  adjustments: new Prisma.Decimal(0),
});

async function tankMovementTotals(
  db: Pick<Prisma.TransactionClient, 'inventoryLedger'>,
  organizationId: string,
  tanks: TankStockSource[],
  window: Prisma.InventoryLedgerWhereInput,
) {
  if (!tanks.length) return new Map<string, TankMovementTotals>();
  const expected = new Map(tanks.map((tank) => [tank.id, tank]));
  const rows = await db.inventoryLedger.groupBy({
    by: ['tankId', 'stationId', 'productId', 'type'],
    where: {
      organizationId,
      tankId: { in: tanks.map((tank) => tank.id) },
      ...window,
    },
    _sum: { quantityDelta: true },
  });
  const result = new Map<string, TankMovementTotals>();
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
    const total = result.get(row.tankId) ?? emptyTankMovementTotals();
    const delta = new Prisma.Decimal(row._sum.quantityDelta ?? 0);
    total.net = total.net.add(delta);
    if (row.type === InventoryMovementType.RECEIPT) total.received = total.received.add(delta);
    if (row.type === InventoryMovementType.ADJUSTMENT) total.adjustments = total.adjustments.add(delta);
    result.set(row.tankId, total);
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
  if (tank && scope.tankId) {
    const history = (await readTankStockTimelines(db,scope.organizationId,[{id:scope.tankId,stationId:scope.stationId,productId:scope.productId,openingStock:tank.openingStock}],at)).get(scope.tankId);
    if(history)return history.quantity;
  }
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
  db: HistoricalStockReader,
  organizationId: string,
  tanks: TankStockSource[],
  at = new Date(),
) {
  if (!tanks.length) return new Map<string, Prisma.Decimal>();
  const movements = await tankMovementTotals(db, organizationId, tanks, { occurredAt: { lte: at } });
  const result = new Map(
    tanks.map((tank) => [tank.id, new Prisma.Decimal(tank.openingStock)]),
  );
  for (const tank of tanks)
    result.set(tank.id, result.get(tank.id)!.add(movements.get(tank.id)?.net ?? 0));
  const history = await readTankStockTimelines(db,organizationId,tanks,at);
  for (const [id,position] of history) result.set(id,position.quantity);
  return result;
}

// Receipts use [previous close, opening). Closing sales and testing are already
// reflected in the previous dip, so other movements still begin after the close.
export async function tankOpeningBalances(
  db: HistoricalStockReader,
  organizationId: string,
  tanks: TankStockSource[],
  at: Date,
  previous?: { closedAt: Date | null; tankReadings: { tankId: string; closingDip: Prisma.Decimal | null }[] } | null,
  includeMovementsAtAsOf = false,
) {
  const dips = new Map(previous?.tankReadings.map(({ tankId, closingDip }) => [tankId, closingDip]));
  const withDip = tanks.filter(tank => previous?.closedAt && dips.get(tank.id) != null);
  const dipIds = new Set(withDip.map(tank => tank.id));
  const withoutDip = tanks.filter(tank => !dipIds.has(tank.id));

  const upperBound = includeMovementsAtAsOf ? { lte: at } : { lt: at };
  const movements = (sources: TankStockSource[], from?: Date) => tankMovementTotals(db, organizationId, sources, {
    OR: [
      { type: 'RECEIPT', occurredAt: { ...(from ? { gte: from } : {}), ...upperBound } },
      { type: { not: 'RECEIPT' }, occurredAt: { ...(from ? { gt: from } : {}), ...upperBound } },
    ],
  });
  const [sinceClose, sinceSetup] = await Promise.all([
    movements(withDip, previous?.closedAt ?? undefined),
    movements(withoutDip),
  ]);

  const history = await readTankStockTimelines(db,organizationId,tanks,new Date(at.getTime()-(includeMovementsAtAsOf?0:1)));
  const boundaryReceipts = previous?.closedAt && history.size ? await tankMovementTotals(db,organizationId,withDip,{type:InventoryMovementType.RECEIPT,occurredAt:previous.closedAt}) : new Map<string,TankMovementTotals>();
  const priorHistory = previous?.closedAt ? await readTankStockTimelines(db,organizationId,withDip,previous.closedAt) : new Map();
  return new Map(tanks.map(tank => {
    const historical = history.get(tank.id);
    const lastActual = dipIds.has(tank.id) ? dips.get(tank.id)! : null;
    let totals = (lastActual === null ? sinceSetup : sinceClose).get(tank.id) ?? emptyTankMovementTotals();
    let expectedOpening=lastActual === null && historical ? historical.quantity : new Prisma.Decimal(lastActual ?? tank.openingStock).add(totals.net);
    if(lastActual===null&&historical)totals={net:historical.quantity.sub(historical.opening),received:historical.receipts,adjustments:historical.adjustments};
    const stockIssues=[...(historical?.issues??[])];
    const prior=priorHistory.get(tank.id);
    if(lastActual!==null&&historical?.historical) {
      if(prior?.anchorDate===historical.anchorDate) {
        const boundary=boundaryReceipts.get(tank.id)?.received??new Prisma.Decimal(0);
        const net=historical.quantity.sub(prior.quantity).add(boundary);
        totals={net,received:historical.receipts.sub(prior.receipts).add(boundary),adjustments:historical.adjustments.sub(prior.adjustments)};
        expectedOpening=new Prisma.Decimal(lastActual).add(net);
        if(net.sub((sinceClose.get(tank.id)??emptyTankMovementTotals()).net).abs().gt('.001'))stockIssues.push('Historical daily totals contribute between these readings. Confirm receipt times and the actual opening dip; date-only DSR entries cannot be assigned to an exact shift interval.');
      } else {
        expectedOpening=historical.quantity;
        stockIssues.push('A verified DSR opening follows the previous closing. Review this checkpoint and count the actual opening dip before starting.');
      }
    }
    return [tank.id, {
      lastActual,
      received: totals.received,
      adjustments: totals.adjustments,
      netOther: totals.net.minus(totals.received).minus(totals.adjustments),
      expectedOpening,
      stockIssues,
    }];
  }));
}

/** Run within the same serializable transaction as the stock deduction. */
export async function assertStockAvailable(tx: Prisma.TransactionClient, scope: StockScope, quantity: Prisma.Decimal.Value, at = new Date()) {
  if(scope.tankId) {
    const tank=await tx.tank.findFirst({where:{id:scope.tankId,productId:scope.productId,configuration:{stationId:scope.stationId,station:{organizationId:scope.organizationId}}},select:{openingStock:true}});
    if(tank) {
      const history=(await readTankStockTimelines(tx,scope.organizationId,[{id:scope.tankId,stationId:scope.stationId,productId:scope.productId,openingStock:tank.openingStock}],at)).get(scope.tankId);
      if(history?.blocking)throw new AppError(409,'STOCK_HISTORY_REVIEW_REQUIRED',`Review the stock timeline before recording consumption. ${history.issues[0]}`);
    }
  }
  const available = await bookStockAt(tx, scope, at);
  if (available.lessThan(quantity)) throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${available.toFixed(3)} units of recorded stock are available at this fuel station${scope.tankId ? ' in this tank' : ''}; ${new Prisma.Decimal(quantity).toFixed(3)} are required. Check the quantity and record any missing delivery or verified opening-stock adjustment in Inventory before retrying. Do not add stock unless it was actually received.`);
}
