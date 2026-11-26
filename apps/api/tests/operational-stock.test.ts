import { describe,it,expect,vi } from 'vitest';
import { operationalStockPosition,readOperationalStocks } from '../src/lib/operational-stock.js';
import type { StockRegister,StockMovement } from '../src/lib/historical-stock.js';
import type { TankObservation } from '../src/lib/tank-observations.js';
const at=new Date('2026-11-21T09:00:00Z');
const tank={id:'hsd',stationId:'one',productId:'HSD',openingStock:7420};
const observation:TankObservation={volume:4398.67,dipCm:54,date:'2026-11-20',observedAt:null,precision:'MORNING',source:'DSR',sourceId:'r',sourceLabel:'Confirmed DSR · morning',sourcePath:'/source',savedAt:at.toISOString()};
const row=(date:string,volume:number,receiptQuantity=0)=>({date,tankReadings:[{tankId:tank.id,openingStock:volume}],nozzleReadings:[{nozzleId:'n',meterReading:1000}],receiptQuantity,testingQuantity:0,salesQuantity:0,sellingPrice:100});
const register=(rows:unknown):StockRegister=>({id:'r',stationId:'one',productId:'HSD',rows});
const movement=(type:string,quantityDelta:number,date='2026-11-20T10:00:00Z'):StockMovement=>({stationId:'one',productId:'HSD',tankId:'hsd',type,quantityDelta,occurredAt:new Date(date)});
const calculate=(rows:unknown,ledger:StockMovement[]=[],obs=observation)=>operationalStockPosition(tank,obs,[register(rows)],ledger,at);
describe('latest physical checkpoint availability for every tank',()=>{
 it('uses latest dip plus 4000 L, never carries earlier register drift into the estimate',()=>{
  const result=calculate([row('2026-11-01',17000,10000),row('2026-11-20',4398.67,4000)]);
  expect(result.quantity).toBe(8398.67);expect(result.opening).toBe(4398.67);expect(result.receipts).toBe(4000);expect(result.incomplete).toBe(true);
 });
 it('includes the receipt only once when both DSR and invoice contain it',()=>{
  expect(calculate([row('2026-11-20',4398.67,4000)],[movement('RECEIPT',4000)]).quantity).toBe(8398.67);
 });
 it('subtracts later saved sales, applies adjustments and excludes future movements',()=>{
  const result=calculate([row('2026-11-20',4398.67,4000)],[movement('SALE',-500),movement('ADJUSTMENT',-5),movement('RECEIPT',1000,'2026-11-22T10:00:00Z')]);
  expect(result.quantity).toBe(7893.67);
 });
 it('does not put an untimed current-day receipt before an intraday cutoff',()=>{
  const result=operationalStockPosition(tank,observation,[register([row('2026-11-20',4398.67,4000)])],[],new Date('2026-11-20T09:00:00Z'));
  expect(result.quantity).toBe(4398.67);expect(result.issues.join(' ')).toContain('actual received time');
 });
 it('does not allocate one aggregate receipt independently to multiple tanks',()=>{
  const day=row('2026-11-20',4398.67,4000);day.tankReadings.push({tankId:'other',openingStock:8000});
  expect(calculate([day]).quantity).toBe(4398.67);expect(calculate([day]).issues.join(' ')).toContain('allocate');
 });
 it.each(['MS','HSD','DEF'])('isolates %s tanks, other fuel stations and products',productId=>{
  const scopedTank={...tank,productId};const scopedRegister={...register([row('2026-11-20',4398.67,4000)]),productId};
  const foreign=[{...movement('RECEIPT',99999),stationId:'two'},{...movement('SALE',-1000),tankId:'other'}];
  const result=operationalStockPosition(scopedTank,observation,[scopedRegister],foreign,at);
  expect(result.quantity).toBe(8398.67);
 });
 it('uses all movements after an exact dip, without an 80 entry cutoff',()=>{
  const obs={...observation,volume:7500,precision:'EXACT' as const,source:'TANK_CHECK' as const,observedAt:'2026-11-20T06:00:00Z'};
  const entries=[movement('RECEIPT',1000),...Array.from({length:100},()=>movement('SALE',-1)),movement('SALE',-1000,'2026-11-19T06:00:00Z')];
  expect(calculate([],entries,obs).quantity).toBe(8400);
 });
 it('a correction to the latest dip updates the estimate without changing source rows',()=>{
  const rows=[row('2026-11-20',4398.67,4000)],before=JSON.stringify(rows);
  expect(calculate(rows,[],{...observation,volume:4500}).quantity).toBe(8500);expect(JSON.stringify(rows)).toBe(before);
 });
 it('counts a closing-boundary receipt in the next interval, not a sale already reflected in the closing dip',()=>{
  const obs={...observation,precision:'EXACT' as const,source:'SHIFT_CLOSING' as const,observedAt:'2026-11-20T10:00:00Z'};
  expect(calculate([],[movement('RECEIPT',4000),movement('SALE',-500)],obs).quantity).toBe(8398.67);
 });
});

