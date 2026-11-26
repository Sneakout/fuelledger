import { resolveClosingTime, validateClosingCutoff } from './closing-time.js';
import { openingReadings, savedOpeningSource } from './opening-readings.js';
import { historicalTankReceipts } from './historical-receipts.js';
import { indiaDate, indiaDayRange } from '../../lib/india-time.js';
import { closingCollectionFacts } from '../../lib/shift-collections.js';
import { requiresFuelShift } from '@fuelledger/shared';
import { safeTransaction } from '../../lib/safe-save.js';
import { enqueueReview } from '../nerve/review-events.js';
import { assertStockAvailable, tankBookStocksAt, tankOpeningBalances } from '../../lib/stock.js';
import type {
  CloseShiftInput,
  NozzleCustodyInput,
  OpenShiftInput,
} from "@fuelledger/shared";
import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { effectivePriceAt } from "../../lib/effective-price.js";
import { prisma } from "../../lib/prisma.js";
import { shiftMovementWindow } from '../../lib/shift-interval.js';
import { deliveryEvidence, receiptDetails } from './receipt-history.js';
import { cashHandoverSnapshot } from './cash-handover.js';
import { collectionAccount, postJournal } from "../accounting/service.js";

const include = {
  station: true,
  manager: { select: { id: true, name: true, role: true } },
  users: {
    include: { user: { select: { id: true, name: true, role: true } } },
  },
  nozzleAssignments: {
    include: {
      user: { select: { id: true, name: true, role: true } },
      nozzle: { include: { product: true, dispenser: true } },
    },
  },
  tankReadings: { include: { tank: { include: { product: true } } } },
  nozzleReadings: {
    include: { nozzle: { include: { product: true, dispenser: true } } },
  },
};
const exact = (ids: string[], values: Array<{ id: string }>) =>
  new Set(ids).size === ids.length &&
  ids.length === values.length &&
  ids.every((id) => values.some((value) => value.id === id));
