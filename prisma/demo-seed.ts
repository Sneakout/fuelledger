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
const transactionOptions = { maxWait: 15_000, timeout: 60_000 };
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
          name: "FuelNerve Demo Petrol Pump",
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
    }, transactionOptions);
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

  const creditCustomer = await prisma.customer.upsert({
    where: {
      organizationId_code: {
        organizationId: owner.organizationId,
        code: "SOUTHERN-TRANS",
      },
    },
    update: { name: "Southern Transport", active: true },
    create: {
      id: "demo-customer-southern-transport",
      organizationId: owner.organizationId,
      name: "Southern Transport",
      code: "SOUTHERN-TRANS",
      type: "CREDIT",
      phone: "919876543210",
      creditLimit: 300000,
      creditDays: 15,
      active: true,
    },
  });
  const fleetCustomer = await prisma.customer.upsert({
    where: {
      organizationId_code: {
        organizationId: owner.organizationId,
        code: "CITY-CABS",
      },
    },
    update: { name: "City Cabs Fleet", active: true },
    create: {
      id: "demo-customer-city-cabs",
      organizationId: owner.organizationId,
      name: "City Cabs Fleet",
      code: "CITY-CABS",
      type: "FLEET",
      phone: "919812345678",
      creditLimit: 180000,
      creditDays: 7,
      active: true,
    },
  });
  const fleetVehicle = await prisma.vehicle.upsert({
    where: {
      customerId_number: {
        customerId: fleetCustomer.id,
        number: "TN 37 AB 2468",
      },
    },
    update: { label: "Airport cab", active: true },
    create: {
      id: "demo-vehicle-city-cabs-1",
      customerId: fleetCustomer.id,
      number: "TN 37 AB 2468",
      label: "Airport cab",
      active: true,
    },
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
      const paymentMethod =
        paymentCycle[(index + daysAgo) % paymentCycle.length]!;
      const customer =
        paymentMethod === PaymentMethod.CREDIT
          ? creditCustomer
          : paymentMethod === PaymentMethod.FLEET
            ? fleetCustomer
            : null;
      await prisma.sale.upsert({
        where: { id: saleId },
        update: {
          occurredAt: at(daysAgo, 10 + index),
          paymentMethod,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
          vehicleId:
            paymentMethod === PaymentMethod.FLEET ? fleetVehicle.id : null,
          vehicleNumber:
            paymentMethod === PaymentMethod.FLEET ? fleetVehicle.number : null,
        },
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
          paymentMethod,
          quantity,
          unitPrice: price,
          totalAmount: quantity * price,
          meterOpening: 500000 + daysAgo * 5000 + index * 1000,
          meterClosing: 500000 + daysAgo * 5000 + index * 1000 + quantity,
          occurredAt: at(daysAgo, 10 + index),
          notes: "Demo metered sale",
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
          vehicleId:
            paymentMethod === PaymentMethod.FLEET ? fleetVehicle.id : null,
          vehicleNumber:
            paymentMethod === PaymentMethod.FLEET ? fleetVehicle.number : null,
        },
      });
      if (customer) {
        const occurredAt = at(daysAgo, 10 + index);
        const dueDate = new Date(occurredAt);
        dueDate.setDate(dueDate.getDate() + customer.creditDays);
        await prisma.customerLedgerEntry.upsert({
          where: { saleId },
          update: {
            customerId: customer.id,
            amount: quantity * price,
            dueDate,
            occurredAt,
          },
          create: {
            id: `demo-ledger-${daysAgo}-${index}`,
            organizationId: owner.organizationId,
            stationId: station.id,
            customerId: customer.id,
            type: "SALE",
            amount: quantity * price,
            saleId,
            description: `${nozzle.product.name} supplied on account`,
            dueDate,
            occurredAt,
            createdById: attendants[index % attendants.length]!.id,
          },
        });
      }
      const posted = await prisma.journal.findUnique({
        where: {
          sourceType_sourceId: { sourceType: "DEMO_SALE", sourceId: saleId },
        },
      });
      if (posted) {
        await prisma.journal.update({
          where: { id: posted.id },
          data: { journalDate: at(daysAgo, 10 + index) },
        });
      } else {
        const revenue = quantity * price;
        const cost = quantity * Number(nozzle.product.purchasePrice);
        await prisma.$transaction(
          (transaction) => postJournal(transaction, {
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
                  paymentMethod,
                ),
                debit: revenue,
              },
              { account: "4000", credit: revenue },
              { account: "5000", debit: cost },
              { account: "1200", credit: cost },
            ],
          }),
          transactionOptions,
        );
      }
    }
    const shiftSales = await prisma.sale.groupBy({
      by: ["paymentMethod"],
      where: { shiftId },
      _sum: { totalAmount: true },
    });
    const reconciliation = await prisma.shiftReconciliation.upsert({
      where: { shiftId },
      update: {
        reconciledById: owner.id,
        reconciledAt: at(daysAgo, 22),
        lockedAt: at(daysAgo, 22),
        notes: "Demo collections checked and matched.",
      },
      create: {
        id: `demo-reconciliation-${daysAgo}`,
        shiftId,
        reconciledById: owner.id,
        reconciledAt: at(daysAgo, 22),
        lockedAt: at(daysAgo, 22),
        notes: "Demo collections checked and matched.",
      },
    });
    const totals = new Map(
      shiftSales.map((row) => [
        row.paymentMethod,
        Number(row._sum.totalAmount ?? 0),
      ]),
    );
    for (const method of Object.values(PaymentMethod)) {
      const amount = totals.get(method) ?? 0;
      await prisma.shiftCollectionReconciliation.upsert({
        where: {
          reconciliationId_paymentMethod: {
            reconciliationId: reconciliation.id,
            paymentMethod: method,
          },
        },
        update: {
          expectedAmount: amount,
          actualAmount: amount,
          adjustmentAmount: 0,
          adjustmentReason: null,
          varianceAmount: 0,
        },
        create: {
          reconciliationId: reconciliation.id,
          paymentMethod: method,
          expectedAmount: amount,
          actualAmount: amount,
          adjustmentAmount: 0,
          varianceAmount: 0,
        },
      });
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

  const supplier = await prisma.supplier.upsert({
    where: {
      organizationId_code: {
        organizationId: owner.organizationId,
        code: "DEMO-OIL-CO",
      },
    },
    update: { name: "Indian Oil Corporation Ltd", active: true },
    create: {
      id: "demo-supplier-oil-company",
      organizationId: owner.organizationId,
      name: "Indian Oil Corporation Ltd",
      code: "DEMO-OIL-CO",
      paymentTerms: 3,
      active: true,
    },
  });
  const purchaseSpecs = [
    {
      id: "demo-purchase-hsd-paid",
      lineId: "demo-purchase-line-hsd-paid",
      receiptId: "demo-receipt-hsd-paid",
      receiptLineId: "demo-receipt-line-hsd-paid",
      paymentId: "demo-payment-hsd-paid",
      productCode: "HSD",
      invoiceNumber: "DEMO-HSD-10021",
      quantity: 10000,
      daysAgo: 5,
      paid: true,
    },
    {
      id: "demo-purchase-ms-open",
      lineId: "demo-purchase-line-ms-open",
      receiptId: "demo-receipt-ms-open",
      receiptLineId: "demo-receipt-line-ms-open",
      paymentId: "demo-payment-ms-open",
      productCode: "MS",
      invoiceNumber: "DEMO-MS-10038",
      quantity: 8000,
      daysAgo: 1,
      paid: false,
    },
  ];
  for (const spec of purchaseSpecs) {
    const tank = configuration.tanks.find(
      (item) => item.product.code === spec.productCode,
    );
    if (!tank) continue;
    const invoiceDate = at(spec.daysAgo, 8);
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + 3);
    const unitCost = Number(tank.product.purchasePrice);
    const total = spec.quantity * unitCost;
    await prisma.purchaseInvoice.upsert({
      where: { id: spec.id },
      update: {
        invoiceDate,
        dueDate,
        subtotal: total,
        totalAmount: total,
        status: spec.paid ? "PAID" : "OPEN",
      },
      create: {
        id: spec.id,
        organizationId: owner.organizationId,
        stationId: station.id,
        supplierId: supplier.id,
        invoiceNumber: spec.invoiceNumber,
        invoiceDate,
        dueDate,
        subtotal: total,
        taxAmount: 0,
        totalAmount: total,
        status: spec.paid ? "PAID" : "OPEN",
        notes: "Sample fuel delivery for the product tour.",
        createdById: owner.id,
      },
    });
    await prisma.purchaseInvoiceLine.upsert({
      where: { id: spec.lineId },
      update: { quantity: spec.quantity, unitCost, lineTotal: total },
      create: {
        id: spec.lineId,
        invoiceId: spec.id,
        productId: tank.productId,
        description: `${tank.product.name} bulk delivery`,
        quantity: spec.quantity,
        unitCost,
        taxRate: 0,
        lineTotal: total,
      },
    });
    await prisma.purchaseReceipt.upsert({
      where: { id: spec.receiptId },
      update: { receivedAt: invoiceDate },
      create: {
        id: spec.receiptId,
        organizationId: owner.organizationId,
        stationId: station.id,
        supplierName: supplier.name,
        referenceNo: spec.invoiceNumber,
        receivedAt: invoiceDate,
        notes: "Stock received against the sample invoice.",
        createdById: owner.id,
        supplierId: supplier.id,
        invoiceId: spec.id,
      },
    });
    await prisma.receiptLine.upsert({
      where: { id: spec.receiptLineId },
      update: { quantity: spec.quantity, unitCost },
      create: {
        id: spec.receiptLineId,
        receiptId: spec.receiptId,
        productId: tank.productId,
        tankId: tank.id,
        quantity: spec.quantity,
        unitCost,
      },
    });
    await prisma.inventoryLedger.upsert({
      where: { id: `demo-purchase-stock-${spec.productCode.toLowerCase()}` },
      update: { occurredAt: invoiceDate, quantityDelta: spec.quantity, unitCost },
      create: {
        id: `demo-purchase-stock-${spec.productCode.toLowerCase()}`,
        organizationId: owner.organizationId,
        stationId: station.id,
        productId: tank.productId,
        tankId: tank.id,
        type: "RECEIPT",
        quantityDelta: spec.quantity,
        unitCost,
        receiptLineId: spec.receiptLineId,
        note: `Stock received against ${spec.invoiceNumber}`,
        occurredAt: invoiceDate,
        createdById: owner.id,
      },
    });
    if (spec.paid)
      await prisma.supplierPayment.upsert({
        where: { id: spec.paymentId },
        update: { amount: total, paidAt: invoiceDate },
        create: {
          id: spec.paymentId,
          origin: "RECORDED_PAYMENT",
          organizationId: owner.organizationId,
          stationId: station.id,
          supplierId: supplier.id,
          invoiceId: spec.id,
          amount: total,
          paymentMethod: PaymentMethod.UPI,
          referenceNo: "DEMO-UTR-4821",
          paidAt: invoiceDate,
          createdById: owner.id,
        },
      });
    if (
      !(await prisma.journal.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: "PURCHASE_INVOICE",
            sourceId: spec.id,
          },
        },
      }))
    )
      await prisma.$transaction(
        (transaction) =>
          postJournal(transaction, {
            organizationId: owner.organizationId,
            stationId: station.id,
            createdById: owner.id,
            journalDate: invoiceDate,
            reference: spec.invoiceNumber,
            description: `${tank.product.name} stock received`,
            sourceType: "PURCHASE_INVOICE",
            sourceId: spec.id,
            lines: [
              { account: "1200", debit: total },
              { account: "2000", credit: total },
            ],
          }),
        transactionOptions,
      );
    if (
      spec.paid &&
      !(await prisma.journal.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: "SUPPLIER_PAYMENT",
            sourceId: spec.paymentId,
          },
        },
      }))
    )
      await prisma.$transaction(
        (transaction) =>
          postJournal(transaction, {
            organizationId: owner.organizationId,
            stationId: station.id,
            createdById: owner.id,
            journalDate: invoiceDate,
            reference: "DEMO-UTR-4821",
            description: `Payment to ${supplier.name}`,
            sourceType: "SUPPLIER_PAYMENT",
            sourceId: spec.paymentId,
            lines: [
              { account: "2000", debit: total },
              { account: "1010", credit: total },
            ],
          }),
        transactionOptions,
      );
  }

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
    await prisma.tankReading.upsert({
      where: { id: `demo-tank-reading-${tank.id}` },
      update: {
        physicalStock: target - 18 + index * 7,
        dipReading: target - 18 + index * 7,
        recordedAt: at(0, 7),
      },
      create: {
        id: `demo-tank-reading-${tank.id}`,
        organizationId: owner.organizationId,
        stationId: station.id,
        tankId: tank.id,
        physicalStock: target - 18 + index * 7,
        dipReading: target - 18 + index * 7,
        notes: "Morning physical stock",
        recordedById: owner.id,
      },
    });
    await prisma.tankDensityReading.upsert({
      where: { id: `demo-density-reading-${tank.id}` },
      update: {
        density: tank.product.code === "MS" ? 742.6 : 832.4,
        recordedAt: at(0, 7),
      },
      create: {
        id: `demo-density-reading-${tank.id}`,
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
    await prisma.$transaction(
      (transaction) => postJournal(transaction, {
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
      transactionOptions,
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
    await prisma.$transaction(
      (transaction) => postJournal(transaction, {
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
      transactionOptions,
    );
  }
  console.log("Realistic demo activity loaded.");
}

main().finally(() => prisma.$disconnect());
