import {describe,expect,it} from 'vitest';
import {Prisma} from '@prisma/client';
import {dashboardSalesTimeline,purchaseDashboardActions} from '../src/modules/dashboard/service.js';

const historicalRow=(date:string,salesQuantity:number,sellingPrice:number)=>({
  date,
  tankReadings:[{tankId:'cm12345678901234567890123',openingStock:1000}],
  receiptQuantity:0,
  nozzleReadings:[{nozzleId:'cm12345678901234567890124',meterReading:1000}],
  testingQuantity:0,
  salesQuantity,
  sellingPrice,
});
const historicalImport=(productId:string,rows:ReturnType<typeof historicalRow>[],sellingPrice=0,history:Array<{price:number;effectiveFrom:string}>=[])=>({
  productId,rows,product:{sellingPrice:new Prisma.Decimal(sellingPrice),sellingPriceHistory:history.map(row=>({price:new Prisma.Decimal(row.price),effectiveFrom:new Date(row.effectiveFrom)}))},
});

describe('dashboard sales timeline',()=>{
  it('adds verified historical sales to the seven-day trend',()=>{
    const timeline=dashboardSalesTimeline([], [historicalImport('hsd',[historicalRow('2026-11-10',1250,96)])], '2026-11-09','2026-11-15');
    expect(timeline.get('2026-11-10')).toBe(120000);
  });

  it('uses the current RSP when a historical row and a zero price entry have no usable RSP',()=>{
    const timeline=dashboardSalesTimeline([], [historicalImport('hsd',[historicalRow('2026-11-10',100,0)],110,[
      {price:0,effectiveFrom:'2026-11-01T00:00:00.000Z'},
    ])], '2026-11-09','2026-11-15');
    expect(timeline.get('2026-11-10')).toBe(11000);
  });

  it('uses live sales as the authority for the same product and day without hiding other products',()=>{
    const live=[
      {occurredAt:new Date('2026-11-10T06:00:00.000Z'),totalAmount:500,productId:'hsd'},
      {occurredAt:new Date('2026-11-10T06:30:00.000Z'),totalAmount:200,productId:'lubricant'},
    ];
    const historical=[
      historicalImport('hsd',[historicalRow('2026-11-10',100,96)]),
      historicalImport('ms',[historicalRow('2026-11-10',50,100)]),
    ];
    const timeline=dashboardSalesTimeline(live,historical,'2026-11-09','2026-11-15');
    expect(timeline.get('2026-11-10')).toBe(5700);
  });

  it('excludes imported rows outside the requested dashboard period',()=>{
    const timeline=dashboardSalesTimeline([], [historicalImport('hsd',[historicalRow('2026-11-08',100,96),historicalRow('2026-11-16',100,96)])], '2026-11-09','2026-11-15');
    expect([...timeline.entries()]).toEqual([]);
  });

  it('values imported litres using the selling price effective on that date when the DSR has no RSP',()=>{
    const timeline=dashboardSalesTimeline([], [historicalImport('hsd',[historicalRow('2026-11-10',1250,0)],110,[
      {price:96,effectiveFrom:'2026-11-01T00:00:00.000Z'},
      {price:110,effectiveFrom:'2026-11-15T00:00:00.000Z'},
    ])], '2026-11-09','2026-11-15');
    expect(timeline.get('2026-11-10')).toBe(120000);
  });
});

describe('dashboard purchase actions',()=>{
  it('uses pending price approvals and recent invoices as the shared dashboard source',()=>{
    const actions=purchaseDashboardActions([{id:'invoice-1',invoiceNumber:'IOCL-1',totalAmount:1207079,supplier:{name:'Indian Oil Corporation Limited'}}],[{id:'approval-1',reason:'Price changed',evidence:{product:{code:'HSD',unit:'LITRE'},invoice:{id:'invoice-1',invoiceNumber:'IOCL-1'},currentPurchasePrice:88,proposedPurchasePrice:100.59}}]);
    expect(actions).toEqual([
      expect.objectContaining({id:'price-approval-approval-1',severity:'HIGH',title:'New invoice IOCL-1 recorded — HSD price change needs confirmation',href:'/purchases?invoiceId=invoice-1'}),
      expect.objectContaining({id:'purchases-recorded-today',severity:'MEDIUM',title:'1 new purchase invoice recorded today',detail:expect.stringContaining('Indian Oil Corporation Limited')}),
    ]);
  });

  it('does not invent purchase actions without stored records',()=>{
    expect(purchaseDashboardActions([],[])).toEqual([]);
  });

  it('ignores malformed or unchanged price evidence',()=>{
    expect(purchaseDashboardActions([],[{id:'unchanged',reason:'No material change',evidence:{product:{code:'MS',unit:'LITRE'},invoice:{id:'invoice-2',invoiceNumber:'IOCL-2'},currentPurchasePrice:98,proposedPurchasePrice:98}}])).toEqual([]);
  });
});
