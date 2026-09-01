import type { StationSetup } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const stationInclude = { configurations: { where: { active: true }, orderBy: { version: 'desc' as const }, take: 1, include: { tanks: { include: { product: true } }, dispensers: { include: { nozzles: { include: { product: true, tankMappings: { include: { tank: true } } } } } } } } };
export async function listStations(organizationId: string,stationIds?:string[]) { return prisma.station.findMany({ where: { organizationId,...(stationIds?{id:{in:stationIds}}:{}) }, orderBy: { createdAt: 'desc' }, include: stationInclude }); }
export async function createStation(organizationId: string, setup: StationSetup) {
  const pending = await prisma.station.findFirst({ where: { organizationId, configurations: { none: {} } }, orderBy: { createdAt: 'asc' } });
  const exists = await prisma.station.findUnique({ where: { organizationId_code: { organizationId, code: setup.profile.code } } });
  if (exists && exists.id !== pending?.id) throw new AppError(409, 'STATION_CODE_EXISTS', 'A petrol pump already uses this code.');
  const productCodes = setup.products.map(product => product.code);
  const existingProducts = await prisma.product.findMany({ where: { organizationId, code: { in: productCodes } } });
  if (existingProducts.length) throw new AppError(409, 'PRODUCT_CODE_EXISTS', `Product code ${existingProducts[0]?.code} already exists in your organization.`);
  return prisma.$transaction(async tx => {
    const { phone, gstin, openingTime, closingTime, ...profile } = setup.profile;
    const stationData = { ...profile, phone: phone || null, gstin: gstin || null, openingTime: openingTime || null, closingTime: closingTime || null };
    const station = pending
      ? await tx.station.update({ where: { id: pending.id }, data: stationData })
      : await tx.station.create({ data: { organizationId, ...stationData } });
    const productRecords = await Promise.all(setup.products.map(product => tx.product.create({ data: { organizationId, ...product } })));
    const products = new Map(productRecords.map(product => [product.code, product.id]));
    const configuration = await tx.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const tankRecords = await Promise.all(setup.tanks.map(tank => tx.tank.create({ data: { configurationId: configuration.id, productId: products.get(tank.productCode)!, code: tank.code, nominalCapacity: new Prisma.Decimal(tank.nominalCapacity), workingCapacity: new Prisma.Decimal(tank.workingCapacity), openingStock: new Prisma.Decimal(tank.openingStock), tankType: tank.tankType, dipMethod: tank.dipMethod, status: tank.status } })));
    const tanks = new Map(tankRecords.map(tank => [tank.code, tank.id]));
    for (const dispenser of setup.dispensers) { const dispenserRecord = await tx.dispenser.create({ data: { configurationId: configuration.id, code: dispenser.code, location: dispenser.location || null, status: dispenser.status } }); for (const nozzle of dispenser.nozzles) await tx.nozzle.create({ data: { dispenserId: dispenserRecord.id, productId: products.get(nozzle.productCode)!, code: nozzle.code, openingMeter: new Prisma.Decimal(nozzle.openingMeter), status: nozzle.status, tankMappings: { create: nozzle.tankCodes.map(tankCode => ({ tankId: tanks.get(tankCode)! })) } } }); }
    return tx.station.findUniqueOrThrow({ where: { id: station.id }, include: stationInclude });
  });
}
