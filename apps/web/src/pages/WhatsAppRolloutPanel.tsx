import { useEffect, useState } from 'react';
import { api, ApiRequestError, type PlatformCustomer, type WhatsAppRolloutPolicy, type WhatsAppRolloutSnapshot } from '../lib/api';

const stages = { SHADOW: 'Shadow', INTERNAL: 'Internal test', PILOT: 'Owner pilot', EXPANDED: 'Expanded delivery' };
const auditLabels: Record<string, string> = { SET_ROLLOUT: 'Delivery settings saved', PAUSE_ALL: 'All WhatsApp delivery paused', APPROVE_MESSAGE: 'Message preview approved' };
const labels = {
  LOW_STOCK: 'Low stock', SHIFT_CLOSED_SUMMARY: 'Shift summaries', PURCHASE_RECEIPT_SUMMARY: 'Receipt summaries',
  OVERDUE_CUSTOMER: 'Owner credit report', DAILY_SUMMARY: 'Core daily summary', CUSTOMER_CREDIT_REMINDER: 'Customer reminders',
  SYSTEM_TEST: 'Transport tests',
};

export function WhatsAppRolloutPanel({ customers }: { customers: PlatformCustomer[] }) {
  const [snapshot, setSnapshot] = useState<WhatsAppRolloutSnapshot>();
  const [draft, setDraft] = useState<WhatsAppRolloutPolicy>();
  const [busy, setBusy] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => {
    const result = await api.whatsappRollout();
    setSnapshot(result);
    setDraft(result.policy);
  };
  useEffect(() => { void refresh().catch(() => setError('Unable to load WhatsApp rollout.')); }, []);
  async function act(run: () => Promise<string>) {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await run()); await refresh(); }
    catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : 'Unable to update WhatsApp rollout.'); }
    finally { setBusy(false); }
  }
  async function pause() {
    setPausing(true); setError(''); setMessage('');
    try {
      const { policy } = await api.pauseWhatsAppRollout();
      setSnapshot(previous => previous && { ...previous, policy });
      setDraft(policy);
      setMessage('WhatsApp delivery paused. Queued messages and history are still available.');
    } catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : 'Unable to pause WhatsApp delivery.'); }
    finally { setPausing(false); }
  }
  const toggle = (field: 'organizationIds' | 'enabledCategories', value: string) => {
    setDraft(current => current && { ...current, [field]: current[field].includes(value)
      ? current[field].filter(item => item !== value) : [...current[field], value] });
  };
  return <section className="leads-list" aria-label="WhatsApp rollout">
    <header><div><h2>WhatsApp rollout</h2><p>{snapshot
      ? `${stages[snapshot.policy.stage]} · ${snapshot.policy.paused || snapshot.policy.stage === 'SHADOW' ? 'Sending paused' : 'Sending permitted for approved messages'}`
      : 'Delivery controls and message previews'}</p></div>
      <button type="button" className="secondary small" disabled={pausing} onClick={() => void pause()}>{pausing ? 'Pausing…' : 'Pause all WhatsApp'}</button>
    </header>
    <div className="admin-whatsapp-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {draft && <form onSubmit={event => { event.preventDefault(); void act(async () => { await api.saveWhatsAppRollout(draft); return 'Delivery settings saved.'; }); }}>
        <label className="field"><span>Rollout stage</span><select value={draft.stage} onChange={event => {
          const stage = event.target.value as WhatsAppRolloutPolicy['stage'];
          setDraft({ ...draft, stage, paused: true });
        }}>{Object.entries(stages).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <fieldset><legend>Owner accounts</legend>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {customers.filter(account => account.notificationSettings.whatsappOptedIn || draft.organizationIds.includes(account.id)).map(account => <label key={account.id} className="check">
              <input type="checkbox" checked={draft.organizationIds.includes(account.id)} onChange={() => toggle('organizationIds', account.id)} />{account.name}
            </label>)}
            {!customers.some(account => account.notificationSettings.whatsappOptedIn) && <p>No opted-in owner accounts on this list.</p>}
          </div>
        </fieldset>
        <fieldset><legend>Delivery categories</legend>
          {Object.entries(labels).map(([value, label]) => <label key={value} className="check">
            <input type="checkbox" checked={draft.enabledCategories.includes(value)} onChange={() => toggle('enabledCategories', value)} />{label}
          </label>)}
        </fieldset>
        <label className="check"><input type="checkbox" checked={draft.paused} onChange={event => setDraft({ ...draft, paused: event.target.checked })} />Pause all WhatsApp sending</label>
        <button className="secondary small" disabled={busy || pausing}>Save delivery settings</button>
      </form>}
      <div className="admin-whatsapp-action">
        <button type="button" className="secondary small" disabled={busy} onClick={() => void act(async () => {
          await api.generateWhatsAppPreviews(); return 'Review the latest previews under each owner account.';
        })}>Generate previews</button>
        <button type="button" className="secondary small" disabled={busy || pausing || !snapshot || snapshot.policy.paused || snapshot.policy.stage === 'SHADOW'} onClick={() => void act(async () => {
          const result = await api.processApprovedWhatsApp();
          return `${result.accepted} accepted · ${result.failed} failed · ${result.deferred} held · ${result.suppressed} suppressed`;
        })}>Process approved messages</button>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void act(async () => 'Delivery results refreshed.')}>Refresh results</button>
      </div>
      {snapshot && <details><summary>Delivery outcomes in the last 24 hours</summary>
        {snapshot.outcomes.length ? <ul>{snapshot.outcomes.map(outcome => {
          const reason = outcome.rolloutHold ?? outcome.suppressionReason ?? outcome.failureKind;
          return <li key={JSON.stringify(outcome)}>{outcome.count} {outcome.status.toLowerCase()}{reason && ` · ${reason.toLowerCase().replaceAll('_', ' ')}`}</li>;
        })}</ul> : <p>No delivery jobs in this period.</p>}
      </details>}
      {snapshot && snapshot.audit.length > 0 && <details><summary>Recent rollout activity</summary>
        <ul>{snapshot.audit.map(item => <li key={item.id}>{auditLabels[item.action]} · {new Date(item.createdAt).toLocaleString('en-IN')}</li>)}</ul>
      </details>}
    </div>
  </section>;
}
