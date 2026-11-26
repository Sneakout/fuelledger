import { Prisma } from '@prisma/client';
import { calculateHistoricalNozzleSales, hasFollowingMorning, type HistoricalSalesRowInput } from '@fuelledger/shared';
import { AppError } from './errors.js';
import { addIndiaDays, indiaDate, indiaDayRange } from './india-time.js';

export type HistoricalStockTank = {id:string;stationId:string;productId:string;openingStock:Prisma.Decimal.Value};
export type StockMovement = {stationId:string;productId:string;tankId:string|null;type:string;quantityDelta:Prisma.Decimal.Value;occurredAt:Date;sourceStartedAt?:Date|undefined;receiptDate?:string|null|undefined;receiptRecordedAt?:Date|undefined};
export type StockRegister = {id:string;stationId:string;productId:string;rows:unknown};
export type StockTimeline = {
  quantity:Prisma.Decimal; opening:Prisma.Decimal; receipts:Prisma.Decimal; sales:Prisma.Decimal; adjustments:Prisma.Decimal;
  anchorDate:string|null; throughDate:string|null; historical:boolean; issues:string[]; blocking:boolean;
};
export type HistoricalStockReader = Pick<Prisma.TransactionClient,'historicalSalesImport'|'inventoryLedger'|'nozzle'>;

/** Confirmed DSRs cover whole business days. Live entries on a covered day are
 * components of that daily total, not additional stock. Never match by upload
 * date or apply a date-only daily total to an arbitrary intraday cutoff. */
export function composeStockTimeline(tank:HistoricalStockTank,registers:StockRegister[],ledger:StockMovement[],at:Date,nozzleTanks:Map<string,string[]>) : StockTimeline {
  const today=indiaDate(at), zero=()=>new Prisma.Decimal(0);
  const live=ledger.filter(row=>row.stationId===tank.stationId&&row.productId===tank.productId&&row.tankId===tank.id&&row.occurredAt<=at);
  const days=new Map<string,HistoricalSalesRowInput>();
  for(const record of registers.filter(row=>row.stationId===tank.stationId&&row.productId===tank.productId)) {
    if(!Array.isArray(record.rows))continue;
    for(const row of record.rows as HistoricalSalesRowInput[]) if(typeof row?.date==='string'&&Array.isArray(row.tankReadings)&&Array.isArray(row.nozzleReadings)&&row.date<=today&&row.tankReadings.some(reading=>reading.tankId===tank.id))days.set(row.date,row);
  }
  const rows=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const anchor=rows.find(row=>{const reading=row.tankReadings.find(value=>value.tankId===tank.id);return reading&&Number.isFinite(reading.openingStock)&&(!reading.calibration||reading.calibration.reviewConfirmed);});
  const result:StockTimeline={quantity:zero(),opening:new Prisma.Decimal(anchor?.tankReadings.find(row=>row.tankId===tank.id)!.openingStock??tank.openingStock),receipts:zero(),sales:zero(),adjustments:zero(),anchorDate:anchor?.date??null,throughDate:null,historical:Boolean(anchor),issues:[],blocking:false};
  const applicable=live.filter(row=>!anchor||indiaDate(row.occurredAt)>=anchor.date);
  for(const row of applicable) {
    const delta=new Prisma.Decimal(row.quantityDelta);
    if(row.type==='RECEIPT')result.receipts=result.receipts.add(delta);
    else if(row.type==='SALE')result.sales=result.sales.sub(delta);
    else result.adjustments=result.adjustments.add(delta);
  }
  const issue=(message:string,blocking=false)=>{result.issues.push(message);result.blocking ||= blocking;};
  for (const row of applicable) if (row.receiptDate === today && (!row.receiptRecordedAt || row.receiptRecordedAt > at) && at.getTime() < indiaDayRange(today).endExclusive.getTime() - 1) issue(`${today}: a delivery is recorded by day only. Confirm its unloading time before using an intraday stock balance.`, true);
  if(anchor)for(let index=0;index<rows.length;index++) {
    const row=rows[index]!,next=rows[index+1]; if(row.date<anchor.date)continue;
    if(!Number.isFinite(row.receiptQuantity)||row.receiptQuantity<0||!Number.isFinite(row.testingQuantity)||row.testingQuantity<0) {issue(`${row.date}: invalid DSR receipt or testing quantity.`,true);continue;}
    const singleTank=row.tankReadings.length===1;
    const dayLive=applicable.filter(entry=>indiaDate(entry.occurredAt)===row.date);
    const liveTotal=(type:string)=>dayLive.filter(entry=>entry.type===type).reduce((sum,entry)=>sum.add(new Prisma.Decimal(entry.quantityDelta).abs()),zero());
    const addCoverage=(type:'RECEIPT'|'SALE',total:number)=>{
      const posted=liveTotal(type), recorded=new Prisma.Decimal(total);
      if(posted.sub(recorded).gt('.001')) {issue(`${row.date}: live ${type.toLowerCase()} quantity ${posted.toFixed(3)} L exceeds the confirmed DSR total ${recorded.toFixed(3)} L. Resolve the overlap.`,true);return;}
      const missing=recorded.sub(posted);
      if(type==='RECEIPT')result.receipts=result.receipts.add(missing);else result.sales=result.sales.add(missing);
    };
    // A day-only receipt cannot safely be placed before an intraday cutoff.
    if(row.receiptQuantity>0) {
      if(!singleTank)issue(`${row.date}: allocate the DSR receipt of ${row.receiptQuantity} L to its receiving tank.`,true);
      else if(row.date===today&&liveTotal('RECEIPT').sub(row.receiptQuantity).abs().gt('.001'))issue(`${row.date}: the DSR receipt needs an actual received time before it can affect intraday stock.`,true);
      else addCoverage('RECEIPT',row.receiptQuantity);
    } else if(row.date<today&&liveTotal('RECEIPT').gt('.001'))issue(`${row.date}: the DSR shows no receipt but live deliveries exist. Review both sources.`,true);
    if(!next||!hasFollowingMorning(row,next)) {
      if(row.date<today)issue(`${row.date}: next morning nozzle readings are missing; this day's consumption is incomplete.`);
      continue;
    }
    if(next.date>today)continue;
    if(applicable.some(entry=>entry.type==='SALE'&&entry.sourceStartedAt&&indiaDate(entry.sourceStartedAt)!==indiaDate(entry.occurredAt)&&row.date>=indiaDate(entry.sourceStartedAt)&&row.date<=indiaDate(entry.occurredAt))) {
      issue(`${row.date}: a live shift spans business dates. Reconcile its nozzle readings with the DSR before combining daily sales.`,true);
      continue;
    }
    const aggregate=calculateHistoricalNozzleSales(row,next);
    if(aggregate===undefined||!Number.isFinite(aggregate)){issue(`${row.date}: invalid DSR nozzle movement.`,true);continue;}
    const gross=row.nozzleReadings.reduce((sum,reading)=>sum+(next.nozzleReadings.find(value=>value.nozzleId===reading.nozzleId)!.meterReading-reading.meterReading),0);
    if(row.testingQuantity>gross+.001){issue(`${row.date}: returned testing exceeds the recorded nozzle movement.`,true);continue;}
    if(singleTank)addCoverage('SALE',aggregate);
    else {
      if(row.testingQuantity>0){issue(`${row.date}: returned testing must be allocated to nozzles before computing individual tank consumption.`,true);continue;}
      let consumed=0,valid=true;
      for(const reading of row.nozzleReadings) {
        const mapped=nozzleTanks.get(reading.nozzleId)??[],following=next.nozzleReadings.find(value=>value.nozzleId===reading.nozzleId);
        if(mapped.length!==1||!following||following.meterReading<reading.meterReading){valid=false;break;}
        if(mapped[0]===tank.id)consumed+=following.meterReading-reading.meterReading;
      }
      if(valid)addCoverage('SALE',consumed);else issue(`${row.date}: a DSR nozzle does not have one verified source tank.`,true);
    }
    result.throughDate=row.date;
  }
  if(anchor) {
    const last=rows.at(-1)!.date;
    for(let date=anchor.date;date<last;date=addIndiaDays(date,1))if(!days.has(date))issue(`${date}: DSR readings are missing; stock history is incomplete.`);
    if(last<today)issue(`Latest DSR morning is ${last}; subsequent consumption is limited to saved live transactions.`);
  }
  result.quantity=result.opening.add(result.receipts).sub(result.sales).add(result.adjustments);
  return result;
}

