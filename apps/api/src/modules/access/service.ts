import type {
  ManagerInput,
  NozzleCustodyInput,
  StaffInput,
  StationAccessInput,
  User,
} from "@fuelledger/shared";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

export async function context(user: User) {
  const stations = await prisma.station.findMany({
    where: {
      organizationId: user.organization.id,
      active: true,
      ...(!user.allStations
        ? { id: { in: user.stations.map((station) => station.id) } }
        : {}),
    },
    select: { id: true, name: true, code: true, city: true, state: true },
    orderBy: { name: "asc" },
  });
  return { allStations: user.allStations, stations };
}
export async function management(organizationId: string) {
  const [stations, users] = await Promise.all([
    prisma.station.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        state: true,
        active: true,
        configurations: {
          where: { active: true },
          take: 1,
          select: {
            dispensers: {
              where: { status: "ACTIVE" },
              select: {
                id: true,
                code: true,
                location: true,
                nozzles: {
                  where: { status: "ACTIVE" },
                  select: {
                    id: true,
                    code: true,
                    product: { select: { code: true, name: true } },
                    attendantAssignment: { select: { userId: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId, active: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        loginEnabled: true,
        lastLoginAt: true,
        mustChangePassword: true,
        stationAccess: { select: { stationId: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
  ]);
  return {
    stations,
    users: users.map((user) => ({
      ...user,
      allStations: user.role === "OWNER" || user.role === "ACCOUNTANT",
      stationIds: user.stationAccess.map((item) => item.stationId),
    })),
  };
}
export async function saveNozzleAssignments(
  organizationId: string,
  stationId: string,
  input: NozzleCustodyInput,
) {
  const station = await prisma.station.findFirst({
    where: { id: stationId, organizationId, active: true },
    select: {
      configurations: {
        where: { active: true },
        take: 1,
        select: {
          dispensers: {
            where: { status: "ACTIVE" },
            select: {
              nozzles: { where: { status: "ACTIVE" }, select: { id: true } },
            },
          },
        },
      },
      shifts: {
        where: { status: "OPEN" },
        take: 1,
        select: {
          id: true,
          managerId: true,
          users: { select: { userId: true } },
        },
      },
    },
  });
  if (!station)
    throw new AppError(
      404,
      "STATION_NOT_FOUND",
      "This petrol pump was not found.",
    );
  const nozzles =
    station.configurations[0]?.dispensers.flatMap(
      (dispenser) => dispenser.nozzles,
    ) ?? [];
  const nozzleIds = input.assignments.map((row) => row.nozzleId);
  if (
    nozzleIds.length !== nozzles.length ||
    new Set(nozzleIds).size !== nozzles.length ||
    nozzleIds.some((id) => !nozzles.some((nozzle) => nozzle.id === id))
  )
    throw new AppError(
      400,
      "NOZZLE_ASSIGNMENTS_INCOMPLETE",
      "Assign every active nozzle exactly once.",
    );
  const attendantIds = [...new Set(input.assignments.map((row) => row.userId))];
  const attendants = await prisma.user.count({
    where: {
      id: { in: attendantIds },
      organizationId,
      active: true,
      role: "STAFF",
      stationAccess: { some: { stationId } },
    },
  });
  if (attendants !== attendantIds.length)
    throw new AppError(
      400,
      "ATTENDANT_INVALID",
      "Choose active attendants assigned to this petrol pump.",
    );
  const openShift = station.shifts[0];
  await prisma.$transaction(async (tx) => {
    await tx.nozzleAttendantAssignment.deleteMany({
      where: { nozzleId: { in: nozzles.map((nozzle) => nozzle.id) } },
    });
    await tx.nozzleAttendantAssignment.createMany({
      data: input.assignments.map((row) => ({
        nozzleId: row.nozzleId,
        userId: row.userId,
      })),
    });
    if (openShift) {
      const existingTeam = new Set([
        openShift.managerId,
        ...openShift.users.map((row) => row.userId),
      ]);
      const missing = attendantIds.filter((id) => !existingTeam.has(id));
      if (missing.length)
        await tx.shiftUser.createMany({
          data: missing.map((userId) => ({ shiftId: openShift.id, userId })),
          skipDuplicates: true,
        });
      await tx.shiftNozzleAssignment.deleteMany({
        where: { shiftId: openShift.id },
      });
      await tx.shiftNozzleAssignment.createMany({
        data: input.assignments.map((row) => ({
          shiftId: openShift.id,
          nozzleId: row.nozzleId,
          userId: row.userId,
        })),
      });
    }
  });
  return {
    stationId,
    assignments: input.assignments,
    openShiftUpdated: Boolean(openShift),
  };
}
export async function assign(
  organizationId: string,
  userId: string,
  input: StationAccessInput,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId, active: true },
  });
  if (!user)
    throw new AppError(
      404,
      "USER_NOT_FOUND",
      "This team member was not found.",
    );
  if (user.role === "OWNER" || user.role === "ACCOUNTANT")
    throw new AppError(
      400,
      "ACCESS_IMPLICIT",
      "Owners and accountants have organization-wide access.",
    );
  if (user.role === "MANAGER" && input.stationIds.length !== 1)
    throw new AppError(
      400,
      "MANAGER_PUMP_REQUIRED",
      "A manager must be assigned to exactly one petrol pump.",
    );
  const count = await prisma.station.count({
    where: { organizationId, id: { in: input.stationIds }, active: true },
  });
  if (count !== new Set(input.stationIds).size)
    throw new AppError(400, "STATION_INVALID", "Choose active petrol pumps.");
  await prisma.$transaction(async (tx) => {
    await tx.userStationAccess.deleteMany({ where: { userId } });
    if (input.stationIds.length)
      await tx.userStationAccess.createMany({
        data: input.stationIds.map((stationId) => ({ userId, stationId })),
      });
  });
  return { userId, stationIds: input.stationIds };
}
export async function createStaff(organizationId: string, input: StaffInput) {
  const count = await prisma.station.count({
    where: { organizationId, id: { in: input.stationIds }, active: true },
  });
  if (count !== new Set(input.stationIds).size)
    throw new AppError(
      400,
      "PUMP_INVALID",
      "Choose active petrol pumps in this organization.",
    );
  const token = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      organizationId,
      email: `staff-${token}@internal.fuelledger`,
      name: input.name,
      passwordHash: await bcrypt.hash(crypto.randomUUID(), 12),
      loginEnabled: false,
      role: "STAFF",
      stationAccess: {
        create: input.stationIds.map((stationId) => ({ stationId })),
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      stationAccess: { select: { stationId: true } },
    },
  });
  return { ...user, stationIds: user.stationAccess.map((x) => x.stationId) };
}
export async function createManager(
  organizationId: string,
  input: ManagerInput,
) {
  const station = await prisma.station.findFirst({
    where: { id: input.stationId, organizationId, active: true },
  });
  if (!station)
    throw new AppError(
      400,
      "PUMP_INVALID",
      "Choose an active petrol pump in this organization.",
    );
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } }))
    throw new AppError(
      409,
      "EMAIL_EXISTS",
      "That email address already has a FuelLedger account.",
    );
  const user = await prisma.user.create({
    data: {
      organizationId,
      email,
      name: input.name,
      passwordHash: await bcrypt.hash(input.temporaryPassword, 12),
      loginEnabled: true,
      mustChangePassword: true,
      role: "MANAGER",
      stationAccess: { create: { stationId: station.id } },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      loginEnabled: true,
      lastLoginAt: true,
      mustChangePassword: true,
      stationAccess: { select: { stationId: true } },
    },
  });
  return {
    ...user,
    allStations: false,
    stationIds: user.stationAccess.map((x) => x.stationId),
  };
}
export async function deactivateStaff(organizationId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId, active: true },
  });
  if (!user)
    throw new AppError(
      404,
      "USER_NOT_FOUND",
      "This staff member was not found.",
    );
  if (user.role === "OWNER")
    throw new AppError(
      400,
      "OWNER_REQUIRED",
      "The petrol pump owner cannot be removed.",
    );
  const [active, defaults] = await Promise.all([
    prisma.shiftNozzleAssignment.count({
      where: { userId, shift: { status: "OPEN" } },
    }),
    prisma.nozzleAttendantAssignment.count({ where: { userId } }),
  ]);
  if (active || defaults)
    throw new AppError(
      409,
      "STAFF_ASSIGNED_TO_NOZZLE",
      "Reassign this attendant’s nozzles before removing them.",
    );
  await prisma.user.update({ where: { id: userId }, data: { active: false } });
  return { id: userId, active: false };
}
