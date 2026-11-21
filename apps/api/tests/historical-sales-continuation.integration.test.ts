import { Prisma } from '@prisma/client';
import { bookStockAt, tankBookStocksAt, tankOpeningBalances } from '../src/lib/stock.js';
import { buildReport } from '../src/modules/reports/service.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readLatestTankObservations } from '../src/lib/tank-observations.js';
import { bootstrap as inventoryBootstrap } from '../src/modules/inventory/service.js';
import { prisma } from '../src/lib/prisma.js';
import { correctHistoricalImport, createHistoricalImport, historicalImportDetail } from '../src/modules/historical-sales/service.js';
import type { HistoricalSalesRowInput } from '@fuelledger/shared';
vi.mock('../src/lib/prisma.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  return { prisma: new PrismaClient({ datasourceUrl: process.env.HISTORICAL_CONTINUATION_TEST_DATABASE_URL ?? 'postgresql://unused' }) };
});
const suite = process.env.HISTORICAL_CONTINUATION_TEST_DATABASE_URL ? describe : describe.skip;
suite('Continuing partially saved DSRs with isolated records', () => {
  afterAll(() => prisma.$disconnect());
  for (const code of ['MS', 'HSD']) it(`${code}: append, fill gaps, reject stale changes and preserve stock and money`, async () => {
    const org = await prisma.organization.create({ data: { name: `${code} continuation fixture` } });
    const otherOrg = await prisma.organization.create({ data: { name: 'Unrelated fixture' } });
    const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Fixture', code: 'FIXTURE', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Fixture owner', email: `${org.id}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
    const product = await prisma.product.create({ data: { organizationId: org.id, code, name: code, category: 'FUEL', unit: 'LITRE', tankLinked: true, meterLinked: true, sellingPrice: 100 } });
    const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const tank = await prisma.tank.create({ data: { configurationId: config.id, productId: product.id, code: 'T1', nominalCapacity: 10000, workingCapacity: 9500, openingStock: 8000, tankType: 'UNDERGROUND', dipMethod: 'MANUAL' } });
    const dispenser = await prisma.dispenser.create({ data: { configurationId: config.id, code: 'D1' } });
    const nozzle = await prisma.nozzle.create({ data: { dispenserId: dispenser.id, productId: product.id, code: 'N1', openingMeter: 1000 } });
    const row = (day: number): HistoricalSalesRowInput => ({ date: `2026-11-${String(day).padStart(2,'0')}`, tankReadings: [{ tankId: tank.id, openingStock: 8000 - 100 * (day - 1) }], nozzleReadings: [{ nozzleId: nozzle.id, meterReading: 1000 + 100 * (day - 1) }], receiptQuantity: 0, testingQuantity: 0, sellingPrice: 100, salesQuantity: 999 });
    const bytes = Buffer.from(`fixture ${org.id}`);
    const created = await createHistoricalImport(org.id, owner.id, { stationId: station.id, productId: product.id, month: '2026-11', sourceFileName: 'fixture.pdf', sourceMimeType: 'application/pdf', sourceSize: bytes.length, sourceContentBase64: bytes.toString('base64'), sourceFingerprint: createHash('sha256').update(bytes).digest('hex'), rows: [row(1),row(2)], applyCutover: false });
    const original = await historicalImportDetail(org.id, created.record.id);
    const save = (record: typeof original, rows: HistoricalSalesRowInput[], mode: 'APPEND' | 'CORRECT' = 'APPEND') => correctHistoricalImport(org.id, owner.id, record.id, { rows, mode, expectedUpdatedAt: record.updatedAt.toISOString(), reason: mode === 'APPEND' ? 'Added missing morning readings' : 'Corrected meter against signed DSR' });
    await expect(correctHistoricalImport(otherOrg.id, owner.id, original.id, { rows: original.rows, mode:'APPEND', expectedUpdatedAt:original.updatedAt.toISOString(), reason:'Wrong account' })).rejects.toThrow('could not be found');
    await expect(save(original, [row(1), { ...row(2), testingQuantity: 5 }, row(3)])).rejects.toThrow('cannot replace');
    await expect(save(original, [row(2),row(3)])).rejects.toThrow('cannot replace');
    await save(original, [...original.rows, row(3)]);
    const appended = await historicalImportDetail(org.id, original.id);
    expect(appended.rows.map(day => day.salesQuantity)).toEqual([100,100,0]);
    expect(appended.rows[0]?.nozzleReadings).toEqual(original.rows[0]?.nozzleReadings);
    expect(appended.rows[1]?.tankReadings).toEqual(original.rows[1]?.tankReadings);
    await expect(save(original, [...original.rows,row(4)])).rejects.toThrow('another session');
    await save(appended, [...appended.rows,row(5)]);
    const withGap = await historicalImportDetail(org.id, original.id);
    expect(withGap.rows.find(day => day.date === '2026-11-03')?.salesQuantity).toBe(0);
    await save(withGap, [...withGap.rows,row(4)]);
    const filled = await historicalImportDetail(org.id, original.id);
    expect(filled.rows.map(day => day.salesQuantity)).toEqual([100,100,100,100,0]);
    expect(filled.rows[3]?.cumulativeSales).toBe(400);
    const corrected = filled.rows.map(day => day.date === '2026-11-02' ? { ...day, nozzleReadings:[{nozzleId:nozzle.id,meterReading:1120}] } : day);
    await save(filled, corrected, 'CORRECT');
    const final = await historicalImportDetail(org.id, original.id);
    expect(final.rows.slice(0,3).map(day => day.salesQuantity)).toEqual([120,80,100]);
    expect(final.corrections).toHaveLength(4);
    const audits = await prisma.historicalSalesImportCorrection.findMany({ where: {importId:original.id} });
    expect(audits.every(audit => audit.changedById === owner.id && audit.organizationId === org.id)).toBe(true);
    expect(await prisma.inventoryLedger.count({where:{stationId:station.id}})).toBe(0);
    expect(await prisma.sale.count({where:{stationId:station.id}})).toBe(0);
    expect(await prisma.journal.count({where:{organizationId:org.id}})).toBe(0);
    expect(await prisma.supplierPayment.count({where:{organizationId:org.id}})).toBe(0);
    expect((await prisma.tank.findUniqueOrThrow({where:{id:tank.id}})).openingStock.toNumber()).toBe(8000);
    const scope = [{id:tank.id,stationId:station.id,productId:product.id}];
    const observed = await readLatestTankObservations(prisma,org.id,scope,new Date('2026-11-07T12:00:00Z'));
    expect(observed.get(tank.id)).toMatchObject({volume:7600,date:'2026-11-05',precision:'MORNING',observedAt:null,source:'DSR'});
    const inventory = await inventoryBootstrap(org.id,[station.id]);
    expect(inventory.tanks[0]).toMatchObject({bookStock:7600,physicalStock:7600,variance:null,latestObservation:{date:'2026-11-05'}});
    expect((await readLatestTankObservations(prisma,otherOrg.id,scope)).size).toBe(0);
    await prisma.tankReading.create({data:{organizationId:org.id,stationId:station.id,tankId:tank.id,physicalStock:7500,recordedById:owner.id,recordedAt:new Date('2026-11-06T06:00:00Z')}});
    expect((await readLatestTankObservations(prisma,org.id,scope,new Date('2026-11-07T12:00:00Z'))).get(tank.id)).toMatchObject({volume:7500,source:'TANK_CHECK',precision:'EXACT'});
    expect((await prisma.nozzle.findUniqueOrThrow({where:{id:nozzle.id}})).openingMeter.toNumber()).toBe(1000);
    // More than 80 live components of a DSR day must not double-deduct stock.
    await prisma.inventoryLedger.createMany({data:Array.from({length:100},()=>({organizationId:org.id,stationId:station.id,productId:product.id,tankId:tank.id,type:'SALE' as const,quantityDelta:-1,occurredAt:new Date('2026-11-03T10:00:00Z')}))});
    await prisma.inventoryLedger.createMany({data:[
      {organizationId:org.id,stationId:station.id,productId:product.id,tankId:tank.id,type:'RECEIPT',quantityDelta:1000,occurredAt:new Date('2026-11-06T10:00:00Z')},
      {organizationId:org.id,stationId:station.id,productId:product.id,tankId:tank.id,type:'SALE',quantityDelta:-100,occurredAt:new Date('2026-11-06T11:00:00Z')},
    ]});
    const asOf=new Date('2026-11-07T12:00:00Z');
    const stockScope={organizationId:org.id,stationId:station.id,productId:product.id,tankId:tank.id};
    const sources=[{id:tank.id,stationId:station.id,productId:product.id,openingStock:8000}];
    expect(Number(await bookStockAt(prisma,stockScope,asOf))).toBe(8500);
    expect(Number((await tankBookStocksAt(prisma,org.id,sources,asOf)).get(tank.id))).toBe(8500);
    expect((await inventoryBootstrap(org.id,[station.id])).tanks[0]?.bookStock).toBe(8500);
    const report=await buildReport(org.id,{startDate:'2026-11-01',endDate:'2026-11-07',stationId:station.id,asOf});
    expect(report.inventory[0]?.quantity).toBe(8500);
    expect(report.quality.unavailableReportSections.join(' ')).toContain('Historical stock valuation');
    const opening=(await tankOpeningBalances(prisma,org.id,sources,asOf)).get(tank.id)!;
    expect(Number(opening.expectedOpening)).toBe(8500);
    const boundaryOpening=(await tankOpeningBalances(prisma,org.id,sources,asOf,{closedAt:new Date('2026-11-06T10:00:00Z'),tankReadings:[{tankId:tank.id,closingDip:new Prisma.Decimal(7600)}]})).get(tank.id)!;
    expect(Number(boundaryOpening.received)).toBe(1000);
    expect(Number(boundaryOpening.expectedOpening)).toBe(8500);
    // Corrections change derived stock, not cash, quantities in posted movements or journals.
    const updatedRows=final.rows.map(day=>day.date==='2026-11-05'?{...day,nozzleReadings:[{nozzleId:nozzle.id,meterReading:1500}]}:day);
    await save(final,updatedRows,'CORRECT');
    expect(Number(await bookStockAt(prisma,stockScope,asOf))).toBe(8400);
    expect(await prisma.inventoryLedger.count({where:{stationId:station.id}})).toBe(102);
    expect(await prisma.journal.count({where:{organizationId:org.id}})).toBe(0);
    expect(await prisma.supplierPayment.count({where:{organizationId:org.id}})).toBe(0);

  });
});
