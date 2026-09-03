import {
  PrismaClient,
  PaymentMethod,
  SaleKind,
  ShiftStatus,
  UserRole,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  collectionAccount,
  postJournal,
} from "../apps/api/src/modules/accounting/service.js";

const prisma = new PrismaClient();
const at = (daysAgo: number, hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date;
};

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.FUELLEDGER_PROVISION_DEMO !== "CONFIRM"
  )
    throw new Error(
      "Demo seed is disabled in production. Provision demo data in an isolated environment.",
    );
  const owner = await prisma.user.findUnique({
    where: { email: "owner@fuelledger.local" },
  });
  if (!owner) throw new Error("Run the regular seed first.");
  const stationInclude = {
    configurations: {
      where: { active: true },
      take: 1,
      include: {
        tanks: { include: { product: true } },
        dispensers: {
          include: {
            nozzles: { include: { product: true, tankMappings: true } },
          },
        },
      },
    },
  };
  let station = await prisma.station.findFirst({
    where: { organizationId: owner.organizationId, active: true },
    include: stationInclude,
  });
  if (!station?.configurations[0]) {
    const products = await prisma.product.findMany({
      where: {
        organizationId: owner.organizationId,
        code: { in: ["MS", "HSD"] },
      },
    });
    const productByCode = new Map(products.map((product) => [product.code, product]));
    const ms = productByCode.get("MS");
    const hsd = productByCode.get("HSD");
    if (!ms || !hsd) throw new Error("Run the regular seed first.");

    const pump = station ??
      (await prisma.station.create({
        data: {
          organizationId: owner.organizationId,
          name: "FuelLedger Demo Petrol Pump",
          code: "DEMO-PUMP",
          addressLine1: "Avinashi Road",
          city: "Coimbatore",
          state: "Tamil Nadu",
          postalCode: "641018",
          openingTime: "06:00",
          closingTime: "23:00",
        },
      }));

    await prisma.$transaction(async (transaction) => {
      const configuration = await transaction.stationConfiguration.create({
        data: { stationId: pump.id, version: 1 },
      });
      const tankSpecs = [
        { code: "MS Tank 1", productId: ms.id, openingStock: 12450 },
        { code: "HSD Tank 1", productId: hsd.id, openingStock: 14750 },
        { code: "HSD Tank 2", productId: hsd.id, openingStock: 13900 },
      ];
      const tanks = await Promise.all(
        tankSpecs.map((tank) =>
          transaction.tank.create({
            data: {
              configurationId: configuration.id,
              ...tank,
              nominalCapacity: 20000,
              workingCapacity: 19000,
              tankType: "UNDERGROUND",
              dipMethod: "MANUAL",
              status: "ACTIVE",
            },
          }),
        ),
      );
      const tankByCode = new Map(tanks.map((tank) => [tank.code, tank.id]));
      const dispenserSpecs = [
        {
          code: "DU 1",
          nozzles: [
            { code: "MS Nozzle 1", productId: ms.id, tank: "MS Tank 1" },
            { code: "HSD Nozzle 1", productId: hsd.id, tank: "HSD Tank 1" },
          ],
        },
        {
          code: "DU 2",
          nozzles: [
            { code: "HSD Nozzle 2", productId: hsd.id, tank: "HSD Tank 2" },
          ],
        },
      ];
      for (const dispenserSpec of dispenserSpecs) {
        const dispenser = await transaction.dispenser.create({
          data: {
            configurationId: configuration.id,
            code: dispenserSpec.code,
            location: "Forecourt",
            status: "ACTIVE",
          },
        });
        for (const nozzle of dispenserSpec.nozzles) {
          await transaction.nozzle.create({
            data: {
              dispenserId: dispenser.id,
              productId: nozzle.productId,
              code: nozzle.code,
              openingMeter: 500000,
              status: "ACTIVE",
              tankMappings: {
                create: { tankId: tankByCode.get(nozzle.tank)! },
              },
            },
          });
        }
      }
    });
    station = await prisma.station.findUnique({
      where: { id: pump.id },
      include: stationInclude,
    });
  }
  const configuration = station?.configurations[0];
  if (!station || !configuration)
    throw new Error("The demo petrol pump could not be provisioned.");

  const attendants = await Promise.all(
    ["Arun Kumar", "Meena S", "Rafiq Ali", "Vijay P"].map(async (name, index) =>
      prisma.user.upsert({
        where: { email: `demo-attendant-${index + 1}@internal.fuelledger` },
        update: { name, active: true, loginEnabled: false },
        create: {
          organizationId: owner.organizationId,
          email: `demo-attendant-${index + 1}@internal.fuelledger`,
          name,
          passwordHash: await bcrypt.hash(`disabled-${index}`, 10),
          loginEnabled: false,
          role: UserRole.STAFF,
          stationAccess: { create: { stationId: station.id } },
        },
      }),
    ),
  );
  const manager = await prisma.user.findUnique({
    where: { email: "manager@fuelledger.local" },
  });
  if (!manager) throw new Error("Demo manager is missing.");
  const salaryCategory = await prisma.expenseCategory.upsert({
    where: {
      organizationId_code: {
        organizationId: owner.organizationId,
        code: "STAFF-SALARY",
      },
    },
    update: { name: "Staff Salary", active: true },
    create: {
      organizationId: owner.organizationId,
      name: "Staff Salary",
      code: "STAFF-SALARY",
    },
  });
  await prisma.userStationAccess.upsert({
    where: { userId_stationId: { userId: manager.id, stationId: station.id } },
    update: {},
    create: { userId: manager.id, stationId: station.id },
  });

  const nozzles = configuration.dispensers.flatMap(
    (dispenser) => dispenser.nozzles,
  );
  const dailyLitres = [3380, 3715, 3490, 4120, 3870, 4350, 4010];
  const paymentCycle = [
    PaymentMethod.CASH,
    PaymentMethod.UPI,
    PaymentMethod.CARD,
    PaymentMethod.CREDIT,
    PaymentMethod.FLEET,
  ];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const shiftId = `demo-real-shift-${daysAgo}`;
    const shiftNumber = 9000 + (6 - daysAgo);
    await prisma.shift.upsert({
      where: { id: shiftId },
      update: { openedAt: at(daysAgo, 6), closedAt: at(daysAgo, 22) },
      create: {
        id: shiftId,
        stationId: station.id,
        configurationId: configuration.id,
        shiftNumber,
        managerId: manager.id,
        status: ShiftStatus.RECONCILED,
        openingCash: 15000,
        closingCash: 15800,
        openedAt: at(daysAgo, 6),
        closedAt: at(daysAgo, 22),
        notes: "Demo day shift",
        users: { create: attendants.map((user) => ({ userId: user.id })) },
        tankReadings: {
          create: configuration.tanks.map((tank) => ({
            tankId: tank.id,
            openingDip: 12000,
            closingDip: 10500,
          })),
        },
        nozzleReadings: {
          create: nozzles.map((nozzle, index) => ({
            nozzleId: nozzle.id,
            openingMeter: 500000 + daysAgo * 5000 + index * 1000,
            closingMeter:
              500000 +
              daysAgo * 5000 +
              index * 1000 +
              dailyLitres[6 - daysAgo]! / nozzles.length,
          })),
        },
        nozzleAssignments: {
          create: nozzles.map((nozzle, index) => ({
            nozzleId: nozzle.id,
            userId: attendants[index % attendants.length]!.id,
          })),
        },
      },
    });
    for (const [index, nozzle] of nozzles.entries()) {
      const quantity = dailyLitres[6 - daysAgo]! / nozzles.length;
      const price = Number(nozzle.product.sellingPrice);
      const saleId = `demo-real-sale-${daysAgo}-${index}`;
      const tankId = nozzle.tankMappings[0]?.tankId ?? null;
      await prisma.sale.upsert({
        where: { id: saleId },
        update: { occurredAt: at(daysAgo, 10 + index) },
        create: {
          id: saleId,
          organizationId: owner.organizationId,
          stationId: station.id,
          shiftId,
          productId: nozzle.productId,
          employeeId: attendants[index % attendants.length]!.id,
          tankId,
          nozzleId: nozzle.id,
          kind: SaleKind.METERED,
          paymentMethod: paymentCycle[(index + daysAgo) % paymentCycle.length]!,
          quantity,
          unitPrice: price,
          totalAmount: quantity * price,
          meterOpening: 500000 + daysAgo * 5000 + index * 1000,
          meterClosing: 500000 + daysAgo * 5000 + index * 1000 + quantity,
          occurredAt: at(daysAgo, 10 + index),
          notes: "Demo metered sale",
        },
      });
      const posted = await prisma.journal.findUnique({
        where: {
          sourceType_sourceId: { sourceType: "DEMO_SALE", sourceId: saleId },
        },
      });
      if (!posted) {
        const revenue = quantity * price;
        const cost = quantity * Number(nozzle.product.purchasePrice);
        await prisma.$transaction((transaction) =>
          postJournal(transaction, {
            organizationId: owner.organizationId,
            stationId: station.id,
            createdById: owner.id,
            journalDate: at(daysAgo, 10 + index),
            reference: `DEMO-${daysAgo}-${index}`,
            description: `${nozzle.product.name} metered sale`,
            sourceType: "DEMO_SALE",
            sourceId: saleId,
            lines: [
              {
                account: collectionAccount(
                  paymentCycle[(index + daysAgo) % paymentCycle.length]!,
                ),
                debit: revenue,
              },
              { account: "4000", credit: revenue },
              { account: "5000", debit: cost },
              { account: "1200", credit: cost },
            ],
          }),
        );
      }
    }
  }

  const existingOpen = await prisma.shift.findFirst({
    where: { stationId: station.id, status: ShiftStatus.OPEN },
  });
  if (!existingOpen)
    await prisma.shift.create({
      data: {
        id: "demo-real-open-shift",
        stationId: station.id,
        configurationId: configuration.id,
        shiftNumber: 9010,
        managerId: manager.id,
        status: ShiftStatus.OPEN,
        openingCash: 15000,
        openedAt: at(0, 6),
        notes: "Live demo shift",
        users: { create: attendants.map((user) => ({ userId: user.id })) },
        tankReadings: {
          create: configuration.tanks.map((tank) => ({
            tankId: tank.id,
            openingDip: 11000,
          })),
        },
        nozzleReadings: {
          create: nozzles.map((nozzle, index) => ({
            nozzleId: nozzle.id,
            openingMeter: 650000 + index * 1200,
          })),
        },
        nozzleAssignments: {
          create: nozzles.map((nozzle, index) => ({
            nozzleId: nozzle.id,
            userId: attendants[index % attendants.length]!.id,
          })),
        },
      },
    });

  const payroll = [
    {
      id: "demo-salary-manager",
      name: manager.name,
      role: "Manager",
      amount: 32000,
    },
    ...attendants.map((attendant, index) => ({
      id: `demo-salary-attendant-${index + 1}`,
      name: attendant.name,
      role: "Customer Attendant",
      amount: [19500, 19000, 18500, 18000][index]!,
    })),
  ];
  for (const employee of payroll) {
    await prisma.expense.upsert({
      where: { id: employee.id },
      update: {
        categoryId: salaryCategory.id,
        description: `${employee.role} salary - ${employee.name}`,
        amount: employee.amount,
        paymentMethod: PaymentMethod.OTHER,
        incurredAt: at(1, 9),
        referenceNo: `PAYROLL-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
      },
      create: {
        id: employee.id,
        organizationId: owner.organizationId,
        stationId: station.id,
        categoryId: salaryCategory.id,
        description: `${employee.role} salary - ${employee.name}`,
        amount: employee.amount,
        paymentMethod: PaymentMethod.OTHER,
        incurredAt: at(1, 9),
        referenceNo: `PAYROLL-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
        notes: "Monthly salary included in the realistic demo payroll.",
        createdById: owner.id,
      },
    });
  }

  await prisma.inventoryLedger.deleteMany({
    where: { id: { startsWith: "demo-real-stock-" } },
  });
  const desired: Record<string, number> = { MS: 12450, HSD: 14750 };
  for (const [index, tank] of configuration.tanks
    .filter((tank) => ["MS", "HSD"].includes(tank.product.code))
    .entries()) {
    const other = await prisma.inventoryLedger.aggregate({
      where: { tankId: tank.id },
      _sum: { quantityDelta: true },
    });
    const target = desired[tank.product.code]! - index * 850;
    const delta =
      target -
      Number(tank.openingStock) -
      Number(other._sum.quantityDelta ?? 0);
    await prisma.inventoryLedger.create({
      data: {
        id: `demo-real-stock-${tank.id}`,
        organizationId: owner.organizationId,
        stationId: station.id,
        productId: tank.productId,
        tankId: tank.id,
        type: "ADJUSTMENT",
        quantityDelta: delta,
        unitCost: tank.product.purchasePrice,
        note: "Demo opening balance",
        occurredAt: at(6, 5),
        createdById: owner.id,
      },
    });
    await prisma.tankReading.create({
      data: {
        organizationId: owner.organizationId,
        stationId: station.id,
        tankId: tank.id,
        physicalStock: target - 18 + index * 7,
        dipReading: target - 18 + index * 7,
        notes: "Morning physical stock",
        recordedById: owner.id,
      },
    });
    await prisma.tankDensityReading.create({
      data: {
        organizationId: owner.organizationId,
        stationId: station.id,
        tankId: tank.id,
        density: tank.product.code === "MS" ? 742.6 : 832.4,
        recordedById: owner.id,
      },
    });
  }
  const allSales = await prisma.sale.findMany({
    where: { organizationId: owner.organizationId },
    include: { product: true },
  });
  for (const sale of allSales) {
    const posted = await prisma.journal.findFirst({
      where: { sourceId: sale.id, sourceType: { in: ["SALE", "DEMO_SALE"] } },
    });
    if (posted) continue;
    const revenue = Number(sale.totalAmount),
      cost = Number(sale.quantity) * Number(sale.product.purchasePrice);
    await prisma.$transaction((transaction) =>
      postJournal(transaction, {
        organizationId: owner.organizationId,
        stationId: sale.stationId,
        createdById: sale.employeeId,
        journalDate: sale.occurredAt,
        reference: `BACKFILL-${sale.id.slice(-8)}`,
        description: `${sale.product.name} sale`,
        sourceType: "SALE",
        sourceId: sale.id,
        lines: [
          { account: collectionAccount(sale.paymentMethod), debit: revenue },
          {
            account: sale.product.isService ? "4010" : "4000",
            credit: revenue,
          },
          ...(sale.product.inventoryTracked
            ? [
                { account: "5000", debit: cost },
                { account: "1200", credit: cost },
              ]
            : []),
        ],
      }),
    );
  }
  const allExpenses = await prisma.expense.findMany({
    where: { organizationId: owner.organizationId },
  });
  for (const expense of allExpenses) {
    if (
      await prisma.journal.findUnique({
        where: {
          sourceType_sourceId: { sourceType: "EXPENSE", sourceId: expense.id },
        },
      })
    )
      continue;
    await prisma.$transaction((transaction) =>
      postJournal(transaction, {
        organizationId: owner.organizationId,
        stationId: expense.stationId,
        createdById: expense.createdById,
        journalDate: expense.incurredAt,
        reference: `BACKFILL-${expense.id.slice(-8)}`,
        description: expense.description,
        sourceType: "EXPENSE",
        sourceId: expense.id,
        lines: [
          { account: "6100", debit: expense.amount },
          {
            account: collectionAccount(expense.paymentMethod),
            credit: expense.amount,
          },
        ],
      }),
    );
  }
  console.log("Realistic demo activity loaded.");
}

main().finally(() => prisma.$disconnect());
