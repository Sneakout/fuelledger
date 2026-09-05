import { z } from "zod";

export const roles = ["OWNER", "MANAGER", "ACCOUNTANT", "STAFF"] as const;
export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  role: z.enum(roles),
  organization: z.object({ id: z.string(), name: z.string() }),
  allStations: z.boolean(),
  stations: z.array(
    z.object({ id: z.string(), name: z.string(), code: z.string() }),
  ),
  isPlatformAdmin: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  demoExpiresAt: z.string().datetime().optional(),
});
export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  organizationName: z.string().trim().min(2, "Enter your business name"),
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number"),
});
export const googleAuthSchema = z.object({ credential: z.string().min(20) });
export const demoAccessSchema = z
  .object({ contact: z.string().trim().min(5).max(254) })
  .superRefine((value, context) => {
    const email = z.email().safeParse(value.contact).success;
    const phone = /^\+?[0-9][0-9\s-]{7,18}$/.test(value.contact);
    if (!email && !phone)
      context.addIssue({
        code: "custom",
        path: ["contact"],
        message: "Enter a valid email address or mobile number",
      });
  });
export const customerSubscriptionUpdateSchema = z
  .object({ setupFeePaid: z.boolean(), lifetimeAccessPaid: z.boolean() })
  .superRefine((value, context) => {
    if (value.lifetimeAccessPaid && !value.setupFeePaid)
      context.addIssue({
        code: "custom",
        path: ["setupFeePaid"],
        message:
          "Setup payment must be confirmed before lifetime access can be activated.",
      });
  });
export type User = z.infer<typeof userSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type DemoAccessInput = z.infer<typeof demoAccessSchema>;
export type CustomerSubscriptionUpdateInput = z.infer<
  typeof customerSubscriptionUpdateSchema
>;
export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
};
const whatsappNumber = z.preprocess(
  (value) =>
    typeof value === "string" ? value.replace(/[\s()-]/g, "") : value,
  z
    .string()
    .regex(
      /^\+?[1-9]\d{7,14}$/,
      "Enter a valid WhatsApp number with country code.",
    )
    .transform((value) => value.replace(/\D/g, "")),
);
export const ownerNotificationSettingsSchema = z
  .object({
    whatsappNumber: whatsappNumber.optional().or(z.literal("")),
    whatsappOptedIn: z.boolean(),
    densityMissingEnabled: z.boolean(),
    lowStockEnabled: z.boolean(),
    shiftVarianceEnabled: z.boolean(),
    unclosedShiftEnabled: z.boolean(),
    dailySummaryEnabled: z.boolean(),
    overdueCustomerEnabled: z.boolean(),
    lowStockPercent: z.coerce.number().int().min(1).max(50),
    varianceThreshold: z.coerce.number().min(0).max(1_000_000),
    dailySummaryHour: z.coerce.number().int().min(0).max(23),
  })
  .superRefine((value, context) => {
    if (value.whatsappOptedIn && !value.whatsappNumber)
      context.addIssue({
        code: "custom",
        path: ["whatsappNumber"],
        message: "Enter the owner’s WhatsApp number before enabling alerts.",
      });
  });
export type OwnerNotificationSettingsInput = z.infer<
  typeof ownerNotificationSettingsSchema
>;
export const stationAccessInputSchema = z.object({
  stationIds: z.array(z.string().cuid()).max(100),
});
export type StationAccessInput = z.infer<typeof stationAccessInputSchema>;
export const staffInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  stationIds: z.array(z.string().cuid()).min(1),
});
export type StaffInput = z.infer<typeof staffInputSchema>;
export const managerInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email("Enter a valid email address"),
  temporaryPassword: z
    .string()
    .min(8, "Temporary password must be at least 8 characters")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number"),
  stationId: z.string().cuid(),
});
export const changePasswordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number"),
});
export type ManagerInput = z.infer<typeof managerInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export const nozzleCustodySchema = z.object({
  assignments: z
    .array(z.object({ nozzleId: z.string().cuid(), userId: z.string().cuid() }))
    .min(1),
});
export type NozzleCustodyInput = z.infer<typeof nozzleCustodySchema>;

