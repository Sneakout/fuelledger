import { Prisma } from '@prisma/client';
import { composeStockTimeline, type HistoricalStockTank, type StockMovement, type StockRegister } from './historical-stock.js';
import { type TankObservation } from './tank-observations.js';
import { indiaDate } from './india-time.js';
import { AppError } from './errors.js';

export type OperationalStock = {
  quantity:number; opening:number; receipts:number; sales:number; adjustments:number;
  checkpointDate:string; checkpointAt:string|null; source:string; asOf:string;
  incomplete:boolean; issues:string[];
};
/** A physical checkpoint explains availability; it never rewrites the cumulative
 * ledger or creates an adjustment. Date-only DSR receipts cover the whole day,
 * so composeStockTimeline supplies only the residual beyond posted deliveries. */
export function operationalStockPosition(tank:HistoricalStockTank, observation:TankObservation, registers:StockRegister[], ledger:StockMovement[], asOf:Date):OperationalStock {
  if(!Number.isFinite(observation.volume)||observation.volume<0||!/^\d{4}-\d{2}-\d{2}$/.test(observation.date)||observation.date>indiaDate(asOf)||(observation.precision==='EXACT'&&(!observation.observedAt||!Number.isFinite(Date.parse(observation.observedAt))||new Date(observation.observedAt)>asOf)))throw new AppError(409,'STOCK_CHECKPOINT_INVALID','Review the latest tank measurement before calculating stock.');
  const scoped=ledger.filter(row=>row.tankId===tank.id&&row.stationId===tank.stationId&&row.productId===tank.productId&&row.occurredAt<=asOf);
  let receipts=new Prisma.Decimal(0),sales=new Prisma.Decimal(0),adjustments=new Prisma.Decimal(0);
  const issues:string[]=[];
  if(observation.precision==='MORNING') {
    const recent=registers.map(register=>({...register,rows:Array.isArray(register.rows)?register.rows.filter(row=>row&&typeof row==='object'&&'date' in row&&typeof row.date==='string'&&row.date>=observation.date):[]}));
    const timeline=composeStockTimeline({...tank,openingStock:observation.volume},recent,scoped.filter(row=>indiaDate(row.occurredAt)>=observation.date),asOf,new Map());
    receipts=timeline.receipts;sales=timeline.sales;adjustments=timeline.adjustments;
    issues.push(...timeline.issues);
    // No exact time was recorded. Same-day live movements may straddle the dip;
    // expose the uncertainty instead of claiming an exact-time physical balance.
    if(scoped.some(row=>indiaDate(row.occurredAt)===observation.date))issues.push('The morning dip has no exact time. Verify that same-day posted movements occurred after the dip.');
    if(!timeline.historical)issues.push('The source morning reading could not be matched to the confirmed register.');
    issues.push('Sales after the latest morning reading are incomplete until the next morning readings or a newer physical check are recorded.');
  } else {
    const checkpoint=new Date(observation.observedAt!);
    for(const row of scoped) {
      if (row.receiptDate) {
        if (row.receiptDate === observation.date && (!row.receiptRecordedAt || row.receiptRecordedAt > checkpoint)) issues.push(`${row.receiptDate}: a delivery has no exact unloading time. Confirm whether it arrived before or after the latest tank measurement.`);
        if (row.receiptDate <= observation.date) continue;
      }
      // Receipts at the closing boundary belong to the following interval.
      if(row.occurredAt<checkpoint||(row.occurredAt.getTime()===checkpoint.getTime()&&!(observation.source==='SHIFT_CLOSING'&&row.type==='RECEIPT')))continue;
      if(row.type==='SALE'&&row.sourceStartedAt&&row.sourceStartedAt<checkpoint)issues.push('A posted sale spans the latest measurement. Its consumption cannot be split at the dip time; review the shift readings.');
      const delta=new Prisma.Decimal(row.quantityDelta);
      if(row.type==='RECEIPT')receipts=receipts.add(delta);
      else if(row.type==='SALE')sales=sales.sub(delta);
      else adjustments=adjustments.add(delta);
    }
    if(observation.timingNote)issues.push(observation.timingNote);
  }
  const quantity=new Prisma.Decimal(observation.volume).add(receipts).sub(sales).add(adjustments);
  if(quantity.lt(0))issues.push('Recorded consumption exceeds the stock available since the latest physical measurement.');
  return {quantity:Number(quantity),opening:observation.volume,receipts:Number(receipts),sales:Number(sales),adjustments:Number(adjustments),checkpointDate:observation.date,checkpointAt:observation.observedAt,source:observation.sourceLabel,asOf:asOf.toISOString(),incomplete:issues.length>0,issues};
}
export async function readOperationalStocks(db:Pick<Prisma.TransactionClient,'historicalSalesImport'|'inventoryLedger'>, organizationId:string, tanks:HistoricalStockTank[], observations:Map<string,TankObservation>, asOf:Date) {
  if(!tanks.length||!observations.size)return new Map<string,OperationalStock>();
  const [registers,ledger]=await Promise.all([
    db.historicalSalesImport.findMany({where:{organizationId,stationId:{in:[...new Set(tanks.map(t=>t.stationId))]},productId:{in:[...new Set(tanks.map(t=>t.productId))]},monthStart:{lte:asOf}},select:{id:true,stationId:true,productId:true,rows:true}}),
    db.inventoryLedger.findMany({where:{organizationId,tankId:{in:tanks.map(t=>t.id)},occurredAt:{lte:asOf}},select:{stationId:true,productId:true,tankId:true,type:true,quantityDelta:true,occurredAt:true,receiptLine:{select:{receipt:{select:{receivedDate:true,createdAt:true}}}},sale:{select:{shift:{select:{openedAt:true}}}}}}),
  ]);
  for(const movement of ledger) {
    const tank=tanks.find(t=>t.id===movement.tankId);
    if(!tank||tank.stationId!==movement.stationId||tank.productId!==movement.productId)throw new AppError(409,'STOCK_SCOPE_INVALID','A stock movement does not match its fuel station, product and tank.');
  }
  const result=new Map<string,OperationalStock>();
  for(const tank of tanks) {
    const observation=observations.get(tank.id);
    if(observation)result.set(tank.id,operationalStockPosition(tank,observation,registers,ledger.map(row=>({...row,sourceStartedAt:row.sale?.shift?.openedAt,receiptDate:row.receiptLine?.receipt?.receivedDate,receiptRecordedAt:row.receiptLine?.receipt?.createdAt})),asOf));
  }
  return result;
}
