import { restorePersistedEquipmentConnections, stationEquipmentSchema, type StationEquipmentShapeInput, type StationProfileInput, type StationSetup } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const stationInclude = { configurations: { where: { active: true }, orderBy: { version: 'desc' as const }, take: 1, include: { tanks: { include: { product: true } }, dispensers: { include: { nozzles: { include: { product: true, tankMappings: { include: { tank: true } } } } } } } } };
export async function listStations(organizationId: string,stationIds?:string[]) { return prisma.station.findMany({ where: { organizationId,...(stationIds?{id:{in:stationIds}}:{}) }, orderBy: { createdAt: 'desc' }, include: stationInclude }); }
export async function createStation(organizationId: string, setup: StationSetup) {
  const pending = await prisma.station.findFirst({ where: { organizationId, configurations: { none: {} } }, orderBy: { createdAt: 'asc' } });
  const exists = await prisma.station.findUnique({ where: { organizationId_code: { organizationId, code: setup.profile.code } } });
  if (exists && exists.id !== pending?.id) throw new AppError(409, 'STATION_CODE_EXISTS', 'A petrol pump already uses this code.');
  return prisma.$transaction(async tx => {
    const { phone, gstin, openingTime, closingTime, ...profile } = setup.profile;
    const stationData = { ...profile, phone: phone || null, gstin: gstin || null, openingTime: openingTime || null, closingTime: closingTime || null };
    const station = pending
      ? await tx.station.update({ where: { id: pending.id }, data: stationData })
      : await tx.station.create({ data: { organizationId, ...stationData } });
    const productRecords = await Promise.all(setup.products.map(async product => {
      const existingProduct = await tx.product.findUnique({ where: { organizationId_code: { organizationId, code: product.code } } });
      if (!existingProduct) return tx.product.create({ data: { organizationId, ...product } });
      const sameKind = existingProduct.category === product.category && existingProduct.unit === product.unit && existingProduct.isService === product.isService;
      const usage = await tx.product.findUniqueOrThrow({ where: { id: existingProduct.id }, select: { _count: { select: { tanks: true, nozzles: true, sales: true, inventoryLedger: true, receiptLines: true, purchaseInvoiceLines: true } } } });
      const isInUse = Object.values(usage._count).some(count => count > 0);
      if (!sameKind && isInUse) throw new AppError(409, 'PRODUCT_CONFIGURATION_CONFLICT', `${product.code} already has operational records as a different product type. Use a different product code for this petrol pump.`);
      // Starter catalog items such as MS and HSD are safely converted on their first pump setup.
      return tx.product.update({ where: { id: existingProduct.id }, data: {
        ...(sameKind ? {} : { category: product.category, unit: product.unit, isService: product.isService, customCategoryId: null }),
        inventoryTracked: existingProduct.inventoryTracked || product.inventoryTracked,
        tankLinked: existingProduct.tankLinked || product.tankLinked,
        meterLinked: existingProduct.meterLinked || product.meterLinked,
        active: existingProduct.active || product.active,
      } });
    }));
    const products = new Map(productRecords.map(product => [product.code, product.id]));
    const configuration = await tx.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const tankRecords = await Promise.all(setup.tanks.map(tank => tx.tank.create({ data: { configurationId: configuration.id, productId: products.get(tank.productCode)!, code: tank.code, nominalCapacity: new Prisma.Decimal(tank.nominalCapacity), workingCapacity: new Prisma.Decimal(tank.workingCapacity), openingStock: new Prisma.Decimal(tank.openingStock), tankType: tank.tankType, dipMethod: tank.dipMethod, status: tank.status } })));
    const tanks = new Map(tankRecords.map(tank => [tank.code, tank.id]));
    for (const dispenser of setup.dispensers) { const dispenserRecord = await tx.dispenser.create({ data: { configurationId: configuration.id, code: dispenser.code, location: dispenser.location || null, status: dispenser.status } }); for (const nozzle of dispenser.nozzles) await tx.nozzle.create({ data: { dispenserId: dispenserRecord.id, productId: products.get(nozzle.productCode)!, code: nozzle.code, openingMeter: new Prisma.Decimal(nozzle.openingMeter), status: nozzle.status, tankMappings: { create: nozzle.tankCodes.map(tankCode => ({ tankId: tanks.get(tankCode)! })) } } }); }
    return tx.station.findUniqueOrThrow({ where: { id: station.id }, include: stationInclude });
  });
}

export async function getStationSetupDraft(organizationId: string, stationId: string) {
  const station = await prisma.station.findFirst({ where: { id: stationId, organizationId, active: true, configurations: { none: {} } } });
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'This unpublished petrol pump could not be found.');
  return prisma.stationSetupDraft.findUnique({ where: { stationId }, select: { setup: true, updatedAt: true } });
}