export const productCategories = [
  "FUEL",
  "DEF",
  "LUBRICANTS",
  "FLUIDS",
  "RETAIL",
  "ACCESSORIES",
  "SERVICES",
  "EV_CHARGING",
  "OTHER",
] as const;
export const units = [
  "LITRE",
  "KILOGRAM",
  "PIECE",
  "BOX",
  "UNIT",
  "KWH",
] as const;
const equipmentStatus = z.enum(["ACTIVE", "INACTIVE"]);
export const stationProfileSchema = z.object({
  name: z.string().trim().min(2),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]+$/, "Use letters, numbers, and hyphens only"),
  addressLine1: z.string().trim().min(3),
  city: z.string().trim().min(2),
  state: z.string().trim().min(2),
  postalCode: z.string().trim().min(4),
  phone: z.string().trim().optional(),
  gstin: z.string().trim().optional(),
  openingTime: z.string().optional(),
  closingTime: z.string().optional(),
});
export type StationProfileInput = z.infer<typeof stationProfileSchema>;
export const stationSetupSchema = z
  .object({
    profile: stationProfileSchema,
    products: z
      .array(
        z.object({
          name: z.string().min(2),
          code: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z0-9-]+$/),
          category: z.enum(productCategories),
          unit: z.enum(units),
          inventoryTracked: z.boolean(),
          tankLinked: z.boolean(),
          meterLinked: z.boolean(),
          isService: z.boolean(),
          active: z.boolean(),
        }),
      )
      .min(1),
    tanks: z.array(
      z.object({
        code: z.string().min(1),
        productCode: z.string().min(1),
        nominalCapacity: z.coerce.number().positive(),
        workingCapacity: z.coerce.number().positive(),
        openingStock: z.coerce.number().min(0),
        tankType: z.enum(["UNDERGROUND", "ABOVE_GROUND"]),
        dipMethod: z.enum(["MANUAL", "ATG"]),
        status: equipmentStatus,
      }),
    ),
    dispensers: z.array(
      z.object({
        code: z.string().min(1),
        location: z.string().optional(),
        status: equipmentStatus,
        nozzles: z
          .array(
            z.object({
              code: z.string().min(1),
              productCode: z.string().min(1),
              openingMeter: z.coerce.number().min(0),
              status: equipmentStatus,
              tankCodes: z.array(z.string().min(1)),
            }),
          )
          .min(1),
      }),
    ),
  })
  .superRefine((setup, context) => {
    const duplicate = (values: string[]) =>
      new Set(values).size !== values.length;
    if (duplicate(setup.products.map((x) => x.code)))
      context.addIssue({
        code: "custom",
        message: "Product codes must be unique.",
        path: ["products"],
      });
    if (duplicate(setup.tanks.map((x) => x.code)))
      context.addIssue({
        code: "custom",
        message: "Tank IDs must be unique.",
        path: ["tanks"],
      });
    if (duplicate(setup.dispensers.map((x) => x.code)))
      context.addIssue({
        code: "custom",
        message: "Dispenser IDs must be unique.",
        path: ["dispensers"],
      });
    const products = new Map(setup.products.map((x) => [x.code, x]));
    const tanks = new Map(setup.tanks.map((x) => [x.code, x]));
    for (const [tankIndex, tank] of setup.tanks.entries()) {
      const product = products.get(tank.productCode);
      if (!product)
        context.addIssue({
          code: "custom",
          message: `Tank ${tank.code} refers to an unknown product.`,
          path: ["tanks", tankIndex, "productCode"],
        });
      else if (!product.tankLinked)
        context.addIssue({
          code: "custom",
          message: `${product.code} must be tank-linked before assigning it to a tank.`,
          path: ["tanks", tankIndex, "productCode"],
        });
      if (tank.workingCapacity > tank.nominalCapacity)
        context.addIssue({
          code: "custom",
          message: "Working capacity cannot exceed nominal capacity.",
          path: ["tanks", tankIndex, "workingCapacity"],
        });
      if (tank.openingStock > tank.workingCapacity)
        context.addIssue({
          code: "custom",
          message: "Opening stock cannot exceed working capacity.",
          path: ["tanks", tankIndex, "openingStock"],
        });
    }
    for (const [dIndex, dispenser] of setup.dispensers.entries())
      for (const [nIndex, nozzle] of dispenser.nozzles.entries()) {
        const product = products.get(nozzle.productCode);
        if (!product)
          context.addIssue({
            code: "custom",
            message: `Nozzle ${nozzle.code} refers to an unknown product.`,
            path: ["dispensers", dIndex, "nozzles", nIndex, "productCode"],
          });
        else if (!product.meterLinked)
          context.addIssue({
            code: "custom",
            message: `${product.code} must be meter-linked before assigning it to a nozzle.`,
            path: ["dispensers", dIndex, "nozzles", nIndex, "productCode"],
          });
        if (duplicate(nozzle.tankCodes))
          context.addIssue({
            code: "custom",
            message: "A nozzle cannot map to the same tank twice.",
            path: ["dispensers", dIndex, "nozzles", nIndex, "tankCodes"],
          });
        for (const tankCode of nozzle.tankCodes) {
          const tank = tanks.get(tankCode);
          if (!tank)
            context.addIssue({
              code: "custom",
              message: `Nozzle ${nozzle.code} refers to an unknown tank.`,
              path: ["dispensers", dIndex, "nozzles", nIndex, "tankCodes"],
            });
          else if (tank.productCode !== nozzle.productCode)
            context.addIssue({
              code: "custom",
              message: `Nozzle ${nozzle.code} and tank ${tankCode} must use the same product.`,
              path: ["dispensers", dIndex, "nozzles", nIndex, "tankCodes"],
            });
        }
      }
  });
