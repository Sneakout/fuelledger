import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { readYesterdayPerformance } from '../src/modules/dashboard/yesterday-performance.js';
const url = process.env.SHIFT_DSR_TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;
suite('yesterday dashboard from real scoped records', () => {
 afterAll(() => prisma.$disconnect());
 it('includes an overnight closure, verifies collections separately, updates corrections and isolates stations', async () => {
  const org = await prisma.organization.create({ data: { name: 'Yesterday performance verification' } });
  const other = await prisma.organization.create({ data: { name: 'Other tenant' } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: 'Owner', email: `${org.id}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
  const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Station', code: 'S1', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
  const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
  const fuel = await prisma.product.create({ data: { organizationId: org.id, name: 'Petrol', code: 'MS', category: 'FUEL', unit: 'LITRE', inventoryTracked: true } });
  const shop = await prisma.product.create({ data: { organizationId: org.id, name: 'Shop service', code: 'SHOP', category: 'SERVICES', unit: 'PIECE', inventoryTracked: false } });
  const shift = (shiftNumber:number,openedAt:string,closedAt:string|null) => prisma.shift.create({ data: { stationId: station.id, configurationId: config.id, managerId: user.id, shiftNumber, openingCash: 0, status: closedAt ? 'RECONCILIATION_REQUIRED' : 'OPEN', openedAt: new Date(openedAt), closedAt: closedAt ? new Date(closedAt) : null } });
  const am = await shift(1,'2026-11-25T00:30:00Z','2026-11-25T12:30:00Z');
  const pm = await shift(2,'2026-11-25T12:30:00Z','2026-11-26T00:30:00Z');
  const today = await shift(3,'2026-11-26T00:30:00Z',null);
  for (const row of [am,pm,today]) {
   const sale = await prisma.sale.create({ data: { organizationId: org.id, stationId: station.id, shiftId: row.id, productId: fuel.id, employeeId: user.id, kind: 'METERED', paymentMethod: 'OTHER', quantity: 100, unitPrice: 100, totalAmount: 10000, occurredAt: row.closedAt ?? new Date('2026-11-26T06:00:00Z') } });
   await prisma.inventoryLedger.create({ data: { organizationId: org.id, stationId: station.id, productId: fuel.id, saleId: sale.id, type: 'SALE', quantityDelta: -100, unitCost: 90, occurredAt: sale.occurredAt } });
  }
  await prisma.sale.create({ data: { organizationId: org.id, stationId: station.id, productId: shop.id, employeeId: user.id, kind: 'SERVICE', paymentMethod: 'CARD', quantity: 1, unitPrice: 100, totalAmount: 100, occurredAt: new Date('2026-11-26T00:00:00Z') } });
  const category = await prisma.expenseCategory.create({ data: { organizationId: org.id, name: 'Operations', code: 'OPS' } });
  const expense = await prisma.expense.create({ data: { organizationId: org.id, stationId: station.id, categoryId: category.id, description: 'Night expense', amount: 200, paymentMethod: 'CASH', incurredAt: new Date('2026-11-26T00:10:00Z'), createdById: user.id } });
  const reconcile = (id:string,paymentMethod:'CASH'|'UPI') => prisma.shiftReconciliation.create({ data: { shiftId: id, reconciledById: user.id, collections: { create: { paymentMethod, expectedAmount: 10000, actualAmount: 10000, varianceAmount: 0 } } } });
  await reconcile(am.id,'CASH');
  const now = new Date('2026-11-26T10:00:00Z');
  const pending = await readYesterdayPerformance(org.id,[station.id],now);
  expect(pending).toMatchObject({ date:'2026-11-25',sales:20100,meteredVolume:200,collected:null,verifiedCollected:10100,pendingReconciliations:1,closedShifts:2,netProfit:1900 });
  expect(pending.periods[0]).toMatchObject({start:'2026-11-25T00:30:00.000Z',end:'2026-11-26T00:30:00.000Z'});
  await reconcile(pm.id,'UPI');
  expect((await readYesterdayPerformance(org.id,[station.id],now)).collected).toBe(20100);
  await prisma.expense.update({ where: { id: expense.id }, data: { amount: 300 } });
  expect((await readYesterdayPerformance(org.id,[station.id],now)).netProfit).toBe(1800);
  const hsd = await prisma.product.create({ data: { organizationId: org.id, name: 'Diesel', code: 'HSD', category: 'FUEL', unit: 'LITRE', sellingPrice: 150 } });
  await prisma.historicalSalesImport.create({ data: { organizationId: org.id, stationId: station.id, productId: hsd.id, monthStart: new Date('2026-11-01'), sourceFileName: 'HSD.pdf', sourceMimeType: 'application/pdf', sourceSize: 0, sourceContent: Buffer.from(''), sourceFingerprint: org.id, importedById: user.id,
   rows: [{date:'2026-11-25',sellingPrice:0,receiptQuantity:0,testingQuantity:0,tankReadings:[],nozzleReadings:[{nozzleId:'nozzle',meterReading:1000}]},{date:'2026-11-26',sellingPrice:0,receiptQuantity:0,testingQuantity:0,tankReadings:[],nozzleReadings:[{nozzleId:'nozzle',meterReading:1010}]}] } });
  expect(await readYesterdayPerformance(org.id,[station.id],now)).toMatchObject({sales:null,meteredVolume:210,netProfit:null});
  expect(await readYesterdayPerformance(other.id,[station.id],now)).toMatchObject({status:'NO_DATA',sales:null,collected:null,netProfit:null,closedShifts:0});
 },30000);
});