export async function saveStationSetupDraft(organizationId: string, stationId: string, setup: Record<string, unknown>) {
  const station = await prisma.station.findFirst({ where: { id: stationId, organizationId, active: true, configurations: { none: {} } } });
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'This unpublished petrol pump could not be found.');
  return prisma.stationSetupDraft.upsert({
    where: { stationId },
    create: { organizationId, stationId, setup: setup as Prisma.InputJsonValue },
    update: { setup: setup as Prisma.InputJsonValue },
    select: { setup: true, updatedAt: true },
  });
}

export async function updateStationProfile(organizationId: string, stationId: string, profile: StationProfileInput) {
  const station = await prisma.station.findFirst({ where: { id: stationId, organizationId } });
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'This petrol pump could not be found.');
  const codeOwner = await prisma.station.findUnique({ where: { organizationId_code: { organizationId, code: profile.code } } });
  if (codeOwner && codeOwner.id !== stationId) throw new AppError(409, 'STATION_CODE_EXISTS', 'A petrol pump already uses this code.');
  const { phone, gstin, openingTime, closingTime, ...required } = profile;
  return prisma.station.update({
    where: { id: stationId },
    data: {
      ...required,
      phone: phone || null,
      gstin: gstin || null,
      openingTime: openingTime || null,
      closingTime: closingTime || null,
    },
    include: stationInclude,
  });
}

export async function getStationEquipment(organizationId: string, stationId: string) {
  const station = await prisma.station.findFirst({ where: { id: stationId, organizationId, active: true }, include: stationInclude });
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'This petrol pump could not be found.');
  const configuration = station.configurations[0];
  if (!configuration) throw new AppError(409, 'STATION_NOT_CONFIGURED', 'Set up this petrol pump before editing its equipment.');
  const products = await prisma.product.findMany({ where: { organizationId, active: true, OR: [{ tankLinked: true }, { meterLinked: true }] }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, tankLinked: true, meterLinked: true } });
  return { configuration, products };
}

