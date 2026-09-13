import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStation } from '../components/StationProvider';
import { api, ApiRequestError, type ReportsBootstrap } from '../lib/api';
import { ReportLibrary } from './ReportsPage';

const today=()=>new Date().toLocaleDateString('en-CA');
const monthStart=()=>{const value=new Date();value.setDate(1);return value.toLocaleDateString('en-CA');};

export function DownloadReportsPage(){
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
    {loading&&!data?<div className="loading report-download-loading"><span/><p>Preparing your report library…</p></div>:data&&<ReportLibrary data={data} startDate={startDate} endDate={endDate}/>}
  </main>;
}
