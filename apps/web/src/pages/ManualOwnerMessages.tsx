import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { api, ApiRequestError } from '../lib/api';

const categories = [
  ['OWNER_WELCOME', 'Welcome & sign-in details'], ['DAILY_SUMMARY', 'Daily operating summary · Core'],
  ['LOW_STOCK', 'Current low stock · Intelligence'], ['SHIFT_CLOSED_SUMMARY', 'Latest reconciled shift · Intelligence'],
  ['PURCHASE_RECEIPT_SUMMARY', 'Latest stock receipt · Intelligence'], ['OVERDUE_CUSTOMER', 'Current customer balances · Intelligence'],
];
type Preview = Awaited<ReturnType<typeof api.prepareManualMessage>>;
export function ManualOwnerMessages({ organizationId }: { organizationId: string }) {
  const [opened, setOpened] = useState(false);
  const [context, setContext] = useState<Awaited<ReturnType<typeof api.manualMessageContext>>>();
  const [stationId, setStationId] = useState('');
  const [type, setType] = useState('OWNER_WELCOME');
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!opened || context) return;
    let active = true;
    void api.manualMessageContext(organizationId).then(result => { if (active) { setContext(result); setStationId(result.stations[0]?.id ?? ''); setDate(result.today); } }).catch(() => { if (active) setError('Could not load fuel stations. Close and reopen this section to try again.'); });
    return () => { active = false; };
  }, [opened, context, organizationId]);
  const clear = () => { setPreview(undefined); setNotice(''); setError(''); };
  async function prepare(copy = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const fresh = await api.prepareManualMessage(organizationId, { stationId, type, date });
      setPreview(fresh);
      if (copy && preview) {
        if (fresh.body !== preview.body || fresh.destination !== preview.destination) {
          setNotice('Records or recipient changed. The preview has been updated. Review it, then copy again.');
        } else {
          try {
            await navigator.clipboard.writeText(fresh.body);
            setNotice('Message copied. Paste it into the owner’s WhatsApp chat and check the recipient before sending.');
          } catch {
            setNotice('Your browser blocked clipboard access. Select the message below and copy it with your keyboard. The records have been checked.');
          }
        }
      } else setNotice('Preview ready. Review the figures and destination before copying.');
    } catch (caught) { setPreview(undefined); setError(caught instanceof ApiRequestError ? caught.message : 'Could not prepare or copy this message. Please try again.'); }
    finally { setBusy(false); }
  }
  return <details className="wa-manual" open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Manual WhatsApp messages <span className="wa-manual-tag">Copy & share</span></summary>
    <p>Prepare an owner update from their real records, review it, then copy it into WhatsApp. This works independently of automated delivery.</p>
    {!context ? <p role="status">{opened ? 'Loading fuel stations…' : ''}</p> : <>
      <div className="wa-manual-fields">
        <label className="field"><span>Fuel station</span><select disabled={busy} value={stationId} onChange={event => { clear(); setStationId(event.target.value); }}>{context.stations.map(station => <option value={station.id} key={station.id}>{station.name}</option>)}</select></label>
        <label className="field"><span>Message</span><select disabled={busy} value={type} onChange={event => { clear(); setType(event.target.value); }}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {type === 'DAILY_SUMMARY' && <label className="field"><span>Report date</span><input type="date" max={context.today} value={date} disabled={busy} onChange={event => { clear(); setDate(event.target.value); }}/></label>}
      </div>
      {['SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY'].includes(type) && <p>The latest qualifying record is used. Check its date in the preview before sharing.</p>}
      <button className="secondary small" disabled={busy || !stationId || !date} onClick={() => void prepare()}><RefreshCw size={16}/>{busy ? 'Checking records…' : preview ? 'Refresh preview' : 'Prepare message'}</button>
      {preview && <section className="wa-message wa-manual-preview">
        <header><h4>Review your message</h4><span className="rollout-status">Manual sharing only</span></header>
        <p><strong>{preview.ownerName} · +{preview.destination}</strong><br/>{preview.stationName} · Checked {new Date(preview.checkedAt).toLocaleString('en-IN')}</p>
        {preview.warnings.map(warning => <p className="wa-feedback" key={warning}>{warning}</p>)}
        <textarea aria-label="Manual WhatsApp message" onFocus={event => event.currentTarget.select()} readOnly value={preview.body} rows={12}/>
        <button className="primary small" disabled={busy} onClick={() => void prepare(true)}><Copy size={16}/>Copy message</button>
        <p className="wa-message-meta">Copying rechecks the current records, number and consent. Nothing is sent by FuelNerve, and automated delivery history is unchanged.</p>
      </section>}
    </>}
    {notice && <p className="wa-feedback" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </details>;
}