export async function readTankStockTimelines(db:HistoricalStockReader,organizationId:string,tanks:HistoricalStockTank[],at=new Date()) {
  if(!tanks.length)return new Map<string,StockTimeline>();
  const registers=await db.historicalSalesImport.findMany({where:{organizationId,stationId:{in:[...new Set(tanks.map(tank=>tank.stationId))]},productId:{in:[...new Set(tanks.map(tank=>tank.productId))]},monthStart:{lte:at}},select:{id:true,stationId:true,productId:true,rows:true}});
  if(!registers.length)return new Map<string,StockTimeline>();
  const affected=tanks.filter(tank=>registers.some(record=>record.stationId===tank.stationId&&record.productId===tank.productId));
  const [ledger,nozzles]=await Promise.all([
    db.inventoryLedger.findMany({where:{organizationId,tankId:{in:affected.map(tank=>tank.id)},occurredAt:{lte:at}},select:{stationId:true,productId:true,tankId:true,type:true,quantityDelta:true,occurredAt:true,receiptLine:{select:{receipt:{select:{receivedDate:true,createdAt:true}}}},sale:{select:{shift:{select:{openedAt:true}}}}}}),
    db.nozzle.findMany({where:{productId:{in:[...new Set(affected.map(tank=>tank.productId))]},dispenser:{configuration:{station:{organizationId},stationId:{in:[...new Set(affected.map(tank=>tank.stationId))]}}}},select:{id:true,tankMappings:{select:{tankId:true}}}}),
  ]);
  for(const movement of ledger) {
    const tank=affected.find(tank=>tank.id===movement.tankId);
    if(!tank||tank.stationId!==movement.stationId||tank.productId!==movement.productId)throw new AppError(409,'STOCK_SCOPE_INVALID','A stock movement does not match its fuel station, product and tank. Review inventory consistency.');
  }
  const mapping=new Map(nozzles.map(nozzle=>[nozzle.id,nozzle.tankMappings.map(tank=>tank.tankId)]));
  return new Map(affected.map(tank=>[tank.id,composeStockTimeline(tank,registers,ledger.map(entry=>({...entry,sourceStartedAt:entry.sale?.shift?.openedAt,receiptDate:entry.receiptLine?.receipt?.receivedDate,receiptRecordedAt:entry.receiptLine?.receipt?.createdAt})),at,mapping)] as const).filter(([,timeline])=>timeline.historical));
}
