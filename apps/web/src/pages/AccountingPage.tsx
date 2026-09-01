import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Landmark, Scale } from 'lucide-react';
import { api, ApiRequestError, type AccountingBootstrap } from '../lib/api';
import { useStation } from '../components/StationProvider';

const money = (value: number | string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value));

export function AccountingPage() {
  const { selectedStationId } = useStation();
  const [data, setData] = useState<AccountingBootstrap | null>(null);
  const [open, setOpen] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setData(null); void api.accountingBootstrap(selectedStationId || undefined).then(setData).catch(item => setError(item instanceof ApiRequestError ? item.message : 'Unable to load accounting.')); }, [selectedStationId]);
  const groups = useMemo(() => data ? ['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE'].map(type => ({ type, accounts: data.accounts.filter(account => account.type === type) })).filter(group => group.accounts.length) : [], [data]);
  if (!data) return <main className="page"><div className="loading"><span/><p>Preparing the accounting ledger…</p></div></main>;
  const balanced = Math.abs(data.trial.debit - data.trial.credit) < .01;
  return <main className="page accounting-page">
    <div className="page-heading"><div><span className="eyebrow">Accounting engine</span><h1>Every operational fact has a balanced trail</h1><p>Journals are created automatically and remain linked to the original transaction.</p></div><span className={balanced ? 'accounting-proof' : 'accounting-proof problem'}>{balanced ? <CheckCircle2 size={16}/> : <Scale size={16}/>}<span><b>{balanced ? 'Books balanced' : 'Needs review'}</b><small>Dr {money(data.trial.debit)} · Cr {money(data.trial.credit)}</small></span></span></div>
    {error && <div className="form-error">{error}</div>}
    <section className="accounting-hero"><div><span><Landmark/></span><div><small>Chart of accounts</small><b>{data.accounts.length}</b><p>Cash, receivables, inventory, payables, revenue, COGS, and expenses.</p></div></div><div><span><BookOpenCheck/></span><div><small>Posted journals</small><b>{data.journals.length}</b><p>Each source can post only one immutable journal.</p></div></div></section>
    <section className="accounting-layout"><div className="trial-section"><div className="history-head"><div><span className="eyebrow">Trial balance</span><h2>Account balances</h2></div><Scale size={18}/></div>{groups.map(group => <div className="account-group" key={group.type}><h3>{group.type.toLowerCase()}</h3>{group.accounts.map(account => <div key={account.id}><span><b>{account.code}</b><strong>{account.name}</strong></span><span><small>Dr {money(account.debit)} · Cr {money(account.credit)}</small><b>{money(account.balance)}</b></span></div>)}</div>)}</div>
      <div className="journal-section"><div className="history-head"><div><span className="eyebrow">Audit journal</span><h2>Latest postings</h2></div><ClipboardList size={18}/></div>{data.journals.map(journal => { const expanded = open === journal.id; return <article key={journal.id}><button onClick={() => setOpen(expanded ? '' : journal.id)}><span className="journal-mark"><BookOpenCheck size={16}/></span><span><strong>{journal.description}</strong><small>{new Date(journal.journalDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {journal.reference} · {journal.sourceType.replace('_', ' ')}</small></span>{expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button>{expanded && <div className="journal-lines">{journal.lines.map(line => <div key={line.id}><span><b>{line.account.code}</b> {line.account.name}</span><span>{Number(line.debit) ? `Dr ${money(line.debit)}` : `Cr ${money(line.credit)}`}</span></div>)}</div>}</article>; })}{!data.journals.length && <p className="history-empty">New operational activity will post here automatically.</p>}</div>
    </section>
  </main>;
}
