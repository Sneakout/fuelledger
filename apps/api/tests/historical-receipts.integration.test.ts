import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { tankReceiptHistory } from '../src/modules/shifts/receipt-history.js';

const url=process.env.SHIFT_RECEIPTS_TEST_DATABASE_URL;
const suite=url && url===process.env.DATABASE_URL ? describe : describe.skip;
suite('confirmed DSR receipts in Operations history',()=>{
 afterAll(()=>prisma.$disconnect());
 it('merges sources, pages without duplication, refreshes corrections and isolates fuel stations',async()=>{
  const org=await prisma.organization.create({data:{name:'Historical receipt verification'}});
  const owner=await prisma.user.create({data:{organizationId:org.id,name:'Owner',email:`${org.id}@example.test`,passwordHash:'unused',role:'OWNER'}});
  const station=await prisma.station.create({data:{organizationId:org.id,name:'Station',code:'S',addressLine1:'Test',city:'Test',state:'Test',postalCode:'000000'}});
  const other=await prisma.station.create({data:{organizationId:org.id,name:'Other',code:'O',addressLine1:'Test',city:'Test',state:'Test',postalCode:'000000'}});
  const config=await prisma.stationConfiguration.create({data:{stationId:station.id,version:1}});
  const products=await Promise.all(['MS','HSD'].map(code=>prisma.product.create({data:{organizationId:org.id,code,name:code,category:'FUEL',unit:'LITRE',tankLinked:true,inventoryTracked:true}})));
  const tanks=await Promise.all(products.map((product,i)=>prisma.tank.create({data:{configurationId:config.id,productId:product.id,code:`T${i+1}`,tankType:'UNDERGROUND',dipMethod:'MANUAL',nominalCapacity:20000,workingCapacity:19000,openingStock:0}})));
  const row=(day:number,qty=1000)=>({date:`2025-10-${String(day).padStart(2,'0')}`,receiptQuantity:qty,tankReadings:[{tankId:tanks[0]!.id,openingStock:5000}],nozzleReadings:[],testingQuantity:0});
  const saved=await prisma.historicalSalesImport.create({data:{organizationId:org.id,stationId:station.id,productId:products[0]!.id,monthStart:new Date('2025-10-01'),sourceFileName:'register.pdf',sourceMimeType:'application/pdf',sourceSize:0,sourceContent:Buffer.from(''),sourceFingerprint:org.id,importedById:owner.id,rows:Array.from({length:25},(_,i)=>row(i+1))}});
  const movement=(day:number,qty:number)=>({organizationId:org.id,stationId:station.id,productId:products[0]!.id,tankId:tanks[0]!.id,type:'RECEIPT' as const,quantityDelta:qty,occurredAt:new Date(`2025-10-${String(day).padStart(2,'0')}T06:00:00+05:30`)});
  await prisma.inventoryLedger.createMany({data:[movement(1,400),movement(2,1000),movement(3,1100)]});
  const first=await tankReceiptHistory(org.id,station.id);
  expect(first.receipts).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
  const second=await tankReceiptHistory(org.id,station.id,first.nextCursor!);
  const all=[...first.receipts,...second.receipts];
  expect(new Set(all.map(r=>r.id)).size).toBe(all.length);
  const dsr=all.filter(r=>'source' in r && r.source==='DSR');
  expect(dsr).toHaveLength(24);
  const partial=dsr.find(r=>'businessDate' in r && r.businessDate==='2025-10-01')!;
  expect(Number(partial.quantity)).toBe(600); expect(partial).toMatchObject({period:'DATE_ONLY',shiftId:null,tank:'T1',product:'MS',allocationRequired:false});
  expect(dsr.some(r=>'businessDate' in r && r.businessDate==='2025-10-02')).toBe(false);
  expect(dsr.find(r=>'businessDate' in r && r.businessDate==='2025-10-03')).toMatchObject({overlapMismatch:true});
  expect((await tankReceiptHistory(org.id,other.id)).receipts).toEqual([]);
  await expect(tankReceiptHistory(org.id,other.id,first.nextCursor!)).rejects.toMatchObject({code:'RECEIPT_CURSOR_INVALID'});
  // Correct the source without generating a stock movement, payment or journal.
  await prisma.historicalSalesImport.update({where:{id:saved.id},data:{rows:[row(1,1400)]}});
  const refreshed=await tankReceiptHistory(org.id,station.id);
  expect(Number(refreshed.receipts.find(r=>r.id===partial.id)!.quantity)).toBe(1000);
  expect(await prisma.inventoryLedger.count({where:{organizationId:org.id}})).toBe(3);
  expect(await prisma.journal.count({where:{organizationId:org.id}})).toBe(0);
  // HSD uses its own tank; ambiguous allocation is visible rather than guessed.
  await prisma.historicalSalesImport.create({data:{organizationId:org.id,stationId:station.id,productId:products[1]!.id,monthStart:new Date('2025-10-01'),sourceFileName:'hsd.pdf',sourceMimeType:'application/pdf',sourceSize:0,sourceContent:Buffer.from(''),sourceFingerprint:org.id+'hsd',importedById:owner.id,rows:[{...row(4,2000),tankReadings:[{tankId:tanks[1]!.id,openingStock:3000}]},{...row(5,3000),tankReadings:[{tankId:tanks[0]!.id},{tankId:tanks[1]!.id}]}]}});
  const hsd=(await tankReceiptHistory(org.id,station.id)).receipts.filter(r=>r.product==='HSD');
  expect(hsd.find(r=>r.tank==='T2')).toMatchObject({quantity:expect.anything(),period:'DATE_ONLY'});
  expect(hsd.find(r=>r.tank===null)).toMatchObject({allocationRequired:true});
 });
});
