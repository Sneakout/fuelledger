import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CheckCircle2, Clock3, Droplets, IndianRupee } from 'lucide-react';
import type { YesterdayPerformance as Performance } from '../lib/api';
import { formatIndiaCalendarDate, formatIndiaDateTime } from '../lib/india-time';
import './yesterday-performance.css';
const amount = (value: number | null) => value === null ? '—' : value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const volume = (value: number | null) => value === null ? '—' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
export function YesterdayPerformance({ performance: p, openShifts }: { performance: Performance; openShifts: number }) {
 const empty = p.status === 'NO_DATA';
 const badge = p.status === 'REVIEW' ? 'Needs review' : p.pendingClosings ? 'Closing pending' : p.missingMorning ? 'DSR reading pending' : empty ? 'Not recorded yet' : `${p.closedShifts ? `${p.closedShifts} shift${p.closedShifts === 1 ? '' : 's'} closed` : 'Confirmed records'}`;
 const period = (start: string, end: string | null) => `${formatIndiaDateTime(start)} → ${end ? formatIndiaDateTime(end) : 'Closing pending'}${end ? ' IST' : ''}`;
 return <section className="yesterday-performance" aria-labelledby="yesterday-title">
  <header><div><span className="eyebrow">A clear view of the day</span><h2 id="yesterday-title">Yesterday’s performance</h2><p>{formatIndiaCalendarDate(p.date, { weekday: 'long', day: 'numeric', month: 'long' })} · Based on your recorded shift times</p></div><span className={`yesterday-status ${p.status.toLowerCase()}`}>{p.status === 'RECORDED' ? <CheckCircle2 size={14}/> : <Clock3 size={14}/>} {badge}</span></header>
  <div className="yesterday-period"><Clock3 size={15}/><span>{p.periods.length === 1 ? period(p.periods[0]!.start, p.periods[0]!.end) : p.periods.length > 1 ? 'Each station follows its own recorded shift window' : p.historicalProducts ? 'Confirmed DSR · morning-to-morning records' : 'Your saved shifts and daily records will appear here'}</span></div>
  <div className="owner-kpis">
   <article><span className="green"><IndianRupee/></span><div><small>Sales</small><b>{amount(p.sales)}</b><em>{empty ? 'Awaiting yesterday’s records' : p.sales === null && (p.meteredVolume ?? 0) > 0 ? 'Selling price needed for DSR sales' : p.status === 'PENDING' ? 'Recorded so far · day incomplete' : 'Closed shifts, DSR & counter sales'}</em></div></article>
   <article><span className="blue"><Banknote/></span><div><small>Verified collections</small><b>{amount(p.collected)}</b><em>{empty ? 'Available after records are saved' : p.collected === null && (p.verifiedCollected ?? 0) > 0 ? `${amount(p.verifiedCollected)} verified · remainder pending` : p.collectionsReason}</em></div></article>
   <article><span className="violet"><Droplets/></span><div><small>Litres sold</small><b>{volume(p.meteredVolume)}</b><em>{empty ? 'Opening and closing readings needed' : p.pendingClosings ? 'Final volume awaits closing' : p.missingMorning ? 'Next DSR morning reading needed' : 'Metered sales · testing excluded'}</em></div></article>
   <article><span className={(p.netProfit ?? 0) < 0 ? 'amber' : 'green'}><IndianRupee/></span><div><small>{(p.netProfit ?? 0) < 0 ? 'Net loss' : 'Net profit'}</small><b className={(p.netProfit ?? 0) < 0 ? 'negative' : ''}>{amount(p.netProfit === null ? null : Math.abs(p.netProfit))}</b><em>{empty ? 'Available when sales and costs are recorded' : p.profitReason}</em></div></article>
  </div>
  <footer><Link to="/operations"><span className="today-shift-dot"/><strong>Right now</strong><span>{openShifts ? `${openShifts} shift${openShifts === 1 ? '' : 's'} running` : 'No shift currently open'}</span><ArrowRight size={14}/></Link>{p.pendingReconciliations > 0 && <Link to="/reconciliation"><Banknote size={14}/>{p.pendingReconciliations} awaiting reconciliation <ArrowRight size={14}/></Link>}</footer>
 </section>;
}
