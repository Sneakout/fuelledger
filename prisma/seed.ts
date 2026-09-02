import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Development seed is disabled in production.");
  const organization = await prisma.organization.upsert({
    where: { id: "org_demo_fuelledger" },
    update: {},
    create: { id: "org_demo_fuelledger", name: "ABC Fuels" },
  });
  await prisma.user.upsert({
    where: { email: "owner@fuelledger.local" },
    update: {},
    create: {
      organizationId: organization.id,
      email: "owner@fuelledger.local",
      name: "Demo Owner",
      passwordHash: await bcrypt.hash("FuelLedger123!", 12),
      role: UserRole.OWNER,
    },
  });
  await prisma.user.upsert({
    where: { email: "manager@fuelledger.local" },
    update: {},
    create: {
      organizationId: organization.id,
      email: "manager@fuelledger.local",
      name: "Demo Manager",
      passwordHash: await bcrypt.hash("FuelLedger123!", 12),
      role: UserRole.MANAGER,
    },
  });
  const taxes = await Promise.all(
    [
      { name: "GST 0%", rate: 0 },
      { name: "GST 5%", rate: 5 },
      { name: "GST 18%", rate: 18 },
    ].map((tax) =>
      prisma.taxCategory.upsert({
        where: {
          organizationId_name: {
            organizationId: organization.id,
            name: tax.name,
          },
        },
        update: { rate: tax.rate },
        create: { organizationId: organization.id, ...tax },
      }),
    ),
  );
  const standardProducts = [
    {
      name: "Motor Spirit (MS)",
      code: "MS",
      category: "FUEL" as const,
      unit: "LITRE" as const,
      purchasePrice: 96,
      sellingPrice: 102,
      inventoryTracked: true,
      tankLinked: true,
      meterLinked: true,
      isService: false,
    },
    {
      name: "High Speed Diesel (HSD)",
      code: "HSD",
      category: "FUEL" as const,
      unit: "LITRE" as const,
      purchasePrice: 88,
      sellingPrice: 94,
      inventoryTracked: true,
      tankLinked: true,
      meterLinked: true,
      isService: false,
    },
    {
      name: "DEF Bulk",
      code: "DEF",
      category: "DEF" as const,
      unit: "LITRE" as const,
      purchasePrice: 32,
      sellingPrice: 45,
      inventoryTracked: true,
      tankLinked: true,
      meterLinked: true,
      isService: false,
    },
    {
      name: "Engine Oil",
      code: "ENG-OIL",
      category: "LUBRICANTS" as const,
      unit: "PIECE" as const,
      purchasePrice: 390,
      sellingPrice: 620,
      inventoryTracked: true,
      tankLinked: false,
      meterLinked: false,
      isService: false,
    },
    {
      name: "Bottled Water",
      code: "WATER",
      category: "RETAIL" as const,
      unit: "PIECE" as const,
      purchasePrice: 12,
      sellingPrice: 20,
      inventoryTracked: true,
      tankLinked: false,
      meterLinked: false,
      isService: false,
    },
    {
      name: "Car Wash",
      code: "CAR-WASH",
      category: "SERVICES" as const,
      unit: "UNIT" as const,
      purchasePrice: 0,
      sellingPrice: 450,
      inventoryTracked: false,
      tankLinked: false,
      meterLinked: false,
      isService: true,
    },
    {
      name: "EV Charging",
      code: "EV-CHARGE",
      category: "EV_CHARGING" as const,
      unit: "KWH" as const,
      purchasePrice: 7,
      sellingPrice: 12,
      inventoryTracked: false,
      tankLinked: false,
      meterLinked: false,
      isService: false,
    },
    {
      name: "Advertising Income",
      code: "AD-INCOME",
      category: "OTHER" as const,
      unit: "UNIT" as const,
      purchasePrice: 0,
      sellingPrice: 5000,
      inventoryTracked: false,
      tankLinked: false,
      meterLinked: false,
      isService: true,
    },
  ];
  for (const product of standardProducts)
    await prisma.product.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: product.code,
        },
      },
      update: { ...product, taxCategoryId: taxes[0]!.id },
      create: {
        organizationId: organization.id,
        ...product,
        taxCategoryId: taxes[0]!.id,
      },
    });
  console.log(
    "Product catalog seed complete: demo owner, tax categories, and standard products created.",
  );
}

main().finally(() => prisma.$disconnect());