it('reads independent positions for every configured tank, including bulk DEF, with scoped queries',async()=>{
 const tanks=[tank,{...tank,id:'def',productId:'DEF'}, {...tank,id:'other-station',stationId:'two'}];
 const registers=[register([row('2026-11-20',4398.67,4000)])];
 const ledger=[{...movement('RECEIPT',500),tankId:'def',productId:'DEF'}];
 const db={historicalSalesImport:{findMany:vi.fn().mockResolvedValue(registers)},inventoryLedger:{findMany:vi.fn().mockResolvedValue(ledger)}};
 const exact={...observation,volume:2000,precision:'EXACT' as const,source:'TANK_CHECK' as const,observedAt:'2026-11-20T06:00:00Z'};
 const positions=await readOperationalStocks(db as never,'org',tanks,new Map([['hsd',observation],['def',exact],['other-station',{...exact,volume:6000}]]),at);
 expect(positions.get('hsd')?.quantity).toBe(8398.67);
 expect(positions.get('def')?.quantity).toBe(2500);
 expect(positions.get('other-station')?.quantity).toBe(6000);
 expect(db.inventoryLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{organizationId:'org',tankId:{in:['hsd','def','other-station']},occurredAt:{lte:at}}}));
});
it('rejects incompatible movement ownership instead of silently moving fuel between tanks',async()=>{
 const db={historicalSalesImport:{findMany:vi.fn().mockResolvedValue([])},inventoryLedger:{findMany:vi.fn().mockResolvedValue([{...movement('RECEIPT',4000),stationId:'wrong'}])}};
 await expect(readOperationalStocks(db as never,'org',[tank],new Map([['hsd',observation]]),at)).rejects.toMatchObject({code:'STOCK_SCOPE_INVALID'});
});
it('does not extrapolate invalid or future physical checkpoints',()=>{
 expect(()=>calculate([],[],{...observation,volume:NaN})).toThrow('Review the latest tank measurement');
 expect(()=>calculate([],[],{...observation,date:'2026-11-22'})).toThrow('Review the latest tank measurement');
});


it('never treats the date-only sorting boundary as an unloading time relative to a measured dip', () => {
 const receipt={...movement('RECEIPT',4000,'2026-11-19T18:30:00Z'),receiptDate:'2026-11-20'};
 const exact={...observation,volume:6000,precision:'EXACT' as const,source:'TANK_CHECK' as const,observedAt:'2026-11-20T06:00:00Z'};
 const sameDay=operationalStockPosition(tank,exact,[],[receipt],at);
 expect(sameDay.quantity).toBe(6000);
 expect(sameDay.incomplete).toBe(true);
 expect(sameDay.issues.join(' ')).toContain('no exact unloading time');
 const confirmedBeforeMeasurement=operationalStockPosition(tank,exact,[],[{...receipt,receiptRecordedAt:new Date('2026-11-20T05:00:00Z')}],at);
 expect(confirmedBeforeMeasurement.quantity).toBe(6000); expect(confirmedBeforeMeasurement.incomplete).toBe(false);
 const previousDay={...exact,date:'2026-11-19',observedAt:'2026-11-19T06:00:00Z'};
 expect(operationalStockPosition(tank,previousDay,[],[receipt],at).quantity).toBe(10000);
 const nextDay={...exact,date:'2026-11-21',observedAt:'2026-11-21T06:00:00Z'};
 expect(operationalStockPosition(tank,nextDay,[],[receipt],at).quantity).toBe(6000);
});