type BridgeDb = Pick<Prisma.TransactionClient, 'inventoryLedger' | 'nozzle' | 'historicalSalesImport' | 'tank'>;
async function stockBridge(db: BridgeDb, organizationId: string, shift: { id: string; shiftNumber: number; stationId: string; configurationId: string; openingSource?: unknown; openedAt: Date; closedAt: Date | null; tankReadings: Array<{ tankId: string; tank?: { productId: string } }>; nozzleReadings: Array<{ nozzleId: string }> }, asOf = new Date(), closing = false, strictCutoff = false) {
  const source = savedOpeningSource(shift.openingSource);
  const starts = source?.tanks.map(tank => indiaDayRange(tank.date).start) ?? [];
  const earliest = starts.reduce((min, at) => at < min ? at : min, shift.openedAt);
  const occurredAt = shiftMovementWindow(closing ? { openedAt: earliest, closedAt: asOf } : { ...shift, openedAt: earliest }, asOf);
  const [movements, nozzles] = await Promise.all([
    db.inventoryLedger.findMany({
      where: {
        organizationId,
        stationId: shift.stationId,
        tankId: { in: shift.tankReadings.map((reading) => reading.tankId) },
        OR: [
          { type: 'RECEIPT', occurredAt },
          {
            type: 'ADJUSTMENT', occurredAt,
            // A previous shift's testing loss may share the new opening timestamp.
            OR: [{ occurredAt: { gt: shift.openedAt } }, { note: null }, { note: { not: { startsWith: 'Nozzle testing not returned · ' } } }],
          },
          { type: 'SALE', sale: { shiftId: null }, occurredAt },
          ...(shift.closedAt ? [
            { type: 'SALE' as const, sale: { shiftId: shift.id } },
            { type: 'ADJUSTMENT' as const, occurredAt: shift.closedAt, note: { startsWith: 'Nozzle testing not returned · ', endsWith: ` · shift #${shift.shiftNumber}` } },
          ] : [
            // Previously recorded DEF sales retain their original shift link.
            { type: 'SALE' as const, sale: { shiftId: shift.id, product: { NOT: [{ category: 'FUEL' as const }, { code: { in: ['MS', 'HSD'] } }] } } },
          ]),
        ],
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tankId: true,
        productId: true,
        type: true,
        sale: { select: { shiftId: true, product: { select: { code: true, category: true } } } },
        quantityDelta: true,
        note: true,
        occurredAt: true,
        receiptLine: { select: { receipt: { select: receiptDetails } } },
      },
    }),
    db.nozzle.findMany({
      where: { id: { in: shift.nozzleReadings.map((reading) => reading.nozzleId) } },
      select: {
        id: true,
        code: true,
        productId: true,
        product: { select: { code: true, category: true } },
        dispenser: { select: { code: true } },
        tankMappings: { where: { tank: { configurationId: shift.configurationId, status: 'ACTIVE' } }, select: { tankId: true } },
      },
    }),
  ]);
  const dsrReceipts = starts.length ? await historicalTankReceipts(db, organizationId, shift.stationId) : [];
  return new Map(shift.tankReadings.map((reading) => {
    const baseline = source?.tanks.find(tank => tank.id === reading.tankId);
    const start = baseline ? indiaDayRange(baseline.date).start : shift.openedAt;
    const rows = movements.filter((movement) => movement.tankId === reading.tankId &&
      (movement.occurredAt >= start || movement.sale?.shiftId === shift.id));
    const supplemental = dsrReceipts.filter(receipt => baseline && receipt.occurredAt >= start && receipt.occurredAt <= (shift.closedAt ?? asOf) && receipt.productId === reading.tank?.productId);
    if (closing && strictCutoff && supplemental.some(receipt => receipt.businessDate === indiaDate(asOf) && receipt.quantity.gt(0)))
      throw new AppError(409, 'SHIFT_RECEIPT_TIME_REQUIRED', 'A DSR receipt on the closing date has no actual receipt time. Record its delivery with the actual received time before closing at a selected time.');
    if (closing && baseline && supplemental.some(receipt => receipt.allocationRequired || receipt.overlapMismatch))
      throw new AppError(409, 'DSR_RECEIPT_REVIEW_REQUIRED', 'Review the DSR receipt allocation or overlapping purchases before closing this shift.');
    if (reading.tank && rows.some(movement => movement.productId !== reading.tank!.productId))
      throw new AppError(409, 'STOCK_SCOPE_INVALID', 'A stock movement does not match the product assigned to this tank.');
    const receipts = rows.filter((movement) => movement.type === 'RECEIPT');
    const adjustments = rows.filter((movement) => movement.type === 'ADJUSTMENT' &&
      movement.occurredAt.getTime() !== shift.closedAt?.getTime());
    const sales = rows.filter(movement => movement.type === 'SALE');
    const testingLoss = rows.filter(movement => movement.type === 'ADJUSTMENT' &&
      movement.occurredAt.getTime() === shift.closedAt?.getTime());
    return [reading.tankId, {
      received: receipts.reduce((sum, movement) => sum.add(movement.quantityDelta), new Prisma.Decimal(0)).add(supplemental.filter(receipt => receipt.tankId === reading.tankId).reduce((sum, receipt) => sum.add(receipt.quantity), new Prisma.Decimal(0))),
      historicalReceived: supplemental.filter(receipt => receipt.tankId === reading.tankId).reduce((sum, receipt) => sum.add(receipt.quantity), new Prisma.Decimal(0)),
      counterSales: sales.filter(movement => !movement.sale?.shiftId || !requiresFuelShift(movement.sale.product))
        .reduce((sum, movement) => sum.minus(movement.quantityDelta), new Prisma.Decimal(0)),
      postedSales: shift.closedAt ? sales.reduce((sum, movement) => sum.minus(movement.quantityDelta), new Prisma.Decimal(0)) : undefined,
      postedTestingLoss: shift.closedAt ? testingLoss.reduce((sum, movement) => sum.minus(movement.quantityDelta), new Prisma.Decimal(0)) : undefined,
      adjustments: adjustments.reduce((sum, movement) => sum.add(movement.quantityDelta), new Prisma.Decimal(0)),
      deliveries: receipts.map(movement => {
        const receipt = movement.receiptLine?.receipt;
        const validReceipt = !receipt || (receipt.organizationId === organizationId && receipt.stationId === shift.stationId);
        return deliveryEvidence(validReceipt ? movement : { ...movement, receiptLine: null }, shift.closedAt);
      }),
      adjustmentDetails: adjustments.map((movement) => ({ id: movement.id, quantity: movement.quantityDelta, note: movement.note, occurredAt: movement.occurredAt })),
      nozzles: nozzles.filter((nozzle) => {
        const productTanks = shift.tankReadings.filter((tankReading) => tankReading.tank?.productId === nozzle.productId);
        const resolvedTankId = nozzle.tankMappings.length === 1
          ? nozzle.tankMappings[0]!.tankId
          : nozzle.tankMappings.length === 0 && productTanks.length === 1
            ? productTanks[0]!.tankId
            : undefined;
        return resolvedTankId === reading.tankId;
      }).map((nozzle) => ({ id: nozzle.id, code: `${nozzle.dispenser.code} / ${nozzle.code}`, counter: !requiresFuelShift(nozzle.product) })),
    }] as const;
  }));
}
async function withStockBridge<T extends { id: string; shiftNumber: number; stationId: string; configurationId: string; openingSource?: unknown; openedAt: Date; closedAt: Date | null; tankReadings: Array<{ tankId: string; tank?: { productId: string } }>; nozzleReadings: Array<{ nozzleId: string }> }>(organizationId: string, shift: T, db: BridgeDb, asOf = new Date()) {
  const bridge = await stockBridge(db, organizationId, shift, asOf);
  return { ...shift, tankReadings: shift.tankReadings.map((reading) => ({ ...reading, receivedDuringShift: bridge.get(reading.tankId)?.received ?? new Prisma.Decimal(0), stockBridge: bridge.get(reading.tankId) })) };
}
export async function shiftDetails(organizationId: string, id: string) {
  return prisma.$transaction(async tx => {
    const shift = await tx.shift.findFirst({ where: { id, station: { organizationId } }, include });
    if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'This shift is unavailable.');
    const [previous, movedOut, withBridge] = await Promise.all([
      tx.shift.findFirst({
        where: { id: { not: id }, stationId: shift.stationId, closedAt: { lte: shift.openedAt } },
        orderBy: { closedAt: 'desc' },
        select: { closedAt: true, tankReadings: { select: { tankId: true, closingDip: true } } },
      }),
      shift.closedAt ? tx.receiptTimingAuditEvent.findMany({
        where: {
          organizationId,
          stationId: shift.stationId,
          receipt: { organizationId, stationId: shift.stationId },
          previousReceivedAt: { gte: shift.openedAt, lt: shift.closedAt },
          OR: [{ receivedAt: { lt: shift.openedAt } }, { receivedAt: { gte: shift.closedAt } }],
        },
        orderBy: { changedAt: 'desc' },
        select: { id: true, previousReceivedAt: true, receivedAt: true, receipt: { select: { referenceNo: true } } },
      }) : [],
      withStockBridge(organizationId, shift, tx),
    ]);
    const openings = await tankOpeningBalances(tx, organizationId, shift.tankReadings.map(({ tank }) => ({
      id: tank.id, stationId: shift.stationId, productId: tank.productId, openingStock: tank.openingStock,
    })), shift.openedAt, previous);
    return {
      ...summary(withBridge),
      openingStockReview: shift.tankReadings.map(reading => {
        const dsr = savedOpeningSource(shift.openingSource)?.tanks.find(source => source.id === reading.tankId);
        return {
          code: reading.tank.code,
          actual: reading.openingDip,
          ...openings.get(reading.tankId)!,
          ...(dsr ? { expectedOpening: new Prisma.Decimal(dsr.value), received: new Prisma.Decimal(0), adjustments: new Prisma.Decimal(0), netOther: new Prisma.Decimal(0), checkpoint: { source: 'Confirmed DSR', date: dsr.date, at: null, incomplete: false } } : {}),
        };
      }),
      receiptTimingChanges: movedOut,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function bootstrap(organizationId: string, stationIds?: string[]) {
  return prisma.$transaction(tx => readOperationsBootstrap(tx, organizationId, stationIds), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

async function readOperationsBootstrap(tx: Prisma.TransactionClient, organizationId: string, stationIds?: string[]) {
  const asOf = new Date();
  const shiftScope = { station: { organizationId, ...(stationIds ? { id: { in: stationIds } } : {}) } };
  const [stations, users, recentShifts, openShifts] = await Promise.all([
    tx.station.findMany({
      where: {
        organizationId,
        active: true,
        ...(stationIds ? { id: { in: stationIds } } : {}),
      },
      include: {
        configurations: {
          where: { active: true },
          take: 1,
          include: {
            tanks: { where: { status: "ACTIVE" }, include: { product: true } },
            dispensers: {
              where: { status: "ACTIVE" },
              include: {
                nozzles: {
                  where: { status: "ACTIVE", product: { OR: [{ category: "FUEL" }, { code: { in: ["MS", "HSD"] } }] } },
                  include: { product: true, attendantAssignment: { select: { userId: true } } },
                },
              },
            },
          },
        },
        shifts: {
          where: { closedAt: { not: null } },
          orderBy: { closedAt: "desc" },
          take: 1,
          select: {
            id: true,
            shiftNumber: true,
            closedAt: true,
            closingCash: true,
            nozzleAssignments: { select: { nozzleId: true, userId: true } },
            tankReadings: { select: { tankId: true, closingDip: true } },
            nozzleReadings: { select: { nozzleId: true, closingMeter: true } },
          },
        },
      },
    }),
    tx.user.findMany({
      where: {
        organizationId,
        active: true,
        ...(stationIds
          ? {
              OR: [
                { role: { in: ["OWNER", "ACCOUNTANT"] } },
                { stationAccess: { some: { stationId: { in: stationIds } } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        role: true,
        stationAccess: { select: { stationId: true } },
      },
    }),
    tx.shift.findMany({ where: { ...shiftScope, status: { notIn: ['OPEN', 'CANCELLED'] } }, orderBy: { openedAt: 'desc' }, take: 8, include }),
    tx.shift.findMany({ where: { ...shiftScope, status: 'OPEN' }, orderBy: { openedAt: 'desc' }, include }),
  ]);
  const shifts = [...openShifts, ...recentShifts];
  const stockSources = stations.flatMap((station) =>
    (station.configurations[0]?.tanks ?? []).map((tank) => ({
      id: tank.id,
      stationId: station.id,
      productId: tank.productId,
      openingStock: tank.openingStock,
    })),
  );
  const inventoryByTank = await tankBookStocksAt(
    tx,
    organizationId,
    stockSources,
    asOf,
  );
  const shapedStations = await Promise.all(stations.map(async ({ shifts: [previous], ...station }) => {
    const stationTanks = stockSources.filter(tank => tank.stationId === station.id);
    const openings = await tankOpeningBalances(tx, organizationId, stationTanks, asOf, previous, true);
    return {
      ...station,
      openingReadings: await openingReadings(tx, organizationId, station.id, station.configurations[0]?.tanks ?? [], station.configurations[0]?.dispensers.flatMap(dispenser => dispenser.nozzles) ?? [], previous ?? null, asOf),
      availableTankStock: stationTanks.map(tank => ({
        id: tank.id,
        value: inventoryByTank.get(tank.id) ?? new Prisma.Decimal(tank.openingStock),
        ...openings.get(tank.id)!,
      })),
      lastClosing: previous ? {
        shiftId: previous.id,
        shiftNumber: previous.shiftNumber,
        closedAt: previous.closedAt!,
        closingCash: previous.closingCash,
        nozzleAssignments: previous.nozzleAssignments,
        tankReadings: previous.tankReadings.flatMap(row => {
          if (row.closingDip === null) return [];
          const opening = openings.get(row.tankId);
          return [{
            id: row.tankId,
            value: row.closingDip,
            lastActual: row.closingDip,
            receivedBetween: opening?.received ?? new Prisma.Decimal(0),
            adjustmentsBetween: opening?.adjustments ?? new Prisma.Decimal(0),
            expectedOpening: opening?.expectedOpening ?? row.closingDip,
          }];
        }),
        nozzleReadings: previous.nozzleReadings.flatMap(row =>
          row.closingMeter === null ? [] : [{ id: row.nozzleId, value: row.closingMeter }],
        ),
      } : null,
    };
  }));
  return {
    stations: shapedStations,
    cancelledShifts: await tx.shift.findMany({ where: { ...shiftScope, status: 'CANCELLED' }, orderBy: { openedAt: 'desc' }, take: 10, select: { id: true, stationId: true, shiftNumber: true, openedAt: true, cancellation: true } }),
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      stationIds: user.stationAccess.map((access) => access.stationId),
    })),
    stockVarianceTolerance: Number((await tx.ownerNotificationSettings.findUnique({ where: { organizationId }, select: { stockVarianceTolerance: true } }))?.stockVarianceTolerance ?? 50),
    shifts: await Promise.all(shifts.map(async (shift) => summary(await withStockBridge(organizationId, shift, tx, asOf)))),
  };
}
export async function openShift(organizationId: string, input: OpenShiftInput, enteredById: string | null = null) {
  return safeTransaction(prisma, async (tx) => {
  const openedAt = new Date();
  const station = await tx.station.findFirst({
    where: { id: input.stationId, organizationId, active: true },
    include: {
      configurations: {
        where: { active: true },
        take: 1,
        include: {
          tanks: { where: { status: "ACTIVE" } },
          dispensers: {
            where: { status: "ACTIVE" },
            include: { nozzles: { where: { status: "ACTIVE", product: { OR: [{ category: "FUEL" }, { code: { in: ["MS", "HSD"] } }] } } } },
          },
        },
      },
    },
  });
  if (!station)
    throw new AppError(404, "STATION_NOT_FOUND", "Choose an active fuel station.");
  const config = station.configurations[0];
  if (!config)
    throw new AppError(
      400,
      "STATION_NOT_CONFIGURED",
      "This fuel station needs an active configuration first.",
    );
  const tanks = config.tanks;
  const nozzles = config.dispensers.flatMap((dispenser) => dispenser.nozzles);
  if (
    !exact(
      input.tankReadings.map((reading) => reading.id),
      tanks,
    ) ||
    !exact(
      input.nozzleReadings.map((reading) => reading.id),
      nozzles,
    )
  )
    throw new AppError(
      400,
      "READINGS_INCOMPLETE",
      "Enter one opening reading for every active tank and nozzle.",
    );
  const previous = await tx.shift.findFirst({
    where: { stationId: station.id, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: {
      id: true,
      closingCash: true,
      shiftNumber: true,
      closedAt: true,
      tankReadings: { select: { tankId: true, closingDip: true } },
      nozzleReadings: { select: { nozzleId: true, closingMeter: true } },
    },
  });
  const baseline = await openingReadings(tx, organizationId, station.id, tanks, nozzles, previous, openedAt);
  if (baseline.blockingReason) throw new AppError(409, 'OPENING_DSR_REVIEW_REQUIRED', baseline.blockingReason);
  if ((baseline.tanks.length || input.openingReadingsVersion) && input.openingReadingsVersion !== baseline.version)
    throw new AppError(409, 'OPENING_SOURCE_CHANGED', 'The opening readings have changed. Refresh the opening form and review the latest DSR readings.');
  const cashHandover = cashHandoverSnapshot(input, previous, enteredById, openedAt);
  const tankSources = tanks.map((tank) => ({
    id: tank.id,
    stationId: station.id,
    productId: tank.productId,
    openingStock: tank.openingStock,
  }));
  const openings = await tankOpeningBalances(tx, organizationId, tankSources, openedAt, previous);
  for (const reading of input.tankReadings) {
    const tank = tanks.find((item) => item.id === reading.id)!;
    const dsr = baseline.tanks.find(source => source.id === tank.id);
    const expected = dsr?.value ?? Number(openings.get(tank.id)!.expectedOpening);
    if (dsr && Math.abs(reading.value - expected) > 0.001)
      throw new AppError(409, 'OPENING_DSR_TANK_MISMATCH', `This tank must open from its confirmed DSR morning stock of ${expected.toLocaleString()} L. Correct the DSR first if needed.`);
    if (Math.abs(reading.value - expected) > 0.001 && !input.notes?.trim())
      throw new AppError(400, "OPENING_TANK_VARIANCE_NOTE_REQUIRED", `Add a reason for the ${tank.code} opening difference of ${Math.abs(reading.value - expected).toLocaleString()} L.`);
  }
  for (const reading of input.nozzleReadings) {
    const nozzle = nozzles.find((item) => item.id === reading.id)!;
    const expected = baseline.nozzles.find(source => source.id === nozzle.id)!.value;
    if (Math.abs(reading.value - expected) > 0.001)
      throw new AppError(
        409,
        "OPENING_READING_MISMATCH",
        `Nozzle ${nozzle.code} must open at ${expected.toLocaleString()} L from the latest opening source. Refresh and review the opening readings.`,
      );
  }
  const assignedNozzleIds = input.nozzleAssignments.map((row) => row.nozzleId);
  if (
    !exact(assignedNozzleIds, nozzles)
  )
    throw new AppError(
      400,
      "NOZZLE_ASSIGNMENTS_INVALID",
      "Assign one attendant to every active nozzle before opening the shift.",
    );
  const users = await tx.user.findMany({
    where: {
      organizationId,
      id: { in: [input.managerId, ...input.userIds] },
      active: true,
    },
  });
  if (
    users.length !== new Set([input.managerId, ...input.userIds]).size ||
    input.nozzleAssignments.some((row) => !input.userIds.includes(row.userId))
  )
    throw new AppError(
      400,
      "SHIFT_USER_INVALID",
      "Each nozzle attendant must be on the shift team.",
    );
  if (
    await tx.shift.findFirst({
      where: { stationId: station.id, status: "OPEN" },
    })
  )
    throw new AppError(
      409,
      "SHIFT_ALREADY_OPEN",
      "Close the current open shift before opening another one.",
    );
  const latest = await tx.shift.aggregate({
    where: { stationId: station.id },
    _max: { shiftNumber: true },
  });
  const shift = await tx.shift.create({
    data: {
      stationId: station.id,
      configurationId: config.id,
      shiftNumber: (latest._max.shiftNumber ?? 0) + 1,
      managerId: input.managerId,
      status: "OPEN",
      openingSource: baseline as unknown as Prisma.InputJsonValue,
      openedAt,
      openingCash: new Prisma.Decimal(input.openingCash),
      openingCashHandover: cashHandover,
      notes: input.notes || null,
      users: {
        create: Array.from(new Set(input.userIds)).map((userId) => ({
          userId,
        })),
      },
      nozzleAssignments: {
        create: input.nozzleAssignments.map((row) => ({
          nozzleId: row.nozzleId,
          userId: row.userId,
        })),
      },
      tankReadings: {
        create: input.tankReadings.map((reading) => ({
          tankId: reading.id,
          openingDip: new Prisma.Decimal(reading.value),
        })),
      },
      nozzleReadings: {
        create: input.nozzleReadings.map((reading) => ({
          nozzleId: reading.id,
          openingMeter: new Prisma.Decimal(reading.value),
        })),
      },
    },
    include,
  });
  return summary(shift);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function closeShift(
  organizationId: string,
  id: string,
  input: CloseShiftInput,
  enteredById: string | null = null,
) {
  return safeTransaction(prisma, async (tx) => {
  const shift = await tx.shift.findFirst({
    where: { id, station: { organizationId } },
    include,
  });
  if (!shift)
    throw new AppError(404, "SHIFT_NOT_FOUND", "This shift was not found.");
  if (shift.status !== "OPEN")
    throw new AppError(
      409,
      "SHIFT_NOT_OPEN",
      "Only an open shift can be closed.",
    );
  if (
    !exact(
      input.tankReadings.map((reading) => reading.id),
      shift.tankReadings.map((reading) => ({ id: reading.tankId })),
    ) ||
    !exact(
      input.nozzleReadings.map((reading) => reading.id),
      shift.nozzleReadings.map((reading) => ({ id: reading.nozzleId })),
    ) ||
    !exact(
      input.nozzleCollections.map((collection) => collection.nozzleId),
      shift.nozzleAssignments.map((assignment) => ({ id: assignment.nozzleId })),
    )
  )
    throw new AppError(
      400,
      "READINGS_INCOMPLETE",
      "Enter one closing reading and staff collection for every active nozzle.",
    );
  for (const reading of input.nozzleReadings) {
    const opening = shift.nozzleReadings.find(
      (value) => value.nozzleId === reading.id,
    )!;
    if (reading.value < Number(opening.openingMeter))
      throw new AppError(
        400,
        "READING_INVALID",
        "A closing meter reading cannot be below its opening reading.",
      );
    const meterMovement = reading.value - Number(opening.openingMeter);
    if (reading.testingQuantity - meterMovement > 0.001)
      throw new AppError(
        400,
        "TESTING_QUANTITY_INVALID",
        `${opening.nozzle.dispenser.code} / ${opening.nozzle.code} testing quantity cannot exceed its ${meterMovement.toLocaleString()} L meter movement.`,
      );
  }
  const recordedAt = new Date();
  const closingAsOf = resolveClosingTime(shift.openedAt, input.closedAt, recordedAt);
  if (input.closedAt) await validateClosingCutoff(tx, organizationId, shift, closingAsOf);
  const [bridgeByTank, varianceSettings] = await Promise.all([
    stockBridge(tx, organizationId, shift, closingAsOf, true, Boolean(input.closedAt)),
    tx.ownerNotificationSettings.findUnique({ where: { organizationId }, select: { stockVarianceTolerance: true } }),
  ]);
  const tolerance = Number(varianceSettings?.stockVarianceTolerance ?? 50);
  const tankChecks = input.tankReadings.map((tankReading) => {
    const saved = shift.tankReadings.find((reading) => reading.tankId === tankReading.id)!;
    const bridge = bridgeByTank.get(tankReading.id);
    const nozzleIds = new Set(bridge?.nozzles.map((nozzle) => nozzle.id) ?? []);
    const related = input.nozzleReadings.filter((reading) => nozzleIds.has(reading.id));
    const sales = Number(bridge?.counterSales ?? 0) + related.reduce((sum, reading) => {
      const opening = shift.nozzleReadings.find((value) => value.nozzleId === reading.id)!;
      return bridge?.nozzles.find(nozzle => nozzle.id === reading.id)?.counter ? sum : sum + reading.value - Number(opening.openingMeter) - reading.testingQuantity;
    }, 0);
    const testingLoss = related.reduce((sum, reading) => sum + (reading.testingReturned ? 0 : reading.testingQuantity), 0);
    const expected = Number(saved.openingDip) + Number(bridge?.received ?? 0) + Number(bridge?.adjustments ?? 0) - sales - testingLoss;
    const difference = tankReading.value - expected;
    return { tank: saved.tank.code, opening: Number(saved.openingDip), actual: tankReading.value, expected, difference, sales, testingLoss };
  });
  if (tankChecks.some(item => item.expected < -0.001))
    throw new AppError(409, 'STOCK_INSUFFICIENT', 'The closing nozzle movements exceed the stock available from opening stock and recorded receipts. Review the readings and deliveries.');
  const unchanged = tankChecks.filter((item) =>
    item.sales + item.testingLoss > 0.001 &&
    Math.abs(item.actual - item.opening) <= 0.001 &&
    Math.abs(item.actual - item.expected) > 0.001,
  );
  if (unchanged.length)
    throw new AppError(
      400,
      'TANK_READING_UNCHANGED',
      `Enter the measured closing dip for ${unchanged.map((item) => `${item.tank} (expected about ${item.expected.toLocaleString('en-IN', { maximumFractionDigits: 3 })} L after ${(item.sales + item.testingLoss).toLocaleString('en-IN', { maximumFractionDigits: 3 })} L of nozzle stock movement)`).join(' and ')}. The opening reading cannot be reused when fuel moved. Remeasure the tank before closing the shift.`,
    );
  const unexplained = tankChecks.filter((item) => Math.abs(item.difference) - tolerance > 0.001);
  if (unexplained.length && !input.notes?.trim())
    throw new AppError(
      400,
      'STOCK_VARIANCE_NOTE_REQUIRED',
      `Add a closing note explaining ${unexplained.map((item) => `${item.tank}'s ${Math.abs(item.difference).toLocaleString('en-IN')} L ${item.difference < 0 ? 'shortage' : 'excess'}`).join(' and ')}. The allowed difference is ${tolerance.toLocaleString('en-IN')} L.`,
    );
  const meteredSales = await tx.sale.groupBy({
    by: ["nozzleId"],
    where: { shiftId: id, kind: "METERED" },
    _sum: { quantity: true },
  });
  for (const reading of input.nozzleReadings) {
    const opening = shift.nozzleReadings.find(
      (value) => value.nozzleId === reading.id,
    )!;
    const meterMovement =
      reading.value - Number(opening.openingMeter) - reading.testingQuantity;
    const recorded = Number(
      meteredSales.find((sale) => sale.nozzleId === reading.id)?._sum
        .quantity ?? 0,
    );
    if (recorded - meterMovement > 0.001) {
      const assignment = shift.nozzleAssignments.find(
        (row) => row.nozzleId === reading.id,
      );
      throw new AppError(
        409,
        "METER_SALES_MISMATCH",
        `${opening.nozzle.dispenser.code} / ${opening.nozzle.code}${assignment ? ` (${assignment.user.name})` : ""} moved ${meterMovement.toLocaleString()} L, but ${recorded.toLocaleString()} L was already recorded. Correct the closing meter or the duplicate sale before closing.`,
      );
    }
  }
  const closed = await (async () => {
    const claimed = await tx.shift.updateMany({ where: { id, status: "OPEN" }, data: { status: "RECONCILIATION_REQUIRED" } });
    if (claimed.count !== 1) throw new AppError(409, "SHIFT_NOT_OPEN", "This shift was already closed. Refresh to review it.");
    const closedAt = closingAsOf;
    for (const reading of input.nozzleReadings) {
      const opening = shift.nozzleReadings.find(
        (value) => value.nozzleId === reading.id,
      )!;
      const meterMovement =
        reading.value - Number(opening.openingMeter) - reading.testingQuantity;
      const recorded = Number(
        meteredSales.find((sale) => sale.nozzleId === reading.id)?._sum
          .quantity ?? 0,
      );
      const missingQuantity = meterMovement - recorded;
      if (
        missingQuantity <= 0.001 &&
        (reading.testingQuantity <= 0.001 || reading.testingReturned)
      )
        continue;

      const assignment = shift.nozzleAssignments.find(
        (row) => row.nozzleId === reading.id,
      )!;
      const nozzle = await tx.nozzle.findUnique({
        where: { id: reading.id },
        include: {
          product: {
            include: {
              sellingPriceHistory: {
                where: { effectiveFrom: { lte: shift.openedAt } },
                orderBy: { effectiveFrom: "desc" },
                take: 1,
              },
              purchasePriceHistory: {
                where: { effectiveFrom: { lte: closedAt } },
                orderBy: { effectiveFrom: "desc" },
                take: 1,
              },
            },
          },
          tankMappings: {
            where: {
              tank: {
                configurationId: shift.configurationId,
                status: "ACTIVE",
              },
            },
            select: { tankId: true, tank: { select: { productId: true } } },
          },
        },
      });
      if (!nozzle)
        throw new AppError(409, "NOZZLE_NOT_FOUND", "A shift nozzle is no longer available.");
      const compatibleTanks = nozzle.tankMappings.filter(
        (mapping) => mapping.tank.productId === nozzle.productId,
      );
      const shiftProductTanks = shift.tankReadings
        .filter((tankReading) => tankReading.tank.productId === nozzle.productId)
        .map((tankReading) => ({ tankId: tankReading.tankId }));
      const resolvedTanks =
        compatibleTanks.length > 0 ? compatibleTanks : shiftProductTanks;
      if (resolvedTanks.length !== 1)
        throw new AppError(
          409,
          "NOZZLE_TANK_AMBIGUOUS",
          resolvedTanks.length === 0
            ? `${opening.nozzle.dispenser.code} / ${opening.nozzle.code} has no ${nozzle.product.code} tank in the open shift. Review the shift setup and try again.`
            : `${opening.nozzle.dispenser.code} / ${opening.nozzle.code} has more than one active ${nozzle.product.code} tank. Choose one source tank before closing.`,
        );

      const unitPrice =
        nozzle.product.sellingPriceHistory[0]?.price ?? nozzle.product.sellingPrice;
      const purchasePrice = effectivePriceAt(
        nozzle.product.purchasePrice,
        nozzle.product.purchasePriceHistory,
        closedAt,
      );
      const tankId = resolvedTanks[0]!.tankId;
      if (requiresFuelShift(nozzle.product) && missingQuantity > 0.001) {
        const quantity = new Prisma.Decimal(missingQuantity);
        const totalAmount = quantity.mul(unitPrice);
        const meterClosing = new Prisma.Decimal(reading.value).sub(
          reading.testingQuantity,
        );
        const meterOpening = meterClosing.sub(quantity);
        // The complete DSR-based interval was checked above against its saved
        // morning stock + once-counted receipts - all nozzle movements/testing.
        // A daily DSR receipt has no exact timestamp, so it cannot satisfy the
        // unrelated generic intraday availability check; do not invent a time.
        if (nozzle.product.inventoryTracked && !savedOpeningSource(shift.openingSource)?.tanks.some(source => source.id === tankId))
          await assertStockAvailable(
            tx,
            {
              organizationId,
              stationId: shift.stationId,
              productId: nozzle.productId,
              tankId,
            },
            quantity,
            closedAt,
          );
        const sale = await tx.sale.create({
          data: {
            organizationId,
            stationId: shift.stationId,
            shiftId: shift.id,
            productId: nozzle.productId,
            employeeId: assignment.userId,
            tankId,
            nozzleId: nozzle.id,
            kind: "METERED",
            paymentMethod: "OTHER",
            quantity,
            unitPrice,
            totalAmount,
            meterOpening,
            meterClosing,
            notes:
              "Automatically calculated from shift closing meter; payment method pending reconciliation.",
            occurredAt: closedAt,
          },
        });
        if (nozzle.product.inventoryTracked)
          await tx.inventoryLedger.create({
            data: {
              organizationId,
              stationId: shift.stationId,
              productId: nozzle.productId,
              tankId,
              type: "SALE",
              quantityDelta: quantity.neg(),
              unitCost: purchasePrice,
              saleId: sale.id,
              occurredAt: closedAt,
              createdById: assignment.userId,
            },
          });
        await postJournal(tx, {
          organizationId,
          stationId: shift.stationId,
          createdById: assignment.userId,
          journalDate: closedAt,
          reference: `SALE-${sale.id.slice(-8)}`,
          description: `${nozzle.product.name} sale · automatically calculated at shift close`,
          sourceType: "SALE",
          sourceId: sale.id,
          lines: [
            { account: collectionAccount("OTHER"), debit: totalAmount },
            { account: "4000", credit: totalAmount },
            ...(nozzle.product.inventoryTracked
              ? [
                  { account: "5000", debit: quantity.mul(purchasePrice) },
                  { account: "1200", credit: quantity.mul(purchasePrice) },
                ]
              : []),
          ],
        });
      }

      if (reading.testingQuantity > 0.001 && !reading.testingReturned) {
        const testingQuantity = new Prisma.Decimal(reading.testingQuantity);
        // The complete DSR-based interval was checked above against its saved
        // morning stock + once-counted receipts - all nozzle movements/testing.
        // A daily DSR receipt has no exact timestamp, so it cannot satisfy the
        // unrelated generic intraday availability check; do not invent a time.
        if (nozzle.product.inventoryTracked && !savedOpeningSource(shift.openingSource)?.tanks.some(source => source.id === tankId))
          await assertStockAvailable(
            tx,
            {
              organizationId,
              stationId: shift.stationId,
              productId: nozzle.productId,
              tankId,
            },
            testingQuantity,
            closedAt,
          );
        if (nozzle.product.inventoryTracked)
          await tx.inventoryLedger.create({
            data: {
              organizationId,
              stationId: shift.stationId,
              productId: nozzle.productId,
              tankId,
              type: "ADJUSTMENT",
              quantityDelta: testingQuantity.neg(),
              unitCost: purchasePrice,
              note: `Nozzle testing not returned · ${opening.nozzle.dispenser.code} / ${opening.nozzle.code} · shift #${shift.shiftNumber}`,
              occurredAt: closedAt,
              createdById: assignment.userId,
            },
          });
        if (nozzle.product.inventoryTracked)
          await postJournal(tx, {
            organizationId,
            stationId: shift.stationId,
            createdById: assignment.userId,
            journalDate: closedAt,
            reference: `TEST-${shift.id.slice(-6)}-${nozzle.id.slice(-4)}`,
            description: `${nozzle.product.name} used for nozzle testing and not returned`,
            sourceType: "SHIFT_TESTING",
            sourceId: `${shift.id}:${nozzle.id}`,
            lines: [
              { account: "5000", debit: testingQuantity.mul(purchasePrice) },
              { account: "1200", credit: testingQuantity.mul(purchasePrice) },
            ],
          });
      }
    }
    await Promise.all(
      input.tankReadings.map((reading) =>
        tx.shiftTankReading.update({
          where: { shiftId_tankId: { shiftId: id, tankId: reading.id } },
          data: { closingDip: new Prisma.Decimal(reading.value) },
        }),
      ),
    );
    await Promise.all(
      input.nozzleReadings.map((reading) =>
        tx.shiftNozzleReading.update({
          where: { shiftId_nozzleId: { shiftId: id, nozzleId: reading.id } },
          data: {
            closingMeter: new Prisma.Decimal(reading.value),
            testingQuantity: new Prisma.Decimal(reading.testingQuantity),
            testingReturned: reading.testingReturned,
          },
        }),
      ),
    );
    await Promise.all(
      input.nozzleCollections.map((collection) =>
        tx.shiftNozzleAssignment.update({
          where: {
            shiftId_nozzleId: { shiftId: id, nozzleId: collection.nozzleId },
          },
          data: { collectionAmount: new Prisma.Decimal(collection.amount) },
        }),
      ),
    );
    return tx.shift.update({
      where: { id },
      data: {
        status: "RECONCILIATION_REQUIRED",
        closingCash: new Prisma.Decimal(input.closingCash),
        closedAt,
        closingTimeAudit: { recordedAt: recordedAt.toISOString(), enteredById, method: input.closedAt ? "SELECTED" : "NOW", closedAt: closedAt.toISOString() },
        notes: input.notes || shift.notes,
      },
      include,
    });
  })();
  await enqueueReview(tx, { type: 'SHIFT_CLOSED', organizationId, stationId: closed.stationId, resourceId: closed.id, occurredAt: closed.closedAt! });
  return summary(closed);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
function summary(shift: any) {
  const volume = shift.nozzleReadings.reduce(
    (sum: number, reading: any) =>
      sum +
      (reading.closingMeter === null
        ? 0
        : Number(reading.closingMeter) -
          Number(reading.openingMeter) -
          Number(reading.testingQuantity ?? 0)),
    0,
  );
  return {
    ...shift,
    summary: {
      fuelVolume: volume,
      closingCollections: closingCollectionFacts(shift),
      tanksCaptured: shift.tankReadings.filter(
        (reading: any) => reading.closingDip !== null,
      ).length,
      nozzlesCaptured: shift.nozzleReadings.filter(
        (reading: any) => reading.closingMeter !== null,
      ).length,
    },
  };
}
export async function updateNozzleCustody(
  organizationId: string,
  id: string,
  input: NozzleCustodyInput,
) {
  const shift = await prisma.shift.findFirst({
    where: { id, station: { organizationId } },
    include: { users: true, nozzleReadings: true },
  });
  if (!shift)
    throw new AppError(404, "SHIFT_NOT_FOUND", "This shift was not found.");
  void input;
  throw new AppError(
    409,
    "NOZZLE_ASSIGNMENTS_LOCKED",
    shift.status === "OPEN"
      ? "Nozzle assignments were confirmed when this shift opened and are locked until it closes."
      : "Closed shift assignments are permanent custody records and cannot be changed.",
  );
}


export async function cancelShift(organizationId: string, userId: string, id: string, reason: string) {
  if (reason.trim().length < 5 || reason.trim().length > 500)
    throw new AppError(400, 'CANCELLATION_REASON_REQUIRED', 'Explain why this shift was opened by mistake (5–500 characters).');
  return safeTransaction(prisma, async tx => {
    const owner = await tx.user.findFirst({ where: { id: userId, organizationId, role: 'OWNER', active: true }, select: { id: true, name: true } });
    if (!owner) throw new AppError(403, 'SHIFT_CANCEL_OWNER_ONLY', 'Only the account owner can cancel a mistaken shift.');
    const shift = await tx.shift.findFirst({ where: { id, station: { organizationId } }, include: { ...include, _count: { select: { sales: true } }, reconciliation: { select: { id: true } } } });
    if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'This shift is unavailable.');
    if (shift.status !== 'OPEN') throw new AppError(409, 'SHIFT_NOT_OPEN', 'Only an open shift can be cancelled. Refresh to see its current status.');
    if (shift._count.sales || shift.reconciliation || shift.closedAt || shift.closingCash !== null ||
        shift.tankReadings.some(row => row.closingDip !== null) ||
        shift.nozzleReadings.some(row => row.closingMeter !== null || Number(row.testingQuantity) !== 0) ||
        shift.nozzleAssignments.some(row => row.collectionAmount !== null))
      throw new AppError(409, 'SHIFT_HAS_ACTIVITY', 'This shift has saved activity and cannot be cancelled. Review its sales and reconciliation instead.');
    const claimed = await tx.shift.updateMany({ where: { id, status: 'OPEN' }, data: {
      status: 'CANCELLED', cancellation: { reason: reason.trim(), cancelledAt: new Date().toISOString(), cancelledById: owner.id, cancelledByName: owner.name },
    } });
    if (claimed.count !== 1) throw new AppError(409, 'SHIFT_NOT_OPEN', 'The shift changed while cancelling. Refresh and review it.');
    return { id: shift.id, shiftNumber: shift.shiftNumber, status: 'CANCELLED' as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


export async function shiftClosingPreview(organizationId: string, id: string, selected?: string) {
  return prisma.$transaction(async tx => {
    const shift = await tx.shift.findFirst({ where: { id, station: { organizationId } }, include });
    if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'This shift is unavailable.');
    if (shift.status !== 'OPEN') throw new AppError(409, 'SHIFT_NOT_OPEN', 'Only an open shift can be previewed for closing.');
    const at = resolveClosingTime(shift.openedAt, selected);
    if (selected) await validateClosingCutoff(tx, organizationId, shift, at);
    const bridge = await stockBridge(tx, organizationId, shift, at, true, Boolean(selected));
    return { shift: summary({ ...shift, tankReadings: shift.tankReadings.map(reading => ({ ...reading, receivedDuringShift: bridge.get(reading.tankId)?.received ?? new Prisma.Decimal(0), stockBridge: bridge.get(reading.tankId) })) }), closingAt: at };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
