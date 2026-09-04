import type {
  CloseShiftInput,
  NozzleCustodyInput,
  OpenShiftInput,
} from "@fuelledger/shared";
import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

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
  ids.length === values.length &&
  ids.every((id) => values.some((value) => value.id === id));
export async function bootstrap(organizationId: string, stationIds?: string[]) {
  const [stations, users, shifts, tankInventory] = await Promise.all([
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
      select: { id: true, name: true, role: true },
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
    prisma.inventoryLedger.groupBy({
      by: ["tankId"],
      where: {
        organizationId,
        tankId: { not: null },
        ...(stationIds ? { stationId: { in: stationIds } } : {}),
      },
      _sum: { quantityDelta: true },
    }),
  ]);
  const inventoryByTank = new Map(
    tankInventory.map((row) => [row.tankId!, Number(row._sum.quantityDelta ?? 0)]),
  );
  const shapedStations = stations.map(({ shifts: previous, ...station }) => ({
    ...station,
    availableTankStock:
      station.configurations[0]?.tanks.map((tank) => ({
        id: tank.id,
        value: new Prisma.Decimal(
          Number(tank.openingStock) + (inventoryByTank.get(tank.id) ?? 0),
        ),
      })) ?? [],
    lastClosing: previous[0]
      ? {
          shiftId: previous[0].id,
          shiftNumber: previous[0].shiftNumber,
          closedAt: previous[0].closedAt!,
          tankReadings: previous[0].tankReadings
            .filter((row) => row.closingDip !== null)
            .map((row) => ({ id: row.tankId, value: row.closingDip! })),
          nozzleReadings: previous[0].nozzleReadings
            .filter((row) => row.closingMeter !== null)
            .map((row) => ({ id: row.nozzleId, value: row.closingMeter! })),
        }
      : null,
  }));
  return { stations: shapedStations, users, shifts: shifts.map(summary) };
}
export async function openShift(organizationId: string, input: OpenShiftInput) {
  const station = await prisma.station.findFirst({
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
    throw new AppError(404, "STATION_NOT_FOUND", "Choose an active station.");
  const config = station.configurations[0];
  if (!config)
    throw new AppError(
      400,
      "STATION_NOT_CONFIGURED",
      "This station needs an active configuration first.",
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
  const previous = await prisma.shift.findFirst({
    where: { stationId: station.id, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: {
      shiftNumber: true,
      tankReadings: { select: { tankId: true, closingDip: true } },
      nozzleReadings: { select: { nozzleId: true, closingMeter: true } },
    },
  });
  const tankInventory = await prisma.inventoryLedger.groupBy({
    by: ["tankId"],
    where: {
      organizationId,
      stationId: station.id,
      tankId: { in: tanks.map((tank) => tank.id) },
    },
    _sum: { quantityDelta: true },
  });
  const inventoryByTank = new Map(
    tankInventory.map((row) => [
      row.tankId!,
      Number(row._sum.quantityDelta ?? 0),
    ]),
  );
  for (const reading of input.tankReadings) {
    const tank = tanks.find((item) => item.id === reading.id)!;
    const prior = previous?.tankReadings.find(
      (row) => row.tankId === reading.id,
    )?.closingDip;
    const expected =
      prior !== null && prior !== undefined
        ? Number(prior)
        : Number(tank.openingStock) + (inventoryByTank.get(tank.id) ?? 0);
    if (Math.abs(reading.value - expected) > 0.001)
      throw new AppError(
        409,
        "OPENING_READING_MISMATCH",
        `Tank ${tank.code} must open at ${expected.toLocaleString()} L, matching ${prior !== null && prior !== undefined ? `shift #${previous!.shiftNumber}'s closing reading` : "its available inventory"}. Refresh and try again.`,
      );
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
  const users = await prisma.user.findMany({
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
    await prisma.shift.findFirst({
      where: { stationId: station.id, status: "OPEN" },
    })
  )
    throw new AppError(
      409,
      "SHIFT_ALREADY_OPEN",
      "Close the current open shift before opening another one.",
    );
  const latest = await prisma.shift.aggregate({
    where: { stationId: station.id },
    _max: { shiftNumber: true },
  });
  const shift = await prisma.shift.create({
    data: {
      stationId: station.id,
      configurationId: config.id,
      shiftNumber: (latest._max.shiftNumber ?? 0) + 1,
      managerId: input.managerId,
      status: "OPEN",
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
}
export async function closeShift(
  organizationId: string,
  id: string,
  input: CloseShiftInput,
) {
  const shift = await prisma.shift.findFirst({
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
  }
  const meteredSales = await prisma.sale.groupBy({
    by: ["nozzleId"],
    where: { shiftId: id, kind: "METERED" },
    _sum: { quantity: true },
  });
  for (const reading of input.nozzleReadings) {
    const opening = shift.nozzleReadings.find(
      (value) => value.nozzleId === reading.id,
    )!;
    const meterMovement = reading.value - Number(opening.openingMeter);
    const recorded = Number(
      meteredSales.find((sale) => sale.nozzleId === reading.id)?._sum
        .quantity ?? 0,
    );
    if (Math.abs(meterMovement - recorded) > 0.001)
      {
      const assignment = shift.nozzleAssignments.find(
        (row) => row.nozzleId === reading.id,
      );
      throw new AppError(
        409,
        "METER_SALES_MISMATCH",
        `${opening.nozzle.dispenser.code} / ${opening.nozzle.code}${assignment ? ` (${assignment.user.name})` : ""} moved ${meterMovement.toLocaleString()} L, but ${recorded.toLocaleString()} L of sales were recorded. Add the missing nozzle sales, then close the shift again.`,
      );
      }
  }
  const closed = await prisma.$transaction(async (tx) => {
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
          data: { closingMeter: new Prisma.Decimal(reading.value) },
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
        closedAt: new Date(),
        notes: input.notes || shift.notes,
      },
      include,
    });
  });
  return summary(closed);
}
function summary(shift: any) {
  const volume = shift.nozzleReadings.reduce(
    (sum: number, reading: any) =>
      sum +
      (reading.closingMeter === null
        ? 0
        : Number(reading.closingMeter) - Number(reading.openingMeter)),
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
  await prisma.$transaction(async (tx) => {
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