export type StationSetup = z.infer<typeof stationSetupSchema>;
const equipmentCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9-]+$/, "Use letters, numbers, and hyphens only");
export const stationEquipmentShapeSchema = z.object({
  configurationId: z.string().cuid(),
  tanks: z.array(
    z.object({
      key: z.string().min(1).max(80),
      id: z.string().cuid().optional(),
      code: equipmentCode,
      productId: z.string().cuid(),
      nominalCapacity: z.coerce.number().positive(),
      workingCapacity: z.coerce.number().positive(),
      openingStock: z.coerce.number().min(0),
      tankType: z.enum(["UNDERGROUND", "ABOVE_GROUND"]),
      dipMethod: z.enum(["MANUAL", "ATG"]),
      status: equipmentStatus,
    }),
  ),
  dispensers: z.array(
    z.object({
      id: z.string().cuid().optional(),
      code: equipmentCode,
      location: z.string().trim().max(120).optional(),
      status: equipmentStatus,
      nozzles: z.array(
        z.object({
          id: z.string().cuid().optional(),
          code: equipmentCode,
          productId: z.string().cuid(),
          openingMeter: z.coerce.number().min(0),
          status: equipmentStatus,
          tankKeys: z.array(z.string().min(1).max(80)),
        }),
      ),
    }),
  ),
});
export type StationEquipmentShapeInput = z.infer<
  typeof stationEquipmentShapeSchema