export async function updateStationEquipment(organizationId: string, stationId: string, submittedInput: StationEquipmentShapeInput) {
  const configuration = await prisma.stationConfiguration.findFirst({
    where: { id: submittedInput.configurationId, stationId, active: true, station: { organizationId, active: true } },
    include: {
      station: { select: { id: true } },
      tanks: { include: { _count: { select: { shiftReadings: true, sales: true, inventoryLedger: true, receiptLines: true, physicalReadings: true, densityReadings: true } } } },
      dispensers: { include: { nozzles: { include: { tankMappings: { select: { tankId: true } }, _count: { select: { shiftReadings: true, shiftAssignments: true, sales: true } } } } } },
    },
  });
  if (!configuration) throw new AppError(404, 'CONFIGURATION_NOT_FOUND', 'The active equipment configuration could not be found. Refresh and try again.');
  if (await prisma.shift.findFirst({ where: { stationId, status: 'OPEN' }, select: { id: true } })) throw new AppError(409, 'SHIFT_OPEN', 'Close the current shift before changing tanks, DUs, or nozzles.');
  const persistedTankIdsByNozzleId = new Map(configuration.dispensers.flatMap(dispenser => dispenser.nozzles.map(nozzle => [nozzle.id, nozzle.tankMappings.map(mapping => mapping.tankId)] as const)));
  const reconciled = restorePersistedEquipmentConnections(submittedInput, persistedTankIdsByNozzleId);
  const parsed = stationEquipmentSchema.safeParse(reconciled);
  if (!parsed.success) throw new AppError(400, 'EQUIPMENT_INVALID', parsed.error.issues[0]?.message ?? 'Please review the equipment details.', parsed.error.flatten());
  const input = parsed.data;
  const existingTankIds = new Set(configuration.tanks.map(item => item.id));
  const existingDispenserIds = new Set(configuration.dispensers.map(item => item.id));
  const existingNozzleIds = new Set(configuration.dispensers.flatMap(item => item.nozzles.map(nozzle => nozzle.id)));
  if (configuration.tanks.some(item => !input.tanks.some(next => next.id === item.id)) || configuration.dispensers.some(item => !input.dispensers.some(next => next.id === item.id)) || configuration.dispensers.some(item => item.nozzles.some(nozzle => !input.dispensers.some(next => next.nozzles.some(candidate => candidate.id === nozzle.id))))) throw new AppError(400, 'EQUIPMENT_OMITTED', 'Existing equipment must be kept and marked inactive instead of removed.');
  if (input.tanks.some(item => item.id && !existingTankIds.has(item.id)) || input.dispensers.some(item => item.id && !existingDispenserIds.has(item.id)) || input.dispensers.some(item => item.nozzles.some(nozzle => nozzle.id && !existingNozzleIds.has(nozzle.id)))) throw new AppError(400, 'EQUIPMENT_INVALID', 'Some equipment does not belong to this petrol pump. Refresh and try again.');
  const productIds = new Set([...input.tanks.map(item => item.productId), ...input.dispensers.flatMap(item => item.nozzles.map(nozzle => nozzle.productId))]);
  const products = await prisma.product.findMany({ where: { organizationId, active: true, id: { in: [...productIds] } }, select: { id: true, tankLinked: true, meterLinked: true } });
  const productMap = new Map(products.map(item => [item.id, item]));
  if (productMap.size !== productIds.size || input.tanks.some(item => !productMap.get(item.productId)?.tankLinked) || input.dispensers.some(item => item.nozzles.some(nozzle => !productMap.get(nozzle.productId)?.meterLinked))) throw new AppError(400, 'EQUIPMENT_PRODUCT_INVALID', 'Choose active tank-linked and meter-linked products for the equipment.');
  return prisma.$transaction(async tx => {
    // Temporary codes allow two existing pieces of equipment to safely swap labels.
    for (const item of configuration.tanks) await tx.tank.update({ where: { id: item.id }, data: { code: `EDIT-${item.id}` } });
    for (const item of configuration.dispensers) await tx.dispenser.update({ where: { id: item.id }, data: { code: `EDIT-${item.id}` } });
    for (const item of configuration.dispensers.flatMap(row => row.nozzles)) await tx.nozzle.update({ where: { id: item.id }, data: { code: `EDIT-${item.id}` } });
    const tankIds = new Map<string, string>();
    for (const item of input.tanks) {
      const existing = item.id ? configuration.tanks.find(tank => tank.id === item.id) : undefined;
      if (existing) {
        const used = Object.values(existing._count).some(count => count > 0);
        if (used && existing.productId !== item.productId) throw new AppError(409, 'TANK_PRODUCT_LOCKED', `Tank ${existing.code} already has stock or shift history. Make it inactive and add a new tank to use a different product.`);
        if (used && Number(existing.openingStock) !== item.openingStock) throw new AppError(409, 'TANK_OPENING_LOCKED', `Opening stock for tank ${existing.code} is locked because operational records already exist.`);
        const updated = await tx.tank.update({ where: { id: existing.id }, data: { code: item.code, productId: item.productId, nominalCapacity: new Prisma.Decimal(item.nominalCapacity), workingCapacity: new Prisma.Decimal(item.workingCapacity), openingStock: new Prisma.Decimal(item.openingStock), tankType: item.tankType, dipMethod: item.dipMethod, status: item.status } });
        tankIds.set(item.key, updated.id);
      } else {
        const created = await tx.tank.create({ data: { configurationId: configuration.id, code: item.code, productId: item.productId, nominalCapacity: new Prisma.Decimal(item.nominalCapacity), workingCapacity: new Prisma.Decimal(item.workingCapacity), openingStock: new Prisma.Decimal(item.openingStock), tankType: item.tankType, dipMethod: item.dipMethod, status: item.status } });
        tankIds.set(item.key, created.id);
      }
    }
    for (const item of input.dispensers) {
      const dispenser = item.id
        ? await tx.dispenser.update({ where: { id: item.id }, data: { code: item.code, location: item.location || null, status: item.status } })
        : await tx.dispenser.create({ data: { configurationId: configuration.id, code: item.code, location: item.location || null, status: item.status } });
      for (const nozzle of item.nozzles) {
        const existing = nozzle.id ? configuration.dispensers.flatMap(row => row.nozzles).find(row => row.id === nozzle.id) : undefined;
        if (existing) {
          const used = Object.values(existing._count).some(count => count > 0);
          if (used && existing.productId !== nozzle.productId) throw new AppError(409, 'NOZZLE_PRODUCT_LOCKED', `Nozzle ${existing.code} already has meter or sales history. Make it inactive and add a new nozzle to use a different product.`);
          if (used && existing.dispenserId !== dispenser.id) throw new AppError(409, 'NOZZLE_DU_LOCKED', `Nozzle ${existing.code} already has meter or sales history. Keep it on its current DU, or make it inactive and add a new nozzle.`);
          if (used && Number(existing.openingMeter) !== nozzle.openingMeter) throw new AppError(409, 'NOZZLE_OPENING_LOCKED', `Opening meter for nozzle ${existing.code} is locked because operational records already exist.`);
        }
        const saved = existing
          ? await tx.nozzle.update({ where: { id: existing.id }, data: { dispenserId: dispenser.id, code: nozzle.code, productId: nozzle.productId, openingMeter: new Prisma.Decimal(nozzle.openingMeter), status: nozzle.status } })
          : await tx.nozzle.create({ data: { dispenserId: dispenser.id, code: nozzle.code, productId: nozzle.productId, openingMeter: new Prisma.Decimal(nozzle.openingMeter), status: nozzle.status } });
        await tx.nozzleTank.deleteMany({ where: { nozzleId: saved.id } });
        if (nozzle.tankKeys.length) await tx.nozzleTank.createMany({ data: nozzle.tankKeys.map(key => ({ nozzleId: saved.id, tankId: tankIds.get(key)! })) });
      }
    }
    return tx.station.findUniqueOrThrow({ where: { id: stationId }, include: stationInclude });
  });
}
