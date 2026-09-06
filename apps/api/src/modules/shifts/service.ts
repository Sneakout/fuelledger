import { safeTransaction } from '../../lib/safe-save.js';
import { assertStockAvailable, tankBookStocksAt, tankMovementDeltasBetween } from '../../lib/stock.js';
import type {
  CloseShiftInput,
  NozzleCustodyInput,
  OpenShiftInput,
} from "@fuelledger/shared";
import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { effectivePriceAt } from "../../lib/effective-price.js";
import { prisma } from "../../lib/prisma.js";
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
type BridgeDb = Pick<Prisma.TransactionClient, 'inventoryLedger' | 'nozzle'>;
async function stockBridge(db: BridgeDb, organizationId: string, shift: { stationId: string; configurationId: string; openedAt: Date; closedAt: Date | null; tankReadings: Array<{ tankId: string; tank?: { productId: string } }>; nozzleReadings: Array<{ nozzleId: string }> }, asOf = new Date()) {
  const until = shift.closedAt ?? asOf;
  const [movements, nozzles] = await Promise.all([
    db.inventoryLedger.findMany({
      where: {
        organizationId,
        stationId: shift.stationId,
        tankId: { in: shift.tankReadings.map((reading) => reading.tankId) },
        type: { in: ['RECEIPT', 'ADJUSTMENT'] },
        occurredAt: { gte: shift.openedAt, lt: until },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tankId: true,
        type: true,
        quantityDelta: true,
        note: true,
        occurredAt: true,
        receiptLine: { select: { receipt: { select: { referenceNo: true, supplierName: true, invoice: { select: { invoiceNumber: true } } } } } },
      },
    }),
    db.nozzle.findMany({
      where: { id: { in: shift.nozzleReadings.map((reading) => reading.nozzleId) } },
      select: {
        id: true,
        code: true,
        productId: true,
        dispenser: { select: { code: true } },
        tankMappings: { where: { tank: { configurationId: shift.configurationId, status: 'ACTIVE' } }, select: { tankId: true } },
      },
    }),
  ]);
  return new Map(shift.tankReadings.map((reading) => {
    const rows = movements.filter((movement) => movement.tankId === reading.tankId);
    const receipts = rows.filter((movement) => movement.type === 'RECEIPT');
    const adjustments = rows.filter((movement) => movement.type === 'ADJUSTMENT');
    return [reading.tankId, {
      received: receipts.reduce((sum, movement) => sum.add(movement.quantityDelta), new Prisma.Decimal(0)),
      adjustments: adjustments.reduce((sum, movement) => sum.add(movement.quantityDelta), new Prisma.Decimal(0)),
      deliveries: receipts.map((movement) => ({
        id: movement.id,
        quantity: movement.quantityDelta,
        occurredAt: movement.occurredAt,
        reference: movement.receiptLine?.receipt.invoice?.invoiceNumber ?? movement.receiptLine?.receipt.referenceNo ?? 'Receipt',
        supplier: movement.receiptLine?.receipt.supplierName ?? 'Supplier',
      })),
      adjustmentDetails: adjustments.map((movement) => ({ id: movement.id, quantity: movement.quantityDelta, note: movement.note, occurredAt: movement.occurredAt })),
      nozzles: nozzles.filter((nozzle) => {
        const productTanks = shift.tankReadings.filter((tankReading) => tankReading.tank?.productId === nozzle.productId);
        const resolvedTankId = nozzle.tankMappings.length === 1
          ? nozzle.tankMappings[0]!.tankId
          : nozzle.tankMappings.length === 0 && productTanks.length === 1
            ? productTanks[0]!.tankId
            : undefined;
        return resolvedTankId === reading.tankId;
      }).map((nozzle) => ({ id: nozzle.id, code: `${nozzle.dispenser.code} / ${nozzle.code}` })),
    }] as const;
  }));
}
async function withStockBridge<T extends { stationId: string; configurationId: string; openedAt: Date; closedAt: Date | null; tankReadings: Array<{ tankId: string; tank?: { productId: string } }>; nozzleReadings: Array<{ nozzleId: string }> }>(organizationId: string, shift: T) {
  const bridge = await stockBridge(prisma, organizationId, shift);
  return { ...shift, tankReadings: shift.tankReadings.map((reading) => ({ ...reading, receivedDuringShift: bridge.get(reading.tankId)?.received ?? new Prisma.Decimal(0), stockBridge: bridge.get(reading.tankId) })) };
}
export async function bootstrap(organizationId: string, stationIds?: string[]) {
  const asOf = new Date();
  const [stations, users, shifts] = await Promise.all([
    prisma.station.findMany({
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
                  where: { status: "ACTIVE" },
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
            nozzleAssignments: { select: { nozzleId: true, userId: true } },
            tankReadings: { select: { tankId: true, closingDip: true } },
            nozzleReadings: { select: { nozzleId: true, closingMeter: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
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
    prisma.shift.findMany({
      where: {
        station: {
          organizationId,
          ...(stationIds ? { id: { in: stationIds } } : {}),
        },
      },
      orderBy: { openedAt: "desc" },
      take: 8,
      include,
    }),
  ]);
  const stockSources = stations.flatMap((station) =>
    (station.configurations[0]?.tanks ?? []).map((tank) => ({
      id: tank.id,
      stationId: station.id,
      productId: tank.productId,
      openingStock: tank.openingStock,
    })),
  );
  const inventoryByTank = await tankBookStocksAt(
    prisma,
    organizationId,
    stockSources,
    asOf,
  );
  const shapedStations = await Promise.all(stations.map(async ({ shifts: previous, ...station }) => {
    const stationTanks = stockSources.filter((tank) => tank.stationId === station.id);
    const sinceClose = previous[0]?.closedAt
      ? await tankMovementDeltasBetween(prisma, organizationId, stationTanks, previous[0].closedAt, asOf)
      : new Map<string, Prisma.Decimal>();
    const bridgeRows = previous[0]?.closedAt ? await prisma.inventoryLedger.groupBy({ by: ['tankId','type'], where: { organizationId, stationId: station.id, tankId: { in: stationTanks.map((tank) => tank.id) }, occurredAt: { gt: previous[0].closedAt, lte: asOf }, type: { in: ['RECEIPT','ADJUSTMENT'] } }, _sum: { quantityDelta: true } }) : [];
    return ({
    ...station,
    availableTankStock:
      station.configurations[0]?.tanks.map((tank) => ({
        id: tank.id,
        value: inventoryByTank.get(tank.id) ?? new Prisma.Decimal(tank.openingStock),
      })) ?? [],
    lastClosing: previous[0]
      ? {
          shiftId: previous[0].id,
          shiftNumber: previous[0].shiftNumber,
          closedAt: previous[0].closedAt!,
          nozzleAssignments: previous[0].nozzleAssignments,
          tankReadings: previous[0].tankReadings
            .filter((row) => row.closingDip !== null)
            .map((row) => { const received = bridgeRows.find((item) => item.tankId === row.tankId && item.type === 'RECEIPT')?._sum.quantityDelta ?? new Prisma.Decimal(0); const adjustments = bridgeRows.find((item) => item.tankId === row.tankId && item.type === 'ADJUSTMENT')?._sum.quantityDelta ?? new Prisma.Decimal(0); return { id: row.tankId, value: row.closingDip!, lastActual: row.closingDip!, receivedBetween: received, adjustmentsBetween: adjustments, expectedOpening: row.closingDip!.add(sinceClose.get(row.tankId) ?? 0) }; }),
          nozzleReadings: previous[0].nozzleReadings
            .filter((row) => row.closingMeter !== null)
            .map((row) => ({ id: row.nozzleId, value: row.closingMeter! })),
        }
      : null,
  }); }));
  return {
    stations: shapedStations,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      stationIds: user.stationAccess.map((access) => access.stationId),
    })),
    stockVarianceTolerance: Number((await prisma.ownerNotificationSettings.findUnique({ where: { organizationId }, select: { stockVarianceTolerance: true } }))?.stockVarianceTolerance ?? 50),
    shifts: await Promise.all(shifts.map(async (shift) => summary(await withStockBridge(organizationId, shift)))),
  };
}
export async function openShift(organizationId: string, input: OpenShiftInput) {
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
            include: { nozzles: { where: { status: "ACTIVE" } } },
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
      shiftNumber: true,
      closedAt: true,
      tankReadings: { select: { tankId: true, closingDip: true } },
      nozzleReadings: { select: { nozzleId: true, closingMeter: true } },
    },
  });
  const inventoryByTank = await tankBookStocksAt(
    tx,
    organizationId,
    tanks.map((tank) => ({
      id: tank.id,
      stationId: station.id,
      productId: tank.productId,
      openingStock: tank.openingStock,
    })),
    openedAt,
  );
  const tankSources = tanks.map((tank) => ({
    id: tank.id,
    stationId: station.id,
    productId: tank.productId,
    openingStock: tank.openingStock,
  }));
  const sinceClose = previous?.closedAt
    ? await tankMovementDeltasBetween(tx, organizationId, tankSources, previous.closedAt, openedAt)
    : new Map<string, Prisma.Decimal>();
  for (const reading of input.tankReadings) {
    const tank = tanks.find((item) => item.id === reading.id)!;
    const prior = previous?.tankReadings.find(
      (row) => row.tankId === reading.id,
    )?.closingDip;
    const expected =
      prior !== null && prior !== undefined
        ? Number(prior) + Number(sinceClose.get(tank.id) ?? 0)
        : Number(inventoryByTank.get(tank.id) ?? tank.openingStock);
    if (Math.abs(reading.value - expected) > 0.001 && !input.notes?.trim())
      throw new AppError(400, "OPENING_TANK_VARIANCE_NOTE_REQUIRED", `Add a reason for the ${tank.code} opening difference of ${Math.abs(reading.value - expected).toLocaleString()} L.`);
  }
  for (const reading of input.nozzleReadings) {
    const nozzle = nozzles.find((item) => item.id === reading.id)!;
    const prior = previous?.nozzleReadings.find(
      (row) => row.nozzleId === reading.id,
    )?.closingMeter;
    const expected = Number(prior ?? nozzle.openingMeter);
    if (Math.abs(reading.value - expected) > 0.001)
      throw new AppError(
        409,
        "OPENING_READING_MISMATCH",
        `Nozzle ${nozzle.code} must open at ${expected.toLocaleString()} L, matching ${prior !== null && prior !== undefined ? `shift #${previous!.shiftNumber}'s closing meter` : "its configured opening meter"}. Refresh and try again.`,
      );
  }
  if (
    !exact(
      input.nozzleAssignments.map((row) => row.nozzleId),
      nozzles,
    ) ||
    new Set(input.nozzleAssignments.map((row) => row.nozzleId)).size !==
      nozzles.length
  )
    throw new AppError(
      400,
      "NOZZLE_ASSIGNMENTS_INCOMPLETE",
      "Assign one attendant to every active nozzle.",
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
      openedAt,
      openingCash: new Prisma.Decimal(input.openingCash),
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
  const closingAsOf = new Date();
  const [bridgeByTank, varianceSettings] = await Promise.all([
    stockBridge(tx, organizationId, shift, closingAsOf),
    tx.ownerNotificationSettings.findUnique({ where: { organizationId }, select: { stockVarianceTolerance: true } }),
  ]);
  const tolerance = Number(varianceSettings?.stockVarianceTolerance ?? 50);
  const unexplained = input.tankReadings.flatMap((tankReading) => {
    const saved = shift.tankReadings.find((reading) => reading.tankId === tankReading.id)!;
    const bridge = bridgeByTank.get(tankReading.id);
    const nozzleIds = new Set(bridge?.nozzles.map((nozzle) => nozzle.id) ?? []);
    const related = input.nozzleReadings.filter((reading) => nozzleIds.has(reading.id));
    const sales = related.reduce((sum, reading) => {
      const opening = shift.nozzleReadings.find((value) => value.nozzleId === reading.id)!;
      return sum + reading.value - Number(opening.openingMeter) - reading.testingQuantity;
    }, 0);
    const testingLoss = related.reduce((sum, reading) => sum + (reading.testingReturned ? 0 : reading.testingQuantity), 0);
    const expected = Number(saved.openingDip) + Number(bridge?.received ?? 0) + Number(bridge?.adjustments ?? 0) - sales - testingLoss;
    const difference = tankReading.value - expected;
    return Math.abs(difference) - tolerance > 0.001
      ? [{ tank: saved.tank.code, difference }]
      : [];
  });
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
      if (missingQuantity > 0.001) {
        const quantity = new Prisma.Decimal(missingQuantity);
        const totalAmount = quantity.mul(unitPrice);
        const meterClosing = new Prisma.Decimal(reading.value).sub(
          reading.testingQuantity,
        );
        const meterOpening = meterClosing.sub(quantity);
        if (nozzle.product.inventoryTracked)
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
        if (nozzle.product.inventoryTracked)
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
        notes: input.notes || shift.notes,
      },
      include,
    });
  })();
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
  if (shift.status !== "OPEN")
    throw new AppError(
      409,
      "SHIFT_NOT_OPEN",
      "Nozzle assignments can only change during an open shift.",
    );
  if (
    !exact(
      input.assignments.map((row) => row.nozzleId),
      shift.nozzleReadings.map((row) => ({ id: row.nozzleId })),
    ) ||
    new Set(input.assignments.map((row) => row.nozzleId)).size !==
      shift.nozzleReadings.length
  )
    throw new AppError(
      400,
      "NOZZLE_ASSIGNMENTS_INCOMPLETE",
      "Assign every active nozzle exactly once.",
    );
  const team = new Set([
    shift.managerId,
    ...shift.users.map((row) => row.userId),
  ]);
  if (input.assignments.some((row) => !team.has(row.userId)))
    throw new AppError(
      400,
      "ATTENDANT_NOT_ON_SHIFT",
      "Every nozzle attendant must be on this shift.",
    );
  await safeTransaction(prisma, async (tx) => {
    await tx.shiftNozzleAssignment.deleteMany({ where: { shiftId: id } });
    await tx.shiftNozzleAssignment.createMany({
      data: input.assignments.map((row) => ({
        shiftId: id,
        nozzleId: row.nozzleId,
        userId: row.userId,
      })),
    });
  });
  const updated = await prisma.shift.findUnique({ where: { id }, include });
  return summary(updated);
}