>;
export function restorePersistedEquipmentConnections(
  equipment: StationEquipmentShapeInput,
  persistedTankIdsByNozzleId: ReadonlyMap<string, readonly string[]>,
): StationEquipmentShapeInput {
  const tankKeyById = new Map(
    equipment.tanks.flatMap((tank) =>
      tank.id ? [[tank.id, tank.key] as const] : [],
    ),
  );
  const tanksByKey = new Map(equipment.tanks.map((tank) => [tank.key, tank]));
  return {
    ...equipment,
    dispensers: equipment.dispensers.map((dispenser) => ({
      ...dispenser,
      nozzles: dispenser.nozzles.map((nozzle) => {
        if (nozzle.status !== "ACTIVE" || nozzle.tankKeys.length || !nozzle.id)
          return nozzle;
        const restored = [
          ...new Set(
            (persistedTankIdsByNozzleId.get(nozzle.id) ?? [])
              .map((tankId) => tankKeyById.get(tankId))
              .filter((key): key is string => Boolean(key))
              .filter((key) => {
                const tank = tanksByKey.get(key);
                return (
                  tank?.status === "ACTIVE" &&
                  tank.productId === nozzle.productId
                );
              }),
          ),
        ];
        return restored.length ? { ...nozzle, tankKeys: restored } : nozzle;
      }),
    })),
  };
}
export const stationEquipmentSchema = stationEquipmentShapeSchema.superRefine(
  (equipment, context) => {
    const duplicate = (values: string[]) =>
      new Set(values).size !== values.length;
    if (duplicate(equipment.tanks.map((item) => item.code)))
      context.addIssue({
        code: "custom",
        message: "Tank IDs must be unique.",
        path: ["tanks"],
      });
    if (duplicate(equipment.dispensers.map((item) => item.code)))
      context.addIssue({
        code: "custom",
        message: "DU IDs must be unique.",
        path: ["dispensers"],
      });
    if (duplicate(equipment.tanks.map((item) => item.key)))
      context.addIssue({
        code: "custom",
        message: "Tank references must be unique.",
        path: ["tanks"],
      });
    const tanks = new Map(equipment.tanks.map((item) => [item.key, item]));
    for (const [tankIndex, item] of equipment.tanks.entries()) {
      if (item.workingCapacity > item.nominalCapacity)
        context.addIssue({
          code: "custom",
          message: "Working capacity cannot exceed nominal capacity.",
          path: ["tanks", tankIndex, "workingCapacity"],
        });
      if (item.openingStock > item.workingCapacity)
        context.addIssue({
          code: "custom",
          message: "Opening stock cannot exceed working capacity.",
          path: ["tanks", tankIndex, "openingStock"],
        });
    }
    for (const [dIndex, dispenser] of equipment.dispensers.entries()) {
      if (duplicate(dispenser.nozzles.map((item) => item.code)))
        context.addIssue({
          code: "custom",
          message: `Nozzle IDs must be unique within DU ${dispenser.code}.`,
          path: ["dispensers", dIndex, "nozzles"],
        });
      if (
        dispenser.status === "INACTIVE" &&
        dispenser.nozzles.some((item) => item.status === "ACTIVE")
      )
        context.addIssue({
          code: "custom",
          message: `Make all nozzles inactive before making DU ${dispenser.code} inactive.`,
          path: ["dispensers", dIndex, "status"],
        });
      for (const [nIndex, item] of dispenser.nozzles.entries()) {
        if (duplicate(item.tankKeys))
          context.addIssue({
            code: "custom",
            message: "A nozzle cannot connect to the same tank twice.",
            path: ["dispensers", dIndex, "nozzles", nIndex, "tankKeys"],
          });
        if (item.status === "ACTIVE" && item.tankKeys.length === 0)
          context.addIssue({
            code: "custom",
            message: `Active nozzle ${item.code} must connect to a tank.`,
            path: ["dispensers", dIndex, "nozzles", nIndex, "tankKeys"],
          });
        for (const tankKey of item.tankKeys) {
          const tank = tanks.get(tankKey);
          if (!tank)
            context.addIssue({
              code: "custom",
              message: `Nozzle ${item.code} refers to an unknown tank.`,
              path: ["dispensers", dIndex, "nozzles", nIndex, "tankKeys"],
            });
          else if (tank.productId !== item.productId)
            context.addIssue({
              code: "custom",
              message: `Nozzle ${item.code} and tank ${tank.code} must use the same product.`,
              path: ["dispensers", dIndex, "nozzles", nIndex, "tankKeys"],
            });
          else if (item.status === "ACTIVE" && tank.status !== "ACTIVE")
            context.addIssue({
              code: "custom",
              message: `Active nozzle ${item.code} cannot connect to inactive tank ${tank.code}.`,
              path: ["dispensers", dIndex, "nozzles", nIndex, "tankKeys"],
            });
        }
      }
    }
  },
);
export type StationEquipmentInput = z.infer<typeof stationEquipmentSchema>;
// Drafts deliberately accept incomplete equipment while an owner is still setting up.
export const stationSetupDraftSchema = z.object({
  setup: z.object({}).passthrough(),
});
export type StationSetupDraftInput = z.infer<typeof stationSetupDraftSchema>;

