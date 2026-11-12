import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Activity, ArrowLeft, CalendarDays, Gauge, Info, RefreshCw, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStation } from '../components/StationProvider';
import { api, ApiRequestError, type SalesHistory } from '../lib/api';
import { addIndiaDays, formatIndiaCalendarDate, indiaDate } from '../lib/india-time';

type Fuel = 'MS' | 'HSD';
type Day = { date: string; MS: { litres: number; revenue: number; transactions: number }; HSD: { litres: number; revenue: number; transactions: number } };
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const litres = (value: number) => `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value)} L`;
const rate = (revenue: number, volume: number) => volume > 0 ? `${money(revenue / volume)}/L` : '—';
const percent = (value: number) => `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value)}%`;
const fuel = (row: SalesHistory['daily'][number]): Fuel | null => {
  const code = row.code.toUpperCase().replaceAll(/[^A-Z0-9]/g, '');
  const name = row.product.toUpperCase();
  if (code === 'MS' || name.includes('MOTOR SPIRIT')) return 'MS';
  if (code.startsWith('HSD') || name.includes('HIGH SPEED DIESEL')) return 'HSD';
  return null;
};
const calendar = (start: string, end: string) => { const result: string[] = []; if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return result; for (let date = start; date <= end && result.length < 3_660; date = addIndiaDays(date, 1)) result.push(date); return result; };

