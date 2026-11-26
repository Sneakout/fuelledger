import { describe, expect, it } from 'vitest';
import { composeYesterdayPerformance } from '../src/modules/dashboard/yesterday-performance.js';
const date = '2026-11-25';
const morning = (patch: any = {}) => ({ id:'am',stationId:'s',shiftNumber:1,status:'LOCKED',openedAt:new Date('2026-11-25T00:30:00Z'),closedAt:new Date('2026-11-25T12:30:00Z'),reconciliation:{collections:[{paymentMethod:'CASH',actualAmount:5000}]},nozzleReadings:[],...patch });
const night = (patch: any = {}) => morning({id:'pm',shiftNumber:2,openedAt:new Date('2026-11-25T12:30:00Z'),closedAt:new Date('2026-11-26T00:30:00Z'),reconciliation:{collections:[{paymentMethod:'UPI',actualAmount:7500}]},...patch});
const sale = (patch: any = {}) => ({ id:'sale',stationId:'s',shiftId:'am',productId:'ms',kind:'METERED',paymentMethod:'OTHER',quantity:50,totalAmount:5000,occurredAt:new Date('2026-11-25T12:30:00Z'),product:{inventoryTracked:true},inventoryLedger:{quantityDelta:-50,unitCost:90},...patch });
const row = (day:string,meter:number) => ({date:day,receiptQuantity:0,testingQuantity:0,sellingPrice:100,tankReadings:[],nozzleReadings:[{nozzleId:'n',meterReading:meter}]});
const register = (next = 1150, stationId = 's') => ({ stationId,productId:'ms',rows:[row(date,1000),row('2026-11-26',next)] });
const compose = (patch: any = {}) => composeYesterdayPerformance({ date,stations:[{id:'s',name:'Station'}],shifts:[],sales:[],expenses:[],registers:[],testingCosts:[],...patch });
describe('yesterday performance from actual shift dates', () => {
 it('keeps morning and overnight sales together, including counter sales and expenses during the night', () => {
  const current = morning({id:'today',status:'OPEN',openedAt:new Date('2026-11-26T00:30:00Z'),closedAt:null,reconciliation:null});
  const out = compose({shifts:[morning(),night(),current],sales:[sale(),sale({id:'night-sale',shiftId:'pm',quantity:75,totalAmount:7500,occurredAt:new Date('2026-11-26T00:30:00Z'),inventoryLedger:{quantityDelta:-75,unitCost:90}}),
   sale({id:'night-counter',shiftId:null,productId:'shop',kind:'SERVICE',quantity:1,totalAmount:100,paymentMethod:'CARD',occurredAt:new Date('2026-11-26T00:00:00Z'),product:{inventoryTracked:false},inventoryLedger:null}),
   sale({id:'today-counter',shiftId:null,totalAmount:99999,occurredAt:new Date('2026-11-26T01:00:00Z')})],
   expenses:[{stationId:'s',amount:200,incurredAt:new Date('2026-11-26T00:10:00Z')},{stationId:'s',amount:1000,incurredAt:new Date('2026-11-26T01:00:00Z')}] });
  expect(out).toMatchObject({sales:12600,meteredVolume:125,collected:12600,netProfit:1150,closedShifts:2,pendingClosings:0,status:'RECORDED',expenses:200,start:'2026-11-25T00:30:00.000Z',end:'2026-11-26T00:30:00.000Z'});
 });
 it('does not impose a fixed morning cutoff on a station’s shifts', () => {
  const out = compose({shifts:[morning({openedAt:new Date('2026-11-25T02:15:00Z'),closedAt:new Date('2026-11-26T02:45:00Z')})],sales:[sale()]});
  expect(out.start).toBe('2026-11-25T02:15:00.000Z'); expect(out.end).toBe('2026-11-26T02:45:00.000Z');
 });
 it('shows pending instead of zero for an unclosed shift with no saved sales', () => {
  expect(compose({shifts:[morning({status:'OPEN',closedAt:null,reconciliation:null})]})).toMatchObject({status:'PENDING',sales:null,meteredVolume:null,collected:null,netProfit:null,pendingClosings:1});
 });
 it('keeps closed sales visible while collections await verification, excluding provisional Other amounts', () => {
  const out = compose({shifts:[morning({reconciliation:null})],sales:[sale()]});
  expect(out).toMatchObject({sales:5000,meteredVolume:50,collected:null,verifiedCollected:0,pendingReconciliations:1,netProfit:500});
 });
 it('never counts customer or fleet credit as money collected', () => {
  const shift = morning({reconciliation:{collections:[{paymentMethod:'CASH',actualAmount:1000},{paymentMethod:'CREDIT',actualAmount:4000},{paymentMethod:'FLEET',actualAmount:3000}]}});
  expect(compose({shifts:[shift],sales:[sale()]}).collected).toBe(1000);
 });
 it('distinguishes absent data from a confirmed zero-sales shift', () => {
  expect(compose()).toMatchObject({status:'NO_DATA',sales:null,collected:null,netProfit:null});
  expect(compose({shifts:[morning({reconciliation:{collections:[{paymentMethod:'CASH',actualAmount:0}]}})]})).toMatchObject({status:'RECORDED',sales:0,collected:0,netProfit:0,meteredVolume:0});
 });
 it('adds only uncovered DSR litres and withholds unknown collections and profit', () => {
  const out = compose({shifts:[morning()],sales:[sale()],registers:[register()]});
  expect(out).toMatchObject({sales:15000,meteredVolume:150,collected:null,verifiedCollected:5000,netProfit:null,historicalProducts:1});
  expect(out.collectionsReason).toMatch(/DSR/);
 });
 it('recomputes corrected DSR totals and never suppresses another station or product', () => {
  const original = compose({registers:[register()]});
  expect(original.sales).toBe(15000);
  expect(compose({registers:[register(1160),register(1100,'other')]}).sales).toBe(26000);
 });
 it('flags incompatible live and DSR totals instead of counting both', () => {
  const out = compose({shifts:[morning()],sales:[sale({quantity:200,totalAmount:20000})],registers:[register()]});
  expect(out).toMatchObject({sales:20000,status:'REVIEW',netProfit:null,collected:null});
  expect(out.issues[0]).toMatch(/exceed/);
 });
 it('requires the following morning before treating an incomplete DSR row as zero sales', () => {
  expect(compose({registers:[{...register(),rows:[row(date,1000)]}]})).toMatchObject({status:'PENDING',sales:null,meteredVolume:null,netProfit:null,missingMorning:true});
 });
 it('does not invent selling prices or purchase costs', () => {
  expect(compose({shifts:[morning()],sales:[sale({inventoryLedger:null})]}).netProfit).toBeNull();
  const dsr = register(); dsr.rows[0]!.sellingPrice=0;
  expect(compose({registers:[dsr]})).toMatchObject({sales:null,meteredVolume:150,netProfit:null});
 });
 it('includes posted testing loss in profit and requires its cost evidence', () => {
  const shifts=[morning({nozzleReadings:[{testingQuantity:5,testingReturned:false}]})];
  const sales=[sale({quantity:95,totalAmount:9500,inventoryLedger:{quantityDelta:-95,unitCost:90}})];
  expect(compose({shifts,sales}).netProfit).toBeNull();
  expect(compose({shifts,sales,testingCosts:[{shiftId:'am',amount:450}]}).netProfit).toBe(500);
 });
 it('rounds product cost per sale like the posted accounting journal', () => {
  const out = compose({shifts:[morning()],sales:[sale({quantity:.15,totalAmount:15,inventoryLedger:{quantityDelta:-.15,unitCost:90.10}})]});
  expect(out.netProfit).toBe(1.48);
 });
 it('excludes cancelled shifts and does not split a multi-day carry-in shift', () => {
  expect(compose({shifts:[morning({status:'CANCELLED'})]}).sales).toBeNull();
  const out = compose({shifts:[night({openedAt:new Date('2026-11-24T12:30:00Z'),closedAt:null,status:'OPEN'})]});
  expect(out.status).toBe('REVIEW'); expect(out.sales).toBeNull(); expect(out.issues[0]).toMatch(/started earlier/);
 });
});
