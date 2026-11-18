import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { bootstrap as salesBootstrap, createSale } from '../src/modules/sales/service.js';
import { bootstrap as shiftBootstrap, closeShift, openShift } from '../src/modules/shifts/service.js';
import { readDailyOperatingFacts } from '../src/modules/notifications/message-facts.js';
import { safeSaveContext } from '../src/lib/safe-save.js';
import { indiaDate } from '../src/lib/india-time.js';
import { createProduct, updateProduct } from '../src/modules/products/service.js';
import { receive } from '../src/modules/inventory/service.js';
import { randomUUID } from 'node:crypto';

// Run only when explicitly pointed at a separate verification database.
const url = process.env.COUNTER_SALES_TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;

suite('counter sales against isolated PostgreSQL', () => {
  afterAll(() => prisma.$disconnect());
  it('records independent counter collections, protects fuel assignments and closes without duplicate DEF', async () => {
    const org = await prisma.organization.create({ data: { name: 'Counter verification' } });
    const foreign = await prisma.organization.create({ data: { name: 'Another organization' } });
    const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Verification fuel station', code: 'S1', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const foreignStation = await prisma.station.create({ data: { organizationId: foreign.id, name: 'Another fuel station', code: 'S2', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Shift owner', email: `${org.id}-owner@test.local`, passwordHash: 'unused', role: 'OWNER' } });
    const seller = await prisma.user.create({ data: { organizationId: org.id, name: 'Counter employee', email: `${org.id}-seller@test.local`, passwordHash: 'unused', role: 'STAFF' } });
    const other = await prisma.user.create({ data: { organizationId: foreign.id, name: 'Foreign employee', email: `${foreign.id}-seller@test.local`, passwordHash: 'unused', role: 'STAFF' } });
    const ms = await prisma.product.create({ data: { organizationId: org.id, name: 'MS', code: 'MS', category: 'FUEL', unit: 'LITRE', tankLinked: true, meterLinked: true, purchasePrice: 90, sellingPrice: 100 } });
    const def = await prisma.product.create({ data: { organizationId: org.id, name: 'DEF bulk', code: 'DEF', category: 'DEF', unit: 'LITRE', tankLinked: true, meterLinked: true, purchasePrice: 40, sellingPrice: 50 } });
    const oil = await prisma.product.create({ data: { organizationId: org.id, name: 'Engine oil', code: 'OIL', category: 'LUBRICANTS', unit: 'PIECE', purchasePrice: 300, sellingPrice: 450 } });
    const tankData = { configurationId: config.id, nominalCapacity: 2000, workingCapacity: 1900, openingStock: 1000, tankType: 'UNDERGROUND' as const, dipMethod: 'MANUAL' as const };
    const msTank = await prisma.tank.create({ data: { ...tankData, productId: ms.id, code: 'MS1' } });
    const defTank = await prisma.tank.create({ data: { ...tankData, productId: def.id, code: 'DEF1' } });
    const dispenser = await prisma.dispenser.create({ data: { configurationId: config.id, code: 'D1' } });
    const nozzle = await prisma.nozzle.create({ data: { dispenserId: dispenser.id, productId: ms.id, code: 'MS1', openingMeter: 100 } });
    await prisma.nozzleTank.create({ data: { nozzleId: nozzle.id, tankId: msTank.id } });
    await prisma.nozzle.create({ data: { dispenserId: dispenser.id, productId: def.id, code: 'DEF1', openingMeter: 100 } });
    await prisma.inventoryLedger.create({ data: { organizationId: org.id, stationId: station.id, productId: oil.id, type: 'ADJUSTMENT', quantityDelta: 10, unitCost: 300, createdById: owner.id } });
    const counter = { stationId: station.id, productId: oil.id, employeeId: seller.id, paymentMethod: 'UPI' as const, unitPrice: 450, quantity: 2 };
    const before = new Date();
    const key = randomUUID();
    function saveCounter() {
      return new Promise<any>((resolve, reject) => {
        safeSaveContext({ method: 'POST', originalUrl: '/sales', body: counter, user: { id: owner.id, organization: { id: org.id } }, get: () => key } as any, {} as any, error => {
          if (error) reject(error);
          else createSale(org.id, counter).then(resolve, reject);
        });
      });
    }
    const oilSale = await saveCounter();
    expect(oilSale.shiftId).toBeNull();
    expect(oilSale.employeeId).toBe(seller.id);
    expect(new Date(oilSale.occurredAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(Number(oilSale.totalAmount)).toBe(900);
    expect((await saveCounter()).id).toBe(oilSale.id);
    expect(await prisma.sale.count({ where: { productId: oil.id } })).toBe(1);
    const oilMovement = await prisma.inventoryLedger.findUniqueOrThrow({ where: { saleId: oilSale.id } });
    expect(Number(oilMovement.quantityDelta)).toBe(-2);
    const journal = await prisma.journal.findFirstOrThrow({ where: { organizationId: org.id, sourceType: 'SALE', sourceId: oilSale.id }, include: { lines: true } });
    expect(journal.lines.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)).toBe(0);

    const fuel = { stationId: station.id, productId: ms.id, employeeId: seller.id, paymentMethod: 'CASH' as const, unitPrice: 100, tankId: msTank.id, nozzleId: nozzle.id, meterOpening: 100, meterClosing: 110 };
    await expect(createSale(org.id, fuel)).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN' });
    await expect(createSale(org.id, { ...counter, stationId: foreignStation.id })).rejects.toMatchObject({ code: 'STATION_NOT_FOUND' });
    await expect(createSale(org.id, { ...counter, employeeId: other.id })).rejects.toMatchObject({ code: 'EMPLOYEE_INVALID' });
    const shift = await openShift(org.id, { stationId: station.id, managerId: owner.id, openingCash: 0, userIds: [owner.id], tankReadings: [{ id: msTank.id, value: 1000 }, { id: defTank.id, value: 1000 }], nozzleReadings: [{ id: nozzle.id, value: 100 }], nozzleAssignments: [{ nozzleId: nozzle.id, userId: owner.id }] });
    await expect(createSale(org.id, { ...fuel, shiftId: shift.id })).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_ON_SHIFT' });
    const fuelSale = await createSale(org.id, { ...fuel, employeeId: owner.id, shiftId: shift.id });
    expect(fuelSale.shiftId).toBe(shift.id);
    const defInput = { ...counter, productId: def.id, unitPrice: 50, quantity: 20, shiftId: shift.id };
    await expect(createSale(org.id, defInput)).rejects.toMatchObject({ code: 'TANK_REQUIRED' });
    await expect(createSale(org.id, { ...defInput, tankId: msTank.id })).rejects.toMatchObject({ code: 'TANK_REQUIRED' });
    const defSale = await createSale(org.id, { ...defInput, tankId: defTank.id });
    expect(defSale.shiftId).toBeNull();
    expect(defSale.kind).toBe('PRODUCT');
    const shiftView = await shiftBootstrap(org.id);
    expect(shiftView.stations[0]!.configurations[0]!.dispensers[0]!.nozzles.map(row => row.id)).toEqual([nozzle.id]);
    const defReading = shiftView.shifts[0]!.tankReadings.find(row => row.tankId === defTank.id)!;
    expect(Number(defReading.stockBridge?.counterSales)).toBe(20);
    expect(defReading.stockBridge?.nozzles).toEqual([]);
    await closeShift(org.id, shift.id, { closingCash: 1000, tankReadings: [{ id: msTank.id, value: 990 }, { id: defTank.id, value: 980 }], nozzleReadings: [{ id: nozzle.id, value: 110, testingQuantity: 0, testingReturned: true }], nozzleCollections: [{ nozzleId: nozzle.id, amount: 1000 }] });
    expect(await prisma.sale.count({ where: { productId: def.id } })).toBe(1);
    expect(await prisma.inventoryLedger.count({ where: { saleId: defSale.id } })).toBe(1);
    expect(await prisma.sale.count({ where: { shiftId: shift.id } })).toBe(1);
    const facts = await readDailyOperatingFacts({ organizationId: org.id, stationId: station.id }, indiaDate(new Date()));
    expect(Number(facts.collections.actual)).toBe(1900); // Counter UPI 900 + DEF 1000.
    const bootstrap = await salesBootstrap(org.id, [station.id]);
    expect(bootstrap.stations.map(row => row.id)).toEqual([station.id]);
    expect(bootstrap.tanks.every(row => row.stationId === station.id)).toBe(true);
    expect(bootstrap.employees.map(row => row.id)).toContain(seller.id);
    expect(bootstrap.employees.map(row => row.id)).not.toContain(other.id);
    const afterClosing = await createSale(org.id, { ...counter, quantity: 1, shiftId: shift.id });
    expect(afterClosing.shiftId).toBeNull();
    expect(afterClosing.employeeId).toBe(seller.id);
    const packs = [];
    for (const size of [6, 10, 20]) {
      const details = { name: `DEF ${size} L pack`, code: `DEF-${size}L`, category: 'DEF' as const, unit: 'PIECE' as const, packSizeLitres: size, purchasePrice: size * 30, sellingPrice: size * 40, inventoryTracked: true, tankLinked: false, meterLinked: false, isService: false, active: true };
      const product = await createProduct(org.id, details);
      packs.push({ product, details });
    }
    await receive(org.id, owner.id, { stationId: station.id, supplierName: 'DEF supplier', lines: packs.map(({ product }) => ({ productId: product.id, quantity: 10, unitCost: Number(product.purchasePrice) })) });
    const tenLitre = packs[1]!;
    const packagedSale = { ...counter, productId: tenLitre.product.id, unitPrice: 400, quantity: 2 };
    await expect(createSale(org.id, { ...packagedSale, quantity: 1.5 })).rejects.toMatchObject({ code: 'PACK_QUANTITY_INVALID' });
    const soldPacks = await createSale(org.id, packagedSale);
    expect(soldPacks.shiftId).toBeNull();
    expect(soldPacks.tankId).toBeNull();
    expect(Number(soldPacks.quantity)).toBe(2);
    expect(Number(soldPacks.totalAmount)).toBe(800);
    expect(Number(soldPacks.product.packSizeLitres)).toBe(10);
    for (const [index, { product }] of packs.entries()) {
      const stock = await prisma.inventoryLedger.aggregate({ where: { stationId: station.id, productId: product.id }, _sum: { quantityDelta: true } });
      expect(Number(stock._sum.quantityDelta)).toBe(index === 1 ? 8 : 10);
    }
    await expect(updateProduct(org.id, tenLitre.product.id, { ...tenLitre.details, packSizeLitres: 20 })).rejects.toMatchObject({ code: 'DEF_FORMAT_IN_USE' });
    await expect(updateProduct(org.id, tenLitre.product.id, { ...tenLitre.details, unit: 'LITRE', packSizeLitres: null, tankLinked: true })).rejects.toMatchObject({ code: 'DEF_FORMAT_IN_USE' });
    const bulkFraction = await createSale(org.id, { ...counter, productId: def.id, tankId: defTank.id, quantity: 3.5, unitPrice: 50 });
    expect(Number(bulkFraction.quantity)).toBe(3.5);
    expect(Number(bulkFraction.totalAmount)).toBe(175);
    expect(bulkFraction.tankId).toBe(defTank.id);
    await prisma.user.update({ where: { id: seller.id }, data: { active: false } });
    await expect(createSale(org.id, counter)).rejects.toMatchObject({ code: 'EMPLOYEE_INVALID' });
  });
});
