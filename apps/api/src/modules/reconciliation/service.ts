import type { ReconciliationInput } from "@fuelledger/shared";
import { paymentMethods } from "@fuelledger/shared";
import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { notifyShiftVariance } from "../notifications/service.js";
import { collectionAccount, postJournal } from "../accounting/service.js";

const automaticSaleNote =
  "Automatically calculated from shift closing meter; payment method pending reconciliation.";

const reconciliationInclude = {
  collections: { orderBy: { paymentMethod: "asc" as const } },
  creditAllocations: {
    orderBy: { createdAt: "asc" as const },
    include: {
      customer: { select: { id: true, name: true, code: true, type: true } },
      vehicle: { select: { id: true, number: true, label: true } },
    },
  },
  reconciledBy: { select: { id: true, name: true, role: true } },
} as const;
const shiftInclude = {
  station: { select: { id: true, name: true, code: true } },
  manager: { select: { id: true, name: true, role: true } },
  reconciliation: { include: reconciliationInclude },
} as const;
export async function bootstrap(organizationId: string, stationIds?: string[]) {
  const shifts = await prisma.shift.findMany({
    where: {
      station: {
        organizationId,
        ...(stationIds ? { id: { in: stationIds } } : {}),
      },
      status: { in: ["RECONCILIATION_REQUIRED", "LOCKED"] },
    },
    orderBy: { closedAt: "desc" },
    take: 30,
    include: shiftInclude,
  });
  const expectedRows = shifts.length
    ? await prisma.sale.groupBy({
        by: ["shiftId", "paymentMethod"],
        where: { shiftId: { in: shifts.map((shift) => shift.id) } },
        _sum: { totalAmount: true },
      })
    : [];
  const automaticRows = shifts.length
    ? await prisma.sale.groupBy({
        by: ["shiftId"],
        where: {
          shiftId: { in: shifts.map((shift) => shift.id) },
          paymentMethod: "OTHER",
          notes: automaticSaleNote,
        },
        _sum: { totalAmount: true },
      })
    : [];
  const customers = await prisma.customer.findMany({
    where: { organizationId, active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      creditLimit: true,
      creditDays: true,
      vehicles: {
        where: { active: true },
        orderBy: { number: "asc" },
        select: { id: true, number: true, label: true },
      },
      ledger: { select: { amount: true } },
    },
  });
  return {
    shifts: shifts.map((shift) =>
      presentShift(
        shift,
        expectedRows,
        Number(
          automaticRows.find((row) => row.shiftId === shift.id)?._sum
            .totalAmount ?? 0,
        ),
      ),
    ),
    customers: customers.map((customer) => ({
      ...customer,
      outstanding: customer.ledger.reduce(
        (sum, row) => sum + Number(row.amount),
        0,
      ),
      ledger: undefined,
    })),
  };
}
export async function reconcile(
  organizationId: string,
  userId: string,
  shiftId: string,
  input: ReconciliationInput,
) {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, station: { organizationId } },
    include: shiftInclude,
  });
  if (!shift)
    throw new AppError(404, "SHIFT_NOT_FOUND", "This shift was not found.");
  if (shift.status === "LOCKED" || shift.reconciliation)
    throw new AppError(
      409,
      "SHIFT_LOCKED",
      "This shift is already reconciled and locked.",
    );
  if (shift.status !== "RECONCILIATION_REQUIRED")
    throw new AppError(
      409,
      "SHIFT_NOT_READY",
      "Close the shift before reconciling collections.",
    );
  const sales = await prisma.sale.groupBy({
    by: ["paymentMethod"],
    where: { shiftId },
    _sum: { totalAmount: true },
  });
  const expected = new Map(
    sales.map((row) => [row.paymentMethod, Number(row._sum.totalAmount ?? 0)]),
  );
  const allocationDelta = input.collections.reduce(
    (sum, collection) => sum + collection.adjustmentAmount,
    0,
  );
  if (Math.abs(allocationDelta) > 0.01)
    throw new AppError(
      400,
      "ALLOCATION_INCOMPLETE",
      "Allocate the complete shift sales total before locking.",
    );
  for (const collection of input.collections)
    if (
      (expected.get(collection.paymentMethod) ?? 0) +
        collection.adjustmentAmount <
      0
    )
      throw new AppError(
        400,
        "ALLOCATION_INVALID",
        "A payment-method allocation cannot be negative.",
      );
  for (const method of ["CREDIT", "FLEET"] as const) {
    const collection = input.collections.find(
      (row) => row.paymentMethod === method,
    )!;
    const allocated = (expected.get(method) ?? 0) + collection.adjustmentAmount;
    const assigned = input.creditAllocations
      .filter((row) => row.paymentMethod === method)
      .reduce((sum, row) => sum + row.amount, 0);
    if (Math.abs(allocated - assigned) > 0.01)
      throw new AppError(
        400,
        "CUSTOMER_ALLOCATION_INCOMPLETE",
        `Assign the complete ${method.toLowerCase()} amount to customer accounts.`,
      );
  }
  const customerIds = [
    ...new Set(input.creditAllocations.map((row) => row.customerId)),
  ];
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: customerIds }, organizationId, active: true },
        include: {
          vehicles: { where: { active: true } },
          ledger: { select: { amount: true } },
        },
      })
    : [];
  if (customers.length !== customerIds.length)
    throw new AppError(
      400,
      "CUSTOMER_INVALID",
      "Choose an active customer account for every credit allocation.",
    );
  for (const allocation of input.creditAllocations) {
    const customer = customers.find((row) => row.id === allocation.customerId)!;
    if (allocation.paymentMethod === "FLEET" && customer.type !== "FLEET")
      throw new AppError(
        400,
        "FLEET_CUSTOMER_REQUIRED",
        "Choose a fleet account for fleet sales.",
      );
    if (allocation.paymentMethod === "CREDIT" && customer.type !== "CREDIT")
      throw new AppError(
        400,
        "CREDIT_CUSTOMER_REQUIRED",
        "Choose a credit customer for credit sales.",
      );
    if (
      allocation.vehicleId &&
      !customer.vehicles.some((vehicle) => vehicle.id === allocation.vehicleId)
    )
      throw new AppError(
        400,
        "VEHICLE_INVALID",
        "Choose a vehicle belonging to the selected customer.",
      );
  }
  for (const customer of customers) {
    const current = customer.ledger.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );
    const added = input.creditAllocations
      .filter((row) => row.customerId === customer.id)
      .reduce((sum, row) => sum + row.amount, 0);
    if (current + added > Number(customer.creditLimit) + 0.01)
      throw new AppError(
        409,
        "CREDIT_LIMIT_EXCEEDED",
        `These allocations would exceed ${customer.name}'s credit limit.`,
      );
  }
  const automatic = await prisma.sale.aggregate({
    where: { shiftId, paymentMethod: "OTHER", notes: automaticSaleNote },
    _sum: { totalAmount: true },
  });
  const autoUnallocated = Number(automatic._sum.totalAmount ?? 0);
  const result = await prisma.$transaction(async (tx) => {
    const reconciliation = await tx.shiftReconciliation.create({
      data: {
        shiftId,
        reconciledById: userId,
        notes: input.notes || null,
        collections: {
          create: input.collections.map((collection) => {
            const expectedAmount = expected.get(collection.paymentMethod) ?? 0;
            const adjustedExpected =
              expectedAmount + collection.adjustmentAmount;
            return {
              paymentMethod: collection.paymentMethod,
              expectedAmount: new Prisma.Decimal(expectedAmount),
              actualAmount: new Prisma.Decimal(collection.actualAmount),
              adjustmentAmount: new Prisma.Decimal(collection.adjustmentAmount),
              adjustmentReason:
                collection.adjustmentAmount === 0
                  ? null
                  : collection.adjustmentReason!,
              varianceAmount: new Prisma.Decimal(
                collection.actualAmount - adjustedExpected,
              ),
            };
          }),
        },
      },
      include: reconciliationInclude,
    });
    for (const allocation of input.creditAllocations) {
      const customer = customers.find(
        (row) => row.id === allocation.customerId,
      )!;
      const occurredAt = shift.closedAt ?? new Date();
      const dueDate = new Date(occurredAt);
      dueDate.setDate(dueDate.getDate() + customer.creditDays);
      const record = await tx.shiftCreditAllocation.create({
        data: {
          reconciliationId: reconciliation.id,
          customerId: customer.id,
          vehicleId: allocation.vehicleId ?? null,
          paymentMethod: allocation.paymentMethod,
          amount: new Prisma.Decimal(allocation.amount),
          dueDate,
        },
      });
      const vehicle = allocation.vehicleId
        ? customer.vehicles.find((row) => row.id === allocation.vehicleId)
        : null;
      await tx.customerLedgerEntry.create({
        data: {
          organizationId,
          stationId: shift.station.id,
          customerId: customer.id,
          type: "SALE",
          amount: new Prisma.Decimal(allocation.amount),
          shiftCreditAllocationId: record.id,
          description: `Shift #${shift.shiftNumber} ${allocation.paymentMethod.toLowerCase()} sale${vehicle ? ` · ${vehicle.number}` : ""}`,
          dueDate,
          occurredAt,
          createdById: userId,
        },
      });
    }
    const reclassification = input.collections.filter(
      (collection) => Math.abs(collection.adjustmentAmount) > 0.005,
    );
    if (reclassification.length)
      await postJournal(tx, {
        organizationId,
        stationId: shift.station.id,
        createdById: userId,
        journalDate: new Date(),
        reference: `RECON-${shift.id.slice(-8)}`,
        description: `Shift #${shift.shiftNumber} payment allocation`,
        sourceType: "SHIFT_RECONCILIATION",
        sourceId: reconciliation.id,
        lines: reclassification.map((collection) =>
          collection.adjustmentAmount > 0
            ? {
                account: collectionAccount(collection.paymentMethod),
                debit: new Prisma.Decimal(collection.adjustmentAmount),
              }
            : {
                account: collectionAccount(collection.paymentMethod),
                credit: new Prisma.Decimal(-collection.adjustmentAmount),
              },
        ),
      });
    const locked = await tx.shift.update({
      where: { id: shiftId },
      data: { status: "LOCKED" },
      include: shiftInclude,
    });
    return presentShift(
      locked,
      input.collections.map((collection) => ({
        shiftId,
        paymentMethod: collection.paymentMethod,
        _sum: {
          totalAmount: new Prisma.Decimal(
            expected.get(collection.paymentMethod) ?? 0,
          ),
        },
      })),
      autoUnallocated,
    );
  });
  await notifyShiftVariance(organizationId, result).catch(() => undefined);
  return result;
}
function presentShift(
  shift: any,
  expectedRows: Array<{
    shiftId: string;
    paymentMethod: string;
    _sum: { totalAmount: Prisma.Decimal | null };
  }>,
  autoUnallocated = 0,
) {
  const expected = Object.fromEntries(
    paymentMethods.map((method) => [
      method,
      Number(
        expectedRows.find(
          (row) => row.shiftId === shift.id && row.paymentMethod === method,
        )?._sum.totalAmount ?? 0,
      ),
    ]),
  );
  const allocatedExpected = {
    ...expected,
    OTHER: Math.max(0, (expected.OTHER ?? 0) - autoUnallocated),
  };
  const suggestedActual = {
    ...allocatedExpected,
    CASH: Math.max(
      0,
      Number(shift.closingCash ?? 0) - Number(shift.openingCash),
    ),
  };
  const collections = shift.reconciliation?.collections ?? [];
  const totals = collections.length
    ? collections.reduce(
        (
          result: {
            expected: number;
            adjustedExpected: number;
            actual: number;
            variance: number;
          },
          row: any,
        ) => ({
          expected: result.expected + Number(row.expectedAmount),
          adjustedExpected:
            result.adjustedExpected +
            Number(row.expectedAmount) +
            Number(row.adjustmentAmount),
          actual: result.actual + Number(row.actualAmount),
          variance: result.variance + Number(row.varianceAmount),
        }),
        { expected: 0, adjustedExpected: 0, actual: 0, variance: 0 },
      )
    : null;
  return {
    ...shift,
    expected,
    allocatedExpected,
    autoUnallocated,
    salesTotal: Object.values(expected).reduce((sum, value) => sum + value, 0),
    suggestedActual,
    totals,
  };
}