export const productInputSchema = z
  .object({
    name: z.string().trim().min(2),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]+$/),
    hsnCode: z.string().trim().max(20).optional().or(z.literal("")),
    category: z.enum(productCategories),
    customCategoryId: z.string().cuid().nullable().optional(),
    unit: z.enum(units),
    purchasePrice: z.coerce.number().min(0),
    purchasePriceEffectiveFrom: z.string().datetime().optional(),
    sellingPrice: z.coerce.number().min(0),
    sellingPriceEffectiveFrom: z.string().datetime().optional(),
    taxCategoryId: z.string().cuid().nullable().optional(),
    inventoryTracked: z.boolean(),
    tankLinked: z.boolean(),
    meterLinked: z.boolean(),
    isService: z.boolean(),
    active: z.boolean(),
  })
  .superRefine((product, context) => {
    if (
      product.isService &&
      (product.inventoryTracked || product.tankLinked || product.meterLinked)
    )
      context.addIssue({
        code: "custom",
        message: "Services cannot be inventory-, tank-, or meter-linked.",
      });
    if (
      (product.tankLinked || product.meterLinked) &&
      !product.inventoryTracked
    )
      context.addIssue({
        code: "custom",
        message: "Tank or meter linkage requires inventory tracking.",
      });
    if (
      (product.tankLinked || product.meterLinked) &&
      !["FUEL", "DEF"].includes(product.category)
    )
      context.addIssue({
        code: "custom",
        message: "Only Fuel and DEF products can be tank- or meter-linked.",
      });
  });