export function SalesHistoryPage() {
  const { stations, selectedStationId, selectStation } = useStation();
  const today = indiaDate();
  const [startDate, setStartDate] = useState(addIndiaDays(today, -29));
  const [endDate, setEndDate] = useState(today);
  const [stationId, setStationId] = useState(selectedStationId);
  const [data, setData] = useState<SalesHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  useEffect(() => setStationId(selectedStationId), [selectedStationId]);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData(await api.salesHistory({ startDate, endDate, ...(stationId ? { stationId } : {}) })); } catch (item) { setError(item instanceof ApiRequestError ? item.message : 'Unable to load sales history.'); } finally { setLoading(false); } }, [startDate, endDate, stationId]);
  useEffect(() => { void load(); }, [load]);
  const days = useMemo<Day[]>(() => {
    const values = new Map(calendar(startDate, endDate).map(date => [date, { date, MS: { litres: 0, revenue: 0, transactions: 0 }, HSD: { litres: 0, revenue: 0, transactions: 0 } } satisfies Day]));
    for (const row of data?.daily ?? []) { const kind = fuel(row), day = values.get(row.date); if (!kind || !day) continue; day[kind].litres += row.quantity; day[kind].revenue += row.revenue; day[kind].transactions += row.transactions; }
    return [...values.values()];
  }, [data, startDate, endDate]);
  const totals = useMemo(() => ({
    MS: days.reduce((sum, day) => ({ litres: sum.litres + day.MS.litres, revenue: sum.revenue + day.MS.revenue }), { litres: 0, revenue: 0 }),
    HSD: days.reduce((sum, day) => ({ litres: sum.litres + day.HSD.litres, revenue: sum.revenue + day.HSD.revenue }), { litres: 0, revenue: 0 }),
  }), [days]);
  const context = useMemo(() => {
    const active = days.filter(day => day.MS.litres + day.HSD.litres > 0 || day.MS.revenue + day.HSD.revenue > 0);
    const best = active.reduce<Day | null>((winner, day) => !winner || day.MS.revenue + day.HSD.revenue > winner.MS.revenue + winner.HSD.revenue ? day : winner, null);
    const combinedLitres = totals.MS.litres + totals.HSD.litres;
    return {
      active,
      best,
      averageVolume: active.length ? combinedLitres / active.length : 0,
      msShare: combinedLitres ? totals.MS.litres / combinedLitres * 100 : 0,
      hsdShare: combinedLitres ? totals.HSD.litres / combinedLitres * 100 : 0,
      firstRecorded: active[0]?.date ?? null,
    };
  }, [days, totals]);
  const defaultIndex = context.active.length ? days.findIndex(day => day.date === context.active.at(-1)?.date) : Math.max(0, days.length - 1);
  const selectedIndex = Math.min(Math.max(hoverIndex ?? defaultIndex, 0), Math.max(0, days.length - 1));
  const selectedDay = days[selectedIndex] ?? null;
  const previousDay = selectedIndex > 0 ? days[selectedIndex - 1] : null;
  const selectedRevenue = selectedDay ? selectedDay.MS.revenue + selectedDay.HSD.revenue : 0;
  const previousRevenue = previousDay ? previousDay.MS.revenue + previousDay.HSD.revenue : 0;
  const dayChange = previousRevenue > 0 ? (selectedRevenue - previousRevenue) / previousRevenue * 100 : null;
  const preset = (count: number) => { setEndDate(today); setStartDate(addIndiaDays(today, -(count - 1))); };
  return <main className="page sales-history-page">
    <Link className="back-link" to="/"><ArrowLeft/> Back to dashboard</Link>
    <div className="page-heading"><div><span className="eyebrow">Historical fuel sales</span><h1>MS and HSD sales over time</h1><p>Compare daily litres and sales value using India business dates.</p></div></div>
    <section className="sales-history-filter"><div className="sales-history-presets"><button onClick={() => preset(7)}>7 days</button><button onClick={() => preset(30)}>30 days</button><button onClick={() => preset(90)}>90 days</button></div><div className="sales-history-fields"><CalendarDays/><label>From<input type="date" value={startDate} max={endDate} onChange={event => setStartDate(event.target.value)}/></label><label>To<input type="date" value={endDate} min={startDate} max={today} onChange={event => setEndDate(event.target.value)}/></label><label>Fuel station<select value={stationId} onChange={event => { setStationId(event.target.value); selectStation(event.target.value); }}><option value="">All permitted fuel stations</option>{stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label><button className="primary small" onClick={() => void load()} disabled={loading}><RefreshCw/> {loading ? 'Loading…' : 'Refresh'}</button></div></section>
    {error && <div className="form-error">{error}</div>}
    {loading && !data ? <div className="loading"><span/><p>Preparing fuel sales trends…</p></div> : <>
      <section className="fuel-history-summary"><article className="ms"><span>MS</span><div><small>Total volume</small><b>{litres(totals.MS.litres)}</b></div><div><small>Sales value</small><b>{money(totals.MS.revenue)}</b></div><div><small>Average realised rate</small><b>{rate(totals.MS.revenue,totals.MS.litres)}</b></div></article><article className="hsd"><span>HSD</span><div><small>Total volume</small><b>{litres(totals.HSD.litres)}</b></div><div><small>Sales value</small><b>{money(totals.HSD.revenue)}</b></div><div><small>Average realised rate</small><b>{rate(totals.HSD.revenue,totals.HSD.litres)}</b></div></article></section>
      <section className="fuel-history-insights"><article><Activity/><span><small>Active sales days</small><b>{context.active.length} of {days.length}</b><em>Days with recorded MS or HSD sales</em></span></article><article><TrendingUp/><span><small>Best sales day</small><b>{context.best?money(context.best.MS.revenue+context.best.HSD.revenue):'—'}</b><em>{context.best?formatIndiaCalendarDate(context.best.date,{weekday:'short',day:'numeric',month:'short'}):'No recorded sales'}</em></span></article><article><Gauge/><span><small>Average active-day volume</small><b>{litres(context.averageVolume)}</b><em>MS and HSD combined</em></span></article><article className="mix"><span><small>Volume mix</small><b>MS {percent(context.msShare)} · HSD {percent(context.hsdShare)}</b><i><u style={{width:`${context.msShare}%`}}/><u style={{width:`${context.hsdShare}%`}}/></i></span></article></section>
      {context.firstRecorded&&context.firstRecorded>startDate&&<div className="fuel-data-note"><Info/><span><b>Recorded sales begin on {formatIndiaCalendarDate(context.firstRecorded,{day:'numeric',month:'long',year:'numeric'})}.</b> Dates before this have no recorded MS or HSD transactions; they should not automatically be treated as confirmed zero-sales days.</span></div>}
      {selectedDay&&<section className="fuel-hover-summary" aria-live="polite"><header><span><small>Selected date</small><b>{formatIndiaCalendarDate(selectedDay.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</b></span><em className={dayChange===null?'neutral':dayChange>=0?'up':'down'}>{dayChange===null?'No prior-day comparison':`${dayChange>=0?'+':''}${percent(dayChange)} vs previous day`}</em></header><div><span className="ms"><small>MS volume</small><b>{litres(selectedDay.MS.litres)}</b><em>{money(selectedDay.MS.revenue)} · {rate(selectedDay.MS.revenue,selectedDay.MS.litres)} · {selectedDay.MS.transactions} sale{selectedDay.MS.transactions===1?'':'s'}</em></span><span className="hsd"><small>HSD volume</small><b>{litres(selectedDay.HSD.litres)}</b><em>{money(selectedDay.HSD.revenue)} · {rate(selectedDay.HSD.revenue,selectedDay.HSD.litres)} · {selectedDay.HSD.transactions} sale{selectedDay.HSD.transactions===1?'':'s'}</em></span><span><small>Combined volume</small><b>{litres(selectedDay.MS.litres+selectedDay.HSD.litres)}</b><em>{selectedDay.MS.transactions+selectedDay.HSD.transactions} recorded transactions</em></span><span><small>Total sales value</small><b>{money(selectedRevenue)}</b><em>Recorded for this business day</em></span></div></section>}
      <section className="fuel-chart-grid"><TrendChart title="Daily volume" subtitle="Litres sold" days={days} metric="litres" selectedIndex={selectedIndex} onHover={setHoverIndex}/><TrendChart title="Daily sales value" subtitle="Rupees" days={days} metric="revenue" selectedIndex={selectedIndex} onHover={setHoverIndex}/></section>
      <section className="fuel-day-list"><header><div><span className="eyebrow">Date-wise details</span><h2>Every day in the selected period</h2></div><b>{formatIndiaCalendarDate(startDate,{day:'numeric',month:'short'})} – {formatIndiaCalendarDate(endDate,{day:'numeric',month:'short',year:'numeric'})}</b></header><div className="fuel-day-head"><span>Date</span><span>MS litres</span><span>MS sales</span><span>HSD litres</span><span>HSD sales</span><span>Total sales</span></div>{[...days].reverse().map(day => <div className="fuel-day-row" key={day.date}><span><b>{formatIndiaCalendarDate(day.date,{weekday:'short'})}</b><small>{formatIndiaCalendarDate(day.date,{day:'numeric',month:'short',year:'numeric'})}</small></span><span>{litres(day.MS.litres)}</span><span>{money(day.MS.revenue)}</span><span>{litres(day.HSD.litres)}</span><span>{money(day.HSD.revenue)}</span><strong>{money(day.MS.revenue + day.HSD.revenue)}</strong></div>)}</section>
    </>}
  </main>;
}

function TrendChart({ title, subtitle, days, metric, selectedIndex, onHover }: { title: string; subtitle: string; days: Day[]; metric: 'litres' | 'revenue'; selectedIndex: number; onHover(index: number): void }) {
  const width = 900, height = 250, padX = 70, padTop = 20, padBottom = 34;
  const values = days.flatMap(day => [day.MS[metric], day.HSD[metric]]), high = Math.max(...values, 1);
  const x = (index: number) => days.length <= 1 ? width / 2 : padX + index * ((width - padX * 2) / (days.length - 1));
  const y = (value: number) => padTop + (height - padTop - padBottom) * (1 - value / high);
  const path = (kind: Fuel) => days.map((day, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(day[kind][metric]).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  const move = (event: PointerEvent<SVGSVGElement>) => { if (!days.length) return; const bounds=event.currentTarget.getBoundingClientRect();const viewX=(event.clientX-bounds.left)/Math.max(bounds.width,1)*width;const index=days.length<=1?0:Math.round((viewX-padX)/(width-padX*2)*(days.length-1));onHover(Math.min(days.length-1,Math.max(0,index))); };
  const keys = (event: KeyboardEvent<SVGSVGElement>) => { if(event.key==='ArrowLeft'){event.preventDefault();onHover(Math.max(0,selectedIndex-1));}if(event.key==='ArrowRight'){event.preventDefault();onHover(Math.min(days.length-1,selectedIndex+1));} };
  const compact=(value:number)=>metric==='litres'?`${new Intl.NumberFormat('en-IN',{notation:'compact',maximumFractionDigits:1}).format(value)} L`:new Intl.NumberFormat('en-IN',{notation:'compact',style:'currency',currency:'INR',maximumFractionDigits:1}).format(value);
  return <article className="fuel-trend-card"><header><div><span className="eyebrow">{subtitle}</span><h2>{title}</h2></div><div className="fuel-legend"><span className="ms">MS</span><span className="hsd">HSD</span></div></header><p className="fuel-chart-hint">Move across the graph for exact daily values. Use ← and → when focused.</p><div className="fuel-svg-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} for MS and HSD`} tabIndex={0} onPointerMove={move} onKeyDown={keys}>{[0,.5,1].map(part=><g key={part}><line x1={padX} y1={y(high*part)} x2={width-padX} y2={y(high*part)} className="grid-line"/><text x={padX-7} y={y(high*part)+4} textAnchor="end" className="axis-label">{compact(high*part)}</text></g>)}<path d={path('MS')} className="ms-line"/><path d={path('HSD')} className="hsd-line"/>{days.length>0&&<line x1={x(selectedIndex)} y1={padTop} x2={x(selectedIndex)} y2={height-padBottom} className="hover-line"/>}{days.map((day,index) => <g key={day.date} data-selected={index===selectedIndex}><circle cx={x(index)} cy={y(day.MS[metric])} r={index===selectedIndex?'7':'4'} className="ms-dot"><title>{day.date}: MS {metric === 'litres' ? litres(day.MS.litres) : money(day.MS.revenue)}</title></circle><circle cx={x(index)} cy={y(day.HSD[metric])} r={index===selectedIndex?'7':'4'} className="hsd-dot"><title>{day.date}: HSD {metric === 'litres' ? litres(day.HSD.litres) : money(day.HSD.revenue)}</title></circle>{(index % labelEvery === 0 || index === days.length - 1) && <text x={x(index)} y={height-10} textAnchor="middle">{formatIndiaCalendarDate(day.date,{day:'numeric',month:'short'})}</text>}</g>)}</svg></div></article>;
}
