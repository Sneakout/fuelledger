import { describe, expect, it } from 'vitest';
import { composeStockTimeline, type StockMovement, type StockRegister } from '../src/lib/historical-stock.js';
import type { HistoricalSalesRowInput } from '@fuelledger/shared';
const tank={id:'tank',stationId:'station',productId:'MS',openingStock:2809};
const at=new Date('2026-11-03T12:00:00Z');
const row=(day:number,meter:number,stock:number,receipt=0,testing=0):HistoricalSalesRowInput=>({date:`2026-11-0${day}`,tankReadings:[{tankId:'tank',openingStock:stock}],nozzleReadings:[{nozzleId:'n',meterReading:meter}],receiptQuantity:receipt,testingQuantity:testing,salesQuantity:0,sellingPrice:100});
const record=(rows:HistoricalSalesRowInput[]):StockRegister=>({id:'r',stationId:'station',productId:'MS',rows});
const live=(day:number,type:string,qty:number):StockMovement=>({stationId:'station',productId:'MS',tankId:'tank',type,quantityDelta:qty,occurredAt:new Date(`2026-11-0${day}T10:00:00Z`)});
const calculate=(rows:HistoricalSalesRowInput[],ledger:StockMovement[]=[],time=at)=>composeStockTimeline(tank,[record(rows)],ledger,time,new Map());
describe('one stock timeline for DSR and live records',()=>{
 it('uses verified opening plus all receipts less metered sales, excluding returned testing',()=>{
  const result=calculate([row(1,1000,8000,4000,5),row(2,2005,11000,0,10),row(3,2515,10500)]);
  expect(result.opening.toNumber()).toBe(8000);
  expect(result.receipts.toNumber()).toBe(4000);
  expect(result.sales.toNumber()).toBe(1500);
  expect(result.quantity.toNumber()).toBe(10500);
  expect(result.issues).toEqual([]);
 });
 it('counts live components of a DSR daily total exactly once',()=>{
  const rows=[row(1,1000,8000,4000),row(2,2000,11000),row(3,2500,10500)];
  const result=calculate(rows,[live(1,'RECEIPT',4000),live(1,'SALE',-1000),live(2,'SALE',-200),live(3,'RECEIPT',1000),live(3,'SALE',-100)]);
  expect(result.receipts.toNumber()).toBe(5000);
  expect(result.sales.toNumber()).toBe(1600);
  expect(result.quantity.toNumber()).toBe(11400);
 });
 it('recomputes after correcting old readings without resetting to each later dip',()=>{
  const rows=[row(1,1000,8000),row(2,2000,6500),row(3,2500,6200)];
  const result=calculate(rows);expect(result.quantity.toNumber()).toBe(6500);
  rows[2]!.nozzleReadings[0]!.meterReading=2600;
  expect(calculate(rows).quantity.toNumber()).toBe(6400);
 });
 it('flags live totals exceeding the DSR instead of adding or silently deleting transactions',()=>{
  const result=calculate([row(1,1000,8000),row(2,2000,7000)],[live(1,'SALE',-1100)]);
  expect(result.blocking).toBe(true);expect(result.issues.join(' ')).toContain('exceeds the confirmed DSR');
  expect(result.quantity.toNumber()).toBe(6900);
 });
 it('does not count stock before its physical opening checkpoint or future events',()=>{
  const result=calculate([row(2,1000,8000),row(3,1500,7500)],[live(1,'SALE',-5000),live(4,'RECEIPT',10000)]);
  expect(result.quantity.toNumber()).toBe(7500);
 });
 it('does not apply a full DSR day sale before the following morning exists at the cutoff',()=>{
  const result=calculate([row(1,1000,8000),row(2,2000,7000)],[],new Date('2026-11-01T12:00:00Z'));
  expect(result.quantity.toNumber()).toBe(8000);
 });
 it('flags missing mornings rather than calculating across a gap',()=>{
  const result=calculate([row(1,1000,8000),row(3,3000,6000)]);
  expect(result.sales.toNumber()).toBe(0);expect(result.issues.join(' ')).toContain('2026-11-02');
 });
 it('requires received time for an unposted current-day DSR delivery',()=>{
  const result=calculate([row(3,1000,8000,4000)]);
  expect(result.quantity.toNumber()).toBe(8000);expect(result.blocking).toBe(true);
 });
 it('does not guess daily allocation for a live shift spanning business dates',()=>{
  const movement={...live(2,'SALE',-1000),sourceStartedAt:new Date('2026-11-01T17:00:00Z')};
  const result=calculate([row(1,1000,8000),row(2,1500,7500),row(3,2000,7000)],[movement]);
  expect(result.sales.toNumber()).toBe(1000);expect(result.blocking).toBe(true);expect(result.issues.join(' ')).toContain('spans business dates');
 });
 it('requires review when returned testing exceeds the meter movement',()=>{
  const result=calculate([row(1,1000,8000,0,2000),row(2,2000,7000)]);
  expect(result.blocking).toBe(true);expect(result.issues.join(' ')).toContain('testing exceeds');
 });
 it('preserves explicitly recorded testing loss and approved adjustments',()=>{
  const result=calculate([row(1,1000,8000,0,5),row(2,2005,7000),row(3,2505,6500)],[live(1,'ADJUSTMENT',-10),live(3,'ADJUSTMENT',20)]);
  expect(result.quantity.toNumber()).toBe(6510);
 });
 it('does not mix stations or products',()=>{
  const result=composeStockTimeline(tank,[{...record([row(1,1000,100000)]),stationId:'other'}],[{...live(1,'RECEIPT',9999),productId:'HSD'}],at,new Map());
  expect(result.quantity.toNumber()).toBe(2809);expect(result.historical).toBe(false);
 });
 it('requires explicit allocation for multi-tank receipt and testing quantities',()=>{
  const rows=[row(1,1000,8000,4000,5),row(2,2000,7000)];
  for(const day of rows)day.tankReadings.push({tankId:'other',openingStock:1000});
  const result=calculate(rows);expect(result.blocking).toBe(true);expect(result.issues.join(' ')).toContain('allocate');
 });
 it('calculates unambiguous multi-tank nozzle consumption independently',()=>{
  const rows=[row(1,1000,8000),row(2,2000,7000)];
  for(const day of rows)day.tankReadings.push({tankId:'other',openingStock:1000});
  const result=composeStockTimeline(tank,[record(rows)],[],at,new Map([['n',['tank']]]));
  expect(result.sales.toNumber()).toBe(1000);
 });
});