export const categoryInputSchema = z.object({
  name: z.string().trim().min(2),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]+$/),
});
export const taxCategoryInputSchema = z.object({
  name: z.string().trim().min(2),
  rate: z.coerce.number().min(0).max(100),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const densityReadingInputSchema = z.object({
  stationId: z.string().cuid(),
  tankId: z.string().cuid(),
  density: z.coerce
    .number()
    .min(600, "Enter a realistic density.")
    .max(1200, "Enter a realistic density."),
});
export type DensityReadingInput = z.infer<typeof densityReadingInputSchema>;

const reading = z.object({
  id: z.string().cuid(),
  value: z.coerce.number().min(0),
});
export const openShiftSchema = z.object({
  stationId: z.string().cuid(),
  managerId: z.string().cuid(),
  userIds: z.array(z.string().cuid()).min(1),
  nozzleAssignments: z.array(
    z.object({ nozzleId: z.string().cuid(), userId: z.string().cuid() }),
  ),
  openingCash: z.coerce.number().min(0),
  tankReadings: z.array(reading),
  nozzleReadings: z.array(reading),
  notes: z.string().max(500).optional(),
});
export const closeShiftSchema = z.object({
  closingCash: z.coerce.number().min(0),
  tankReadings: z.array(reading),
  nozzleReadings: z.array(reading),
  nozzleCollections: z.array(
    z.object({ nozzleId: z.string().cuid(), amount: z.coerce.number().min(0) }),
  ),
  notes: z.string().max(500).optional(),
});
export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;

export const paymentMethods = [
  "CASH",
  "UPI",
  "CARD",
  "CREDIT",
  "FLEET",
  "OTHER",
] as const;
export const saleInputSchema = z
  .object({
    stationId: z.string().cuid(),
    shiftId: z.string().cuid(),
    productId: z.string().cuid(),
    employeeId: z.string().cuid(),
    paymentMethod: z.enum(paymentMethods),
    unitPrice: z.coerce.number().min(0),
    quantity: z.coerce.number().positive().optional(),
    tankId: z.string().cuid().nullable().optional(),
    nozzleId: z.string().cuid().nullable().optional(),
    meterOpening: z.coerce.number().min(0).nullable().optional(),
    meterClosing: z.coerce.number().min(0).nullable().optional(),
    customerId: z.string().cuid().nullable().optional(),
    vehicleId: z.string().cuid().nullable().optional(),
    customerName: z.string().trim().min(2).max(120).nullable().optional(),
    vehicleNumber: z.string().trim().min(2).max(32).nullable().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((sale, context) => {
    const metered =
      (sale.meterOpening !== null && sale.meterOpening !== undefined) ||
      (sale.meterClosing !== null && sale.meterClosing !== undefined);
    if (["CREDIT", "FLEET"].includes(sale.paymentMethod) && !sale.customerId)
      context.addIssue({
        code: "custom",
        message: "Choose a customer account for credit and fleet sales.",
        path: ["customerId"],
      });
    if (
      metered &&
      (!sale.tankId ||
        !sale.nozzleId ||
        sale.meterOpening === null ||
        sale.meterOpening === undefined ||
        sale.meterClosing === null ||
        sale.meterClosing === undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Meter sales need a tank, nozzle, opening meter, and closing meter.",
        path: ["meterClosing"],
      });
    if (metered && sale.meterClosing! <= sale.meterOpening!)
      context.addIssue({
        code: "custom",
        message: "The closing meter must be greater than the opening meter.",
        path: ["meterClosing"],
      });
    if (!metered && !sale.quantity)
      context.addIssue({
        code: "custom",
        message: "Enter a quantity for this sale.",
        path: ["quantity"],
      });
  });
export type SaleInput = z.infer<typeof saleInputSchema>;

const inventoryLineSchema = z.object({
  productId: z.string().cuid(),
  tankId: z.string().cuid().nullable().optional(),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
});
export const receiptInputSchema = z.object({
  stationId: z.string().cuid(),
  supplierName: z.string().trim().min(2).max(120),
  referenceNo: z.string().trim().max(80).optional(),
  receivedAt: z.string().datetime().optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(inventoryLineSchema).min(1),
});
export const inventoryAdjustmentSchema = z.object({
  stationId: z.string().cuid(),
  productId: z.string().cuid(),
  tankId: z.string().cuid().nullable().optional(),
  quantityDelta: z.coerce
    .number()
    .refine((value) => value !== 0, "Adjustment cannot be zero."),
  notes: z.string().trim().min(3).max(500),
});
export const tankReadingInputSchema = z.object({
  stationId: z.string().cuid(),
  tankId: z.string().cuid(),
  physicalStock: z.coerce.number().min(0),
  dipReading: z.coerce.number().min(0).nullable().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;
export type InventoryAdjustmentInput = z.infer<
  typeof inventoryAdjustmentSchema
>;
export type TankReadingInput = z.infer<typeof tankReadingInputSchema>;

export const reconciliationInputSchema = z
  .object({
    collections: z
      .array(
        z.object({
          paymentMethod: z.enum(paymentMethods),
          actualAmount: z.coerce.number().min(0),
          adjustmentAmount: z.coerce.number(),
          adjustmentReason: z.string().trim().max(300).nullable().optional(),
        }),
      )
      .length(paymentMethods.length),
    creditAllocations: z
      .array(
        z.object({
          paymentMethod: z.enum(paymentMethods),
          customerId: z.string().cuid(),
          vehicleId: z.string().cuid().nullable().optional(),
          amount: z.coerce.number().positive(),
        }),
      )
      .default([]),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((input, context) => {
    const methods = input.collections.map(
      (collection) => collection.paymentMethod,
    );
    if (
      new Set(methods).size !== paymentMethods.length ||
      paymentMethods.some((method) => !methods.includes(method))
    )
      context.addIssue({
        code: "custom",
        message: "Provide one collection row for every payment method.",
        path: ["collections"],
      });
    if (
      Math.abs(
        input.collections.reduce(
          (sum, collection) => sum + collection.adjustmentAmount,
          0,
        ),
      ) > 0.01
    )
      context.addIssue({
        code: "custom",
        message: "Allocate the complete shift sales total before locking.",
        path: ["collections"],
      });
  });
export type ReconciliationInput = z.infer<typeof reconciliationInputSchema>;

export const customerTypes = ["CREDIT", "FLEET"] as const;
export const customerInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]+$/),
  type: z.enum(customerTypes),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  taxId: z.string().trim().max(30).optional(),
  billingAddress: z.string().trim().max(300).optional(),
  creditLimit: z.coerce.number().min(0),
  creditDays: z.coerce.number().int().min(0).max(365),
  active: z.boolean(),
});
export const vehicleInputSchema = z.object({
  number: z.string().trim().toUpperCase().min(2).max(32),
  label: z.string().trim().max(80).optional(),
  active: z.boolean(),
});
export const customerReceiptInputSchema = z.object({
  stationId: z.string().cuid(),
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "OTHER"]),
  referenceNo: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(300).optional(),
  receivedAt: z.string().datetime().optional(),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;
export type VehicleInput = z.infer<typeof vehicleInputSchema>;
export type CustomerReceiptInput = z.infer<typeof customerReceiptInputSchema>;

const attachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.string().trim().min(1).max(100),
  size: z.coerce.number().int().positive().max(500_000),
  contentBase64: z.string().min(1).max(700_000),
});
const settlementMethods = ["CASH", "UPI", "CARD", "OTHER"] as const;
export const supplierInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]+$/),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  taxId: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  paymentTerms: z.coerce.number().int().min(0).max(365),
  active: z.boolean(),
});
export const purchaseInvoiceInputSchema = z
  .object({
    stationId: z.string().cuid(),
    supplierId: z.string().cuid(),
    invoiceNumber: z.string().trim().min(1).max(80),
    invoiceDate: z.string().datetime(),
    dueDate: z.string().datetime(),
    invoiceTotal: z.coerce.number().positive().optional(),
    taxAmount: z.coerce.number().min(0).default(0),
    notes: z.string().trim().max(500).optional(),
    receiveNow: z.boolean(),
    paidNow: z.boolean().optional().default(false),
    paymentMethod: z.enum(settlementMethods).optional(),
    paymentReferenceNo: z.string().trim().max(80).optional(),
    attachment: attachmentSchema.nullable().optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().cuid().nullable().optional(),
          tankId: z.string().cuid().nullable().optional(),
          description: z.string().trim().min(2).max(160),
          quantity: z.coerce.number().positive(),
          unitCost: z.coerce.number().min(0),
          taxRate: z.coerce.number().min(0).max(100).default(0),
          hsnCode: z.string().trim().max(20).optional(),
        }),
      )
      .min(1),
  })
  .superRefine((invoice, context) => {
    if (new Date(invoice.dueDate) < new Date(invoice.invoiceDate))
      context.addIssue({
        code: "custom",
        message: "Due date cannot be before the invoice date.",
        path: ["dueDate"],
      });
    if (invoice.receiveNow)
      for (const [index, line] of invoice.lines.entries())
        if (!line.productId)
          context.addIssue({
            code: "custom",
            message: "Every received line needs an inventory product.",
            path: ["lines", index, "productId"],
          });
    if (invoice.paidNow && !invoice.paymentMethod)
      context.addIssue({
        code: "custom",
        message: "Choose how this invoice was paid.",
        path: ["paymentMethod"],
      });
  });
export const purchaseInvoiceUpdateSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(80),
    invoiceDate: z.string().datetime(),
    dueDate: z.string().datetime(),
    notes: z.string().trim().max(500).optional(),
    refreshPrices: z.boolean().optional().default(false),
    markPaid: z.boolean().optional().default(false),
    paymentMethod: z.enum(settlementMethods).optional(),
    paymentReferenceNo: z.string().trim().max(80).optional(),
    correctionReason: z.string().trim().min(5).max(300).optional(),
    lines: z
      .array(
        z.object({
          id: z.string().cuid(),
          quantity: z.coerce.number().positive(),
        }),
      )
      .min(1)
      .optional(),
  })
  .superRefine((invoice, context) => {
    if (new Date(invoice.dueDate) < new Date(invoice.invoiceDate))
      context.addIssue({
        code: "custom",
        message: "Due date cannot be before the invoice date.",
        path: ["dueDate"],
      });
    if (invoice.markPaid && !invoice.paymentMethod)
      context.addIssue({
        code: "custom",
        message: "Choose how this invoice was paid.",
        path: ["paymentMethod"],
      });
    if (invoice.lines && !invoice.correctionReason)
      context.addIssue({
        code: "custom",
        message: "Explain why the invoice quantity is being corrected.",
        path: ["correctionReason"],
      });
  });
export const supplierPaymentInputSchema = z.object({
  stationId: z.string().cuid(),
  invoiceId: z.string().cuid(),
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "OTHER"]),
  referenceNo: z.string().trim().max(80).optional(),
});
export const expenseCategoryInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]+$/),
});
export const expenseInputSchema = z.object({
  stationId: z.string().cuid(),
  categoryId: z.string().cuid(),
  description: z.string().trim().min(3).max(160),
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(settlementMethods),
  incurredAt: z.string().datetime(),
  referenceNo: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  attachment: attachmentSchema.nullable().optional(),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;
export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceInputSchema>;
export type PurchaseInvoiceUpdateInput = z.infer<
  typeof purchaseInvoiceUpdateSchema
>;
export type SupplierPaymentInput = z.infer<typeof supplierPaymentInputSchema>;
export type ExpenseCategoryInput = z.infer<typeof expenseCategoryInputSchema>;
export type ExpenseInput = z.infer<typeof expenseInputSchema>;
