import { useState } from 'react';
import { MessageCircleMore } from 'lucide-react';
import { ApiRequestError, api, type CustomerReminderDraft, type CustomerReminderPreferences, type CustomerReminderProfileResponse } from '../lib/api';
import { whatsappReason, whatsappStatus } from './NotificationsPage';

const timestamp = (value: string) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export function CustomerReminderPanel({ customerId, stations }: { customerId: string; stations: Array<{ id: string; name: string }> }) {
  const [data, setData] = useState<CustomerReminderProfileResponse>();
  const [form, setForm] = useState<CustomerReminderPreferences>({ destination: '', consentSource: '', recordConsent: false, revokeConsent: false, paused: false });
  const [stationId, setStationId] = useState(stations[0]?.id ?? '');
  const [draft, setDraft] = useState<CustomerReminderDraft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function act(run: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); }
    catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : 'Unable to update the customer reminder.'); }
    finally { setBusy(false); }
  }
  async function load() {
    const result = await api.customerReminderProfile(customerId);
    setData(result);
    setForm({ destination: result.profile.reminderWhatsAppNumber ?? '', consentSource: '', recordConsent: false, revokeConsent: false, paused: result.profile.reminderPaused });
  }
  function edit<K extends keyof CustomerReminderPreferences>(field: K, value: CustomerReminderPreferences[K]) {
    setForm(current => ({ ...current, [field]: value }));
    setDraft(undefined);
  }
  const profile = data?.profile;
  const changed = Boolean(profile && (form.destination !== (profile.reminderWhatsAppNumber ?? '') || form.recordConsent || form.revokeConsent || form.paused !== profile.reminderPaused));
  return <details className="customer-reminder-panel" onToggle={event => {
    if (event.currentTarget.open && !data && !busy) void act(load);
  }}>
    <summary><MessageCircleMore size={18} /> <b>WhatsApp payment reminders</b></summary>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="success-banner" role="status">{notice}</p>}
    {profile && data ? <>
      <div className="form-grid">
        <label className="field"><span>Customer WhatsApp number</span><input type="tel" value={form.destination} placeholder="+91 98765 43210" onChange={event => edit('destination', event.target.value)} /></label>
        <label className="notification-consent"><input type="checkbox" checked={form.paused} onChange={event => edit('paused', event.target.checked)} /><span>Pause reminders for this customer</span></label>
      </div>
      <p>{profile.reminderConsentAt ? `Consent recorded ${timestamp(profile.reminderConsentAt)} · ${profile.reminderConsentSource}` : 'Customer consent has not been recorded.'}</p>
      {form.destination !== (profile.reminderWhatsAppNumber ?? '') && <p>Changing the number requires consent for the new number.</p>}
      <label className="notification-consent"><input type="checkbox" checked={form.recordConsent} onChange={event => {
        setForm(current => ({ ...current, recordConsent: event.target.checked, revokeConsent: false })); setDraft(undefined);
      }} /><span>The customer agreed to WhatsApp payment reminders on this number</span></label>
      {form.recordConsent && <label className="field"><span>How they consented</span><input value={form.consentSource} maxLength={200} placeholder="For example, account agreement" onChange={event => edit('consentSource', event.target.value)} /></label>}
      {profile.reminderConsentAt && !form.recordConsent && <label className="notification-consent"><input type="checkbox" checked={form.revokeConsent} onChange={event => edit('revokeConsent', event.target.checked)} /><span>Withdraw recorded consent</span></label>}
      <div className="editor-footer"><button type="button" className="secondary" disabled={!changed || busy} onClick={() => void act(async () => {
        await api.saveCustomerReminderProfile(customerId, form); await load(); setNotice('Reminder preferences saved.');
      })}>Save reminder preferences</button></div>
      <div className="form-grid">
        <label className="field"><span>Fuel station</span><select value={stationId} onChange={event => { setStationId(event.target.value); setDraft(undefined); }}>
          {stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={busy || changed || !stationId || profile.reminderPaused || !profile.reminderConsentAt} onClick={() => void act(async () => {
          setDraft(undefined); setDraft((await api.previewCustomerReminder(customerId, stationId)).draft);
        })}>Preview reminder</button>
      </div>
      {draft && <div className="customer-reminder-preview">
        <b>Review before queuing</b><p>To +{draft.destination}</p><p>{draft.preview}</p>
        <button type="button" className="primary small" disabled={busy || changed} onClick={() => void act(async () => {
          try {
            const delivery = await api.approveCustomerReminder(customerId, draft.stationId, draft.snapshot);
            setNotice(delivery.status === 'PENDING' ? 'Reminder queued. The balance and consent will be checked again before sending.' : `Reminder status · ${whatsappStatus(delivery.status)}`);
            await load();
          } finally { setDraft(undefined); }
        })}>Approve and queue reminder</button>
      </div>}
      <div className="history-head"><h3>Reminder history</h3><button type="button" className="secondary small" disabled={busy || changed} onClick={() => void act(load)}>Refresh</button></div>
      {data.history.length ? <ul className="customer-reminder-history">{data.history.map(item => <li key={item.id}>
        <b>{whatsappStatus(item.status)}</b><span>{item.station?.name ?? 'Fuel station'} · {timestamp(item.createdAt)}</span>
        {item.failureKind === 'UNCERTAIN' ? <small>Delivery could not be confirmed.</small> : item.suppressionReason && <small>{whatsappReason(item.suppressionReason)}</small>}
      </li>)}</ul> : <p>No reminder history yet.</p>}
    </> : !error && <p>Loading reminder preferences…</p>}
  </details>;
}
