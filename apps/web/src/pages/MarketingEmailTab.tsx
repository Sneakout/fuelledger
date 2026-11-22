import { useEffect, useState } from 'react';
import { Eye, Mail, RefreshCw } from 'lucide-react';
import { api, ApiRequestError, type DemoFollowUpState } from '../lib/api';
import { DemoFollowUpPanel } from './DemoFollowUpPanel';
import './demo-follow-up.css';
export function MarketingEmailTab() {
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<DemoFollowUpState[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError('');
    try { setHistory((await api.marketingEmails()).emails); }
    catch (e) { setError(e instanceof ApiRequestError ? e.message : 'Unable to load recent introductions. Please try again.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <section className="marketing-workspace">
    <header><span className="eyebrow">One useful introduction</span><h2>Start a conversation with FuelNerve</h2><p>Introduce a potential customer to fuel business automation and specialist AI agents. Enter one email address, review the branded message, then choose when to send.</p></header>
    <form onSubmit={e => { e.preventDefault(); setSelected(email.trim().toLowerCase()); }} className="marketing-compose">
      <label htmlFor="marketing-recipient">Potential customer’s email <span aria-hidden="true">*</span><input id="marketing-recipient" type="email" required maxLength={254} autoComplete="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)}/></label>
      <button className="primary" type="submit"><Eye size={18}/>Preview introduction</button>
      <small>Preparing a preview does not send an email. Each address receives at most one introduction, including demo follow-ups. Existing owners use their account emails instead.</small>
    </form>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="marketing-history-heading"><h3>Recent introductions</h3><button className="secondary small" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16}/>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    <p className="demo-followup-note">Latest 20 manually prepared introductions. Uncertain sending results are held for review to prevent duplicates.</p>
    {!loading && !history.length && <p className="demo-followup-note">No introductions prepared yet. Start with an email address above.</p>}
    {history.map(item => <article className="marketing-history-row" key={item.id}><Mail size={20}/><div><strong>{item.destination}</strong><small>{item.status === 'ACCEPTED' ? 'Accepted by email service' : item.status === 'UNKNOWN' ? 'Delivery review needed' : item.status === 'PENDING' ? 'Preview prepared' : item.status.replaceAll('_', ' ').toLowerCase()} · {new Date(item.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></div><button className="secondary small" onClick={() => setSelected(item.destination)}>View email</button></article>)}
    {selected && <DemoFollowUpPanel key={selected} email={selected} onClose={() => { setSelected(''); void refresh(); }} onUpdated={state => setHistory(current => [state, ...current.filter(item => item.id !== state.id)].slice(0, 20))}/>}
  </section>;
}
