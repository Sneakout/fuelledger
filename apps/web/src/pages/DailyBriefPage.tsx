import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Bell, Check, ChevronDown, CircleAlert, RefreshCw, Send, Sparkles } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { useStation } from '../components/StationProvider';
import { api, ApiRequestError, type AskFuelNerveResponse, type BriefFinding, type BriefRecordLink, type DailyBriefWorkspaceResponse } from '../lib/api';
import { formatIndiaCalendarDate } from '../lib/india-time';
import '../daily-brief.css';

const time = (value: string) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const day = (value: string) => formatIndiaCalendarDate(value, { day: 'numeric', month: 'short', year: 'numeric' });
const currency = (value: number) => value.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
const errorText = (error: unknown, message: string) => error instanceof ApiRequestError ? error.message : message;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="brief-section" aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</section>;
}

function Evidence({ records }: { records: BriefRecordLink[] }) {
  return records.length > 0 && <div className="brief-records">{records.map((item, index) =>
    <Link key={`${item.path}:${index}`} to={item.path} aria-label={`View record: ${item.label}`}><span>{item.label}</span><ArrowRight size={14} aria-hidden="true" /></Link>
  )}</div>;
}

function FindingCard({ item, demo, busy, onAction }: {
  item: BriefFinding; demo: boolean; busy: boolean; onAction(action: 'ACKNOWLEDGE' | 'REMIND_LATER'): void;
}) {
  return <article className="brief-finding" data-severity={item.severity}>
    <div className="brief-finding-head"><div><p className="brief-meta">{item.agent} · {item.insufficient ? 'Insufficient records' : item.severity === 'URGENT' ? 'Urgent' : 'Needs review'}</p><h3>{item.title}</h3></div>{item.amount && <strong>{item.amount}</strong>}</div>
    <p>{item.impact}</p><p><b>Next step</b> {item.action}</p>
    <Evidence records={item.records} />
    <footer><span>Checked {time(item.checkedAt)}{item.acknowledgedAt ? ' · Acknowledged' : ''}</span>
      {!demo && <div>
        {!item.acknowledgedAt && <button className="secondary small" type="button" disabled={busy} onClick={() => onAction('ACKNOWLEDGE')}><Check size={15} /> Acknowledge</button>}
        <button className="secondary small" type="button" disabled={busy} onClick={() => onAction('REMIND_LATER')}><Bell size={15} /> Remind later</button>
      </div>}
    </footer>
  </article>;
}

export function DailyBriefPage() {
  const { user } = useAuth();
  const { selectedStationId, stations, selectStation, loading } = useStation();
  if (user?.role !== 'OWNER') return <Navigate to="/" replace />;
  return <main className="page daily-brief">{selectedStationId
    ? <Workspace key={selectedStationId} stationId={selectedStationId} stationNames={stations} selectStation={selectStation} />
    : <div className="brief-section"><h1>Daily Brief</h1><p>{loading ? 'Loading fuel stations…' : 'Set up a fuel station to open its Daily Brief.'}</p></div>}</main>;
}

