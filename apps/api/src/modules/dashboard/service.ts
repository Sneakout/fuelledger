import { prisma } from '../../lib/prisma.js';
import { effectivePriceAt } from '../../lib/effective-price.js';
import { buildReport } from '../reports/service.js';

const isoDate=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const startOfDay=(date:Date)=>{const result=new Date(date);result.setHours(0,0,0,0);return result;};
const addDays=(date:Date,days:number)=>{const result=new Date(date);result.setDate(result.getDate()+days);return result;};
const number=(value:unknown)=>Number(value??0);

export async function bootstrap(organizationId:string,permittedStationIds?:string[],stationId?:string){
  const now=new Date(),today=startOfDay(now),tomorrow=addDays(today,1),weekStart=addDays(today,-6),previousStart=addDays(today,-13);
  const report=await buildReport(organizationId,{startDate:isoDate(today),endDate:isoDate(today),permittedStationIds,...(stationId?{stationId}:{})});
  const scopeIds=stationId?[stationId]:permittedStationIds;
  const [recentSales,shifts,reconciliations,tanks]=await Promise.all([
    prisma.sale.findMany({where:{organizationId,...(scopeIds?{stationId:{in:scopeIds}}:{}),occurredAt:{gte:previousStart,lt:tomorrow}},select:{occurredAt:true,totalAmount:true}}),
    prisma.shift.findMany({where:{station:{organizationId,...(scopeIds?{id:{in:scopeIds}}:{})},status:{in:['OPEN','RECONCILIATION_REQUIRED']}},select:{id:true,status:true,shiftNumber:true,openedAt:true,closedAt:true,station:{select:{id:true,name:true,code:true}}},orderBy:{openedAt:'desc'}}),
    prisma.shiftReconciliation.findMany({where:{shift:{station:{organizationId,...(scopeIds?{id:{in:scopeIds}}:{})}},reconciledAt:{gte:today,lt:tomorrow}},include:{collections:{select:{varianceAmount:true}}}}),
    prisma.tank.findMany({
      where:{status:'ACTIVE',configuration:{active:true,station:{organizationId,...(scopeIds?{id:{in:scopeIds}}:{})}}},
      include:{
        product:{select:{name:true,code:true,unit:true,sellingPrice:true,sellingPriceHistory:{where:{effectiveFrom:{lte:now}},orderBy:{effectiveFrom:'desc'},take:1}}},
        configuration:{select:{station:{select:{id:true,name:true,code:true}}}},
        inventoryLedger:{select:{quantityDelta:true}},
        physicalReadings:{orderBy:{recordedAt:'desc'},take:1,select:{physicalStock:true,recordedAt:true}},
        densityReadings:{orderBy:{recordedAt:'desc'},take:1,select:{density:true,recordedAt:true}},
      },
      orderBy:[{configuration:{station:{name:'asc'}}},{code:'asc'}],
    }),
  ]);
  const total=(from:Date,to:Date)=>recentSales.filter(row=>row.occurredAt>=from&&row.occurredAt<to).reduce((sum,row)=>sum+number(row.totalAmount),0);
  const thisWeek=total(weekStart,tomorrow),previousWeek=total(previousStart,weekStart),weekChange=previousWeek?((thisWeek-previousWeek)/previousWeek)*100:null;
  const trend=Array.from({length:7},(_,index)=>{const date=addDays(weekStart,index),next=addDays(date,1);return{date:isoDate(date),amount:total(date,next)};});
  const pending=shifts.filter(row=>row.status==='RECONCILIATION_REQUIRED'),open=shifts.filter(row=>row.status==='OPEN');
  const cashVariance=reconciliations.reduce((sum,reconciliation)=>sum+reconciliation.collections.reduce((lineTotal,line)=>lineTotal+number(line.varianceAmount),0),0);
  const overdueReceivables=report.customers.reduce((sum,row)=>sum+row.ageing.days31to60+row.ageing.days61to90+row.ageing.days90plus,0);
  const lowStock=report.inventory.filter(row=>row.quantity<=0);
  const actions=[
    ...(pending.length?[{id:'reconciliation',severity:'HIGH',title:`${pending.length} shift${pending.length===1?'':'s'} waiting for reconciliation`,detail:'Review expected and actual collections, then lock the shift.',href:'/reconciliation'}]:[]),
    ...(report.payables.some(row=>row.overdue)?[{id:'payables',severity:'HIGH',title:`${report.payables.filter(row=>row.overdue).length} overdue supplier invoice${report.payables.filter(row=>row.overdue).length===1?'':'s'}`,detail:`${new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(report.payables.filter(row=>row.overdue).reduce((sum,row)=>sum+row.outstanding,0))} needs payment attention.`,href:'/purchases'}]:[]),
    ...(overdueReceivables>0?[{id:'receivables',severity:'MEDIUM',title:'Customer credit is ageing',detail:`₹${Math.round(overdueReceivables).toLocaleString('en-IN')} has been outstanding for more than 30 days.`,href:'/customers'}]:[]),
    ...(lowStock.length?[{id:'stock',severity:'MEDIUM',title:`${lowStock.length} stock position${lowStock.length===1?'':'s'} at zero or below`,detail:`Check ${lowStock.slice(0,3).map(row=>row.product).join(', ')} before the next shift.`,href:'/inventory'}]:[]),
  ];
  const stationHealth=report.stations.map(station=>{const stationSales=report.sales.byStation.find(row=>row.key===station.id);const stationOpen=open.filter(row=>row.station.id===station.id).length;const stationPending=pending.filter(row=>row.station.id===station.id).length;const stationLow=lowStock.filter(row=>row.key.startsWith(`${station.id}:`)).length;return{id:station.id,name:station.name,code:station.code,sales:stationSales?.amount??0,transactions:stationSales?.transactions??0,openShifts:stationOpen,pendingReconciliations:stationPending,stockAlerts:stationLow,status:stationPending||stationLow?'ATTENTION':stationOpen?'RUNNING':'CALM'};});
  const tankStocks=tanks.filter(tank=>['MS','HSD'].includes(tank.product.code)).map(tank=>{
    const bookStock=number(tank.openingStock)+tank.inventoryLedger.reduce((sum,row)=>sum+number(row.quantityDelta),0);
    const workingCapacity=number(tank.workingCapacity);
    const fillPercent=workingCapacity>0?Math.max(0,Math.min(100,bookStock/workingCapacity*100)):0;
    const latestReading=tank.physicalReadings[0],latestDensity=tank.densityReadings[0];
    return{
      id:tank.id,code:tank.code,product:tank.product.name,productCode:tank.product.code,unit:tank.product.unit,
      station:tank.configuration.station,bookStock,workingCapacity,fillPercent,sellingPrice:number(effectivePriceAt(tank.product.sellingPrice,tank.product.sellingPriceHistory,now)),density:latestDensity?number(latestDensity.density):null,densityRecordedAt:latestDensity?.recordedAt.toISOString()??null,
      physicalStock:latestReading?number(latestReading.physicalStock):null,
      physicalReadingAt:latestReading?.recordedAt.toISOString()??null,
      status:bookStock<=0?'EMPTY':fillPercent<=20?'LOW':'HEALTHY' as 'EMPTY'|'LOW'|'HEALTHY',
    };
  });
  return{asOf:now.toISOString(),today:report.summary,collections:report.sales.byPayment,topProducts:report.sales.byProduct.slice(0,5),trend:{days:trend,thisWeek,previousWeek,weekChange},operations:{openShifts:open.length,pendingReconciliations:pending.length,cashVariance},actions,stationHealth,tankStocks};
}
