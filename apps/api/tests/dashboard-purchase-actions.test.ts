import {describe,expect,it} from 'vitest';
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

describe('dashboard sales timeline',()=>{
  it('adds verified historical sales to the seven-day trend',()=>{
    const timeline=dashboardSalesTimeline([], [{productId:'hsd',rows:[historicalRow('2026-11-10',1250,96)]}], '2026-11-09','2026-11-15');
    expect(timeline.get('2026-11-10')).toBe(120000);
  });

  it('uses live sales as the authority for the same product and day without hiding other products',()=>{
    const live=[
      {occurredAt:new Date('2026-11-10T06:00:00.000Z'),totalAmount:500,productId:'hsd'},
      {occurredAt:new Date('2026-11-10T06:30:00.000Z'),totalAmount:200,productId:'lubricant'},
    ];
    const historical=[
      {productId:'hsd',rows:[historicalRow('2026-11-10',100,96)]},
      {productId:'ms',rows:[historicalRow('2026-11-10',50,100)]},
    ];
    const timeline=dashboardSalesTimeline(live,historical,'2026-11-09','2026-11-15');
    expect(timeline.get('2026-11-10')).toBe(5700);
  });

  it('excludes imported rows outside the requested dashboard period',()=>{
    const timeline=dashboardSalesTimeline([], [{productId:'hsd',rows:[historicalRow('2026-11-08',100,96),historicalRow('2026-11-16',100,96)]}], '2026-11-09','2026-11-15');
    expect([...timeline.entries()]).toEqual([]);
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