function Workspace({ stationId, stationNames, selectStation }: {
  stationId: string; stationNames: Array<{ id: string; name: string }>; selectStation(id: string): void;
}) {
  const [data, setData] = useState<DailyBriefWorkspaceResponse>();
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(Date.now);
  const [busy, setBusy] = useState<string>();
  const request = useRef(0);
  const saving = useRef(false);
  const refresh = useCallback(async () => {
    const generation = ++request.current;
    setRefreshing(true); setError('');
    try {
      const result = await api.dailyBriefWorkspace(stationId);
      if (generation === request.current) { setData(result); setTick(Date.now()); }
    } catch (caught) {
      if (generation === request.current) setError(errorText(caught, 'The Daily Brief could not be refreshed.'));
    } finally {
      if (generation === request.current) setRefreshing(false);
    }
  }, [stationId]);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);

  const staleAt = data ? Date.parse(data.checkedAt) + 15 * 60_000 : Infinity;
  useEffect(() => {
    if (!Number.isFinite(staleAt) || staleAt <= tick) return;
    const timer = setTimeout(() => setTick(Date.now()), Math.max(0, staleAt - Date.now()));
    return () => clearTimeout(timer);
  }, [staleAt, tick]);

  const nextReminder = data?.attention.reduce((earliest, item) => {
    const at = Date.parse(item.remindAt ?? '');
    return at > tick ? Math.min(earliest, at) : earliest;
  }, Infinity) ?? Infinity;
  useEffect(() => {
    if (!Number.isFinite(nextReminder)) return;
    const timer = setTimeout(() => { setTick(Date.now()); void refresh(); }, Math.max(0, nextReminder - Date.now()));
    return () => clearTimeout(timer);
  }, [nextReminder, refresh]);

  async function act(item: BriefFinding, action: 'ACKNOWLEDGE' | 'REMIND_LATER') {
    if (saving.current) return;
    saving.current = true;
    setBusy(item.key); setError(''); setNotice('');
    try {
      const preference = await api.setDailyBriefPreference({ stationId, findingKey: item.key, action });
      setData(current => current ? { ...current, attention: current.attention.map(row => row.key === item.key ? { ...row, ...preference } : row) } : current);
      setTick(Date.now());
      setNotice(action === 'ACKNOWLEDGE' ? 'Acknowledged. The finding remains open.' : 'Reminder set. This will return to your brief in four hours if it is still open.');
    } catch (caught) { setError(errorText(caught, 'The finding could not be updated.')); }
    finally { saving.current = false; setBusy(undefined); }
  }
  const snoozed = data?.attention.filter(item => Date.parse(item.remindAt ?? '') > tick) ?? [];
  const attention = data?.attention.filter(item => !(Date.parse(item.remindAt ?? '') > tick)) ?? [];
  const gaps = data?.coverage.gaps ?? [];
  const limited = Boolean(data && (gaps.length || data.coverage.incompleteShifts || data.coverage.collectionsIncomplete || data.coverage.stockUnavailable || data.coverage.noSales));

  return <>
    <header className="brief-hero"><div><p className="eyebrow brief-meta">FuelNerve Intelligence</p><h1>Daily Brief</h1>
      {data && <><p className="brief-station-date">{data.station.name} · {day(data.date)}</p><small>Records checked {time(data.checkedAt)} IST</small></>}
    </div><div className="brief-controls">
      {data && !data.demo && <a className="secondary" href="#brief-ask"><Sparkles size={16} />Ask FuelNerve</a>}
      <label><span>Fuel station</span><select value={stationId} onChange={event => selectStation(event.target.value)}>{stationNames.map(station => <option value={station.id} key={station.id}>{station.name}</option>)}</select></label>
      <button type="button" className="secondary" disabled={refreshing || Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={16} className={refreshing ? 'brief-refreshing' : ''} />{refreshing ? 'Checking records…' : 'Refresh'}</button>
    </div></header>

    {error && <p className="form-error" role="alert">{error}{data && ' Showing the last successful check.'}</p>}
    {tick >= staleAt && !error && <p className="brief-coverage">This brief was checked at least 15 minutes ago. Refresh to see the latest records.</p>}
    <div className="brief-status" role="status">{notice || (refreshing && data ? 'Checking for changes…' : '')}</div>
    {!data && refreshing && <p role="status">Loading the daily brief…</p>}
    {data && <div className="brief-content" aria-busy={refreshing}>
      <Section id="brief-attention" title="Needs your attention">
        {limited && <aside className="brief-coverage">
          <CircleAlert size={20} aria-hidden="true" />
          <div><strong>Some records are incomplete</strong>
            {data.coverage.incompleteShifts > 0 && <p>{data.coverage.incompleteShifts} open or unreconciled shift{data.coverage.incompleteShifts === 1 ? '' : 's'}. Collections are provisional.</p>}
            {data.coverage.noSales && <p>No live sales records are available for this day.</p>}
            {data.coverage.collectionsIncomplete && !data.coverage.incompleteShifts && <p>Some collection records could not be verified.</p>}
            {data.coverage.stockUnavailable && <p>Some tank stock checks are unavailable.</p>}
            {gaps.map(gap => <details key={gap.productId}><summary>{gap.productCode} · {gap.missingDates.length} missing DSR day{gap.missingDates.length === 1 ? '' : 's'} · {day(gap.missingFrom)} to {day(gap.missingThrough)}</summary>
              <ul className="brief-dates">{gap.missingDates.map(date => <li key={date}>{day(date)}</li>)}</ul>
              <Link to={gap.path}>Open the sales register <ArrowRight size={14} /></Link>
            </details>)}
          </div>
        </aside>}
        {attention.length ? <div className="brief-findings">{attention.map(item => <FindingCard key={item.key} item={item} demo={data.demo} busy={Boolean(busy || refreshing)} onAction={action => void act(item, action)} />)}</div>
          : !snoozed.length && <p>{limited ? 'The available records do not support an all-clear.' : 'No open issue found in the records checked.'}</p>}
        {snoozed.length > 0 && <details className="brief-details"><summary>Remind later · {snoozed.length} still open <ChevronDown size={16} /></summary>
          {snoozed.map(item => <article className="brief-row" key={item.key}><div><b>{item.title}</b><p>Returns {time(item.remindAt!)} IST</p></div><Evidence records={item.records.slice(0, 1)} /></article>)}
        </details>}
      </Section>

      <Section id="brief-summary" title="Daily operating summary">
        <dl className="brief-metrics">
          <div><dt>Recorded sales</dt><dd>{data.coverage.noSales ? 'No records' : currency(data.summary.sales)}</dd><small>{data.summary.products.map(item => `${item.code} ${item.volume}`).join(' · ')}</small></div>
          <div><dt>Reconciled collections</dt><dd>{data.summary.collections === null ? 'Awaiting records' : currency(data.summary.collections)}</dd><small>{data.coverage.collectionsIncomplete || data.coverage.incompleteShifts ? 'Provisional total' : 'Actual cash and digital collections'}</small></div>
          <div><dt>Outstanding customer credit</dt><dd>{currency(data.summary.credit)}</dd><small>{currency(data.summary.creditIssued)} issued today{data.summary.creditHasMissingDueDates ? " · Some charges have no due date" : ""}</small></div>
        </dl>
        <div className="brief-columns">
          <div><h3>Stock received</h3>{data.summary.receipts.length ? data.summary.receipts.map(item => <article className="brief-row" key={item.id}><div><b>{item.title}</b><p>{item.detail || 'No receipt lines recorded'}</p></div><Link to={item.path}>View record <ArrowRight size={14}/></Link></article>) : <p>No deliveries recorded today.</p>}</div>
          <div><h3>Tank book stock</h3>{data.summary.stock.length ? data.summary.stock.map(item => <article className="brief-row" key={item.id}><div><b>{item.title}</b><p>{item.value}</p></div><Link to={item.path}>View record <ArrowRight size={14}/></Link></article>) : <p>No active tank records available.</p>}</div>
        </div>
      </Section>

      <Section id="brief-approvals" title="Approvals waiting">
        {data.approvals.length ? data.approvals.map(item => <article className="brief-row" key={item.id}><div><b>{item.title}</b><p>{item.reason}</p><small>{item.requester} · {time(item.requestedAt)}</small></div><Link to={item.path}>Review decision <ArrowRight size={14} /></Link></article>) : <p>No pending decisions for this fuel station.</p>}
        <Link to="/approvals">Open Approvals <ArrowRight size={14}/></Link>
      </Section>

      <Section id="brief-specialists" title="Specialist reviews">
        <div className="brief-specialists">{data.specialists.map(agent => <details key={agent.key} className="brief-details">
          <summary><span><b>{agent.name}</b><small>{agent.checkedAt ? `Checked ${time(agent.checkedAt)}` : 'No recent completed review'}</small></span><span>{agent.findings.length || ''} <ChevronDown size={16}/></span></summary>
          <div>{agent.findings.length ? agent.findings.map(item => <article className="brief-review" key={item.id}>
            <h3>{item.title}</h3>{(typeof item.amount === 'string' || typeof item.amount === 'number') && <strong>{item.amount}</strong>}<p>{item.impact}</p><p>{item.action}</p>
            <Evidence records={item.records} /><small>Checked {time(item.checkedAt)}</small>
          </article>) : <p>{!agent.checkedAt ? 'Insufficient review records for this specialist.' : limited ? 'No issue found in this review. Some station records are incomplete.' : 'No issue found in the last completed review.'}</p>}
          <Link to={`/insights/${agent.key}`}>Open specialist <ArrowRight size={14}/></Link></div>
        </details>)}</div>
      </Section>

      <Section id="brief-upcoming" title="Upcoming">
        <p className="brief-meta">Overdue and due within seven days</p>
        <div className="brief-columns">
          {([['Supplier dues', data.upcoming.suppliers], ['Customer dues', data.upcoming.customers]] as const).map(([label, rows]) => <div key={label}><h3>{label}</h3>
            {rows.length ? rows.map(item => <article className="brief-row" key={item.id}><div><b>{item.title}</b><p>{item.amount} · {item.dueDate < data.date ? 'Overdue since' : 'Due'} {day(item.dueDate)}{item.disputed ? ' · Disputed' : ''}</p></div><Link to={item.path}>View record <ArrowRight size={14}/></Link></article>) : <p>No dated balances in this window.</p>}
          </div>)}
        </div>
        <h3>Replenishment</h3>
        {data.upcoming.replenishment.length ? data.upcoming.replenishment.map(item => <article className="brief-row" key={item.id}><div><b>{item.title}</b><p>{item.value} in book stock. Check delivery coverage.</p></div><Link to={item.path}>View record <ArrowRight size={14}/></Link></article>)
          : <p>{data.summary.stock.length && !data.coverage.stockUnavailable ? 'No tanks are below the configured threshold.' : 'Insufficient stock records to assess replenishment.'}</p>}
      </Section>

      <Section id="brief-resolved" title="Resolved">
        {data.resolved.length ? data.resolved.map(item => <article className="brief-row brief-resolved" key={item.id}><div><b>{item.title}</b><p>{item.detail}</p><small>Closed {time(item.closedAt)} IST</small></div><Link to={item.path}>View record <ArrowRight size={14}/></Link></article>) : <p>No recorded closures in the last seven days.</p>}
      </Section>
      <AskBrief key={data.date} data={data} />
    </div>}
  </>;
}

