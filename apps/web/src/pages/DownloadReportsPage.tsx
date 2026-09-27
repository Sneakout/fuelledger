import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCircle2, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStation } from '../components/StationProvider';
import { api, ApiRequestError, type ReportsBootstrap } from '../lib/api';
import { ReportLibrary } from './ReportsPage';
import { useAuth } from '../components/AuthProvider';
import { buildAccountingJournalCsv, buildTallyLedgerMastersXml, buildTallyVouchersXml, summariseAccountingEntries } from '../lib/accounting-export';

const today=()=>new Date().toLocaleDateString('en-CA');
const monthStart=()=>{const value=new Date();value.setDate(1);return value.toLocaleDateString('en-CA');};

export function DownloadReportsPage(){
  const {user}=useAuth();
  const {selectedStationId}=useStation();
  const [startDate,setStartDate]=useState(monthStart());
  const [endDate,setEndDate]=useState(today());
  const [stationId,setStationId]=useState(selectedStationId);
  const [data,setData]=useState<ReportsBootstrap|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{setData(await api.reportsBootstrap({startDate,endDate,...(stationId?{stationId}:{})}));}catch(item){setError(item instanceof ApiRequestError?item.message:'Unable to prepare report downloads.');}finally{setLoading(false);}},[startDate,endDate,stationId]);
  useEffect(()=>{void load();},[load]);
  return <main className="page reports-page download-reports-page">
    <Link className="back-link" to="/reports"><ArrowLeft/> Back to reports</Link>
    <div className="page-heading"><div><span className="eyebrow">Report downloads</span><h1>Download the records you need</h1><p>Select a period and fuel station before preparing a CSV or print-ready PDF.</p></div></div>
    <section className="report-filter download-filter"><div><CalendarDays/><label>From<input type="date" value={startDate} max={endDate} onChange={event=>setStartDate(event.target.value)}/></label><label>To<input type="date" value={endDate} min={startDate} onChange={event=>setEndDate(event.target.value)}/></label><label>Fuel station<select value={stationId} onChange={event=>setStationId(event.target.value)}><option value="">All permitted fuel stations</option>{data?.stations.map(station=><option key={station.id} value={station.id}>{station.name}</option>)}</select></label><button className="primary small" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> {loading?'Preparing…':'Prepare reports'}</button></div><small>Every downloaded report records this period, station scope and generation time.</small></section>
    {error&&<div className="form-error">{error}</div>}
    {loading&&!data?<div className="loading report-download-loading"><span/><p>Preparing your report library…</p></div>:data&&<><AccountingExports data={data} companyName={user?.organization.name??'FuelNerve'} startDate={startDate} endDate={endDate}/><ReportLibrary data={data} startDate={startDate} endDate={endDate}/></>}
  </main>;
}

function saveFile(contents:string,fileName:string,type:string){const blob=new Blob([contents],{type});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=fileName;link.click();URL.revokeObjectURL(link.href);}

function AccountingExports({data,companyName,startDate,endDate}:{data:ReportsBootstrap;companyName:string;startDate:string;endDate:string}){
  const entries=data.operations.accountingEntries;
  const summary=summariseAccountingEntries(entries);
  const suffix=`${startDate}-${endDate}`;
  const disabled=!entries.length||summary.unbalancedJournals>0;
  return <section className="accounting-export-card"><header><div><span className="eyebrow">Accounting software</span><h2>Export clean books to TallyPrime</h2><p>Prepared from posted, balanced FuelNerve journal entries for the selected period and fuel station.</p></div><span className={`accounting-balanced${summary.unbalancedJournals?' invalid':''}`}><CheckCircle2/> {summary.unbalancedJournals?'Review required':'Balanced'}</span></header><div className="accounting-export-summary"><span><b>{summary.journals}</b> vouchers</span><span><b>{summary.lines}</b> journal lines</span><span><b>{summary.accounts}</b> ledgers</span><span><b>₹{summary.debit.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</b> debit = credit</span></div><div className="accounting-export-actions"><article><FileSpreadsheet/><div><b>1. Ledger masters</b><small>Create FuelNerve accounts in Tally first.</small></div><button disabled={disabled} onClick={()=>saveFile(buildTallyLedgerMastersXml(companyName,entries),`fuelnerve-tally-ledgers-${suffix}.xml`,'application/xml;charset=utf-8')}><Download/> XML</button></article><article><FileSpreadsheet/><div><b>2. Journal vouchers</b><small>Import transactions after ledger masters.</small></div><button disabled={disabled} onClick={()=>saveFile(buildTallyVouchersXml(companyName,entries),`fuelnerve-tally-vouchers-${suffix}.xml`,'application/xml;charset=utf-8')}><Download/> XML</button></article><article><FileSpreadsheet/><div><b>Universal journal</b><small>CSV for an accountant or other software.</small></div><button disabled={disabled} onClick={()=>saveFile(buildAccountingJournalCsv(entries),`fuelnerve-accounting-journal-${suffix}.csv`,'text/csv;charset=utf-8')}><Download/> CSV</button></article></div><footer><b>Import order:</b> Back up the Tally company, import Masters first, then Transactions. Review Tally’s Exceptions report and Day Book before relying on the result.{!entries.length&&<em>No posted journals exist for this selection.</em>}{summary.unbalancedJournals>0&&<em>{summary.unbalancedJournals} unbalanced voucher{summary.unbalancedJournals===1?'':'s'} must be corrected before export.</em>}</footer></section>;
}