function AskBrief({ data }: { data: DailyBriefWorkspaceResponse }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskFuelNerveResponse>();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (asking || question.trim().length < 3) return;
    setAsking(true); setError(''); setResult(undefined);
    try { setResult(await api.askFuelNerve({ requestId: crypto.randomUUID(), stationId: data.station.id, asOf: data.checkedAt, question: question.trim() })); }
    catch (caught) { setError(errorText(caught, 'FuelNerve could not answer this question.')); }
    finally { setAsking(false); }
  }
  return <Section id="brief-ask" title="Ask FuelNerve">
    <p>Ask about {data.station.name} using records checked {time(data.checkedAt)} IST.</p>
    {!data.demo && <form className="brief-ask" onSubmit={event => void submit(event)}>
      <label className="field"><span>Your question</span><input value={question} onChange={event => setQuestion(event.target.value)} maxLength={300} placeholder="Which balances need attention?" /></label>
      <button className="primary small" disabled={asking || question.trim().length < 3}><Send size={16} /> {asking ? 'Checking records…' : 'Ask'}</button>
    </form>}
    {data.demo && <p>Ask is available from an active Intelligence account.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <article className="brief-answer" aria-live="polite"><h3><Sparkles size={17} />{result.answer.title}</h3>
      <p>{result.answer.explanation}</p><p>{result.answer.action}</p>
      {result.missingInformation?.map(item => <p key={item}>{item}</p>)}
      {result.answer.facts.map(fact => <article className="brief-review" key={fact.id}><b>{fact.label} · {fact.value}</b><p>{fact.context}</p><Evidence records={[{ label: fact.evidenceLabel, path: fact.evidencePath }]} /></article>)}
    </article>}
  </Section>;
}
