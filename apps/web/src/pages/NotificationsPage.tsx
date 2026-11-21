import { useEffect, useState } from 'react';
import { ArrowRight, BellRing, Mail, Check, MessageCircleMore, TriangleAlert, BookOpen, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { ApiRequestError, api, type NotificationBootstrap, type NotificationDelivery, type NotificationSettings } from '../lib/api';

export const whatsappStatus = (status: NotificationDelivery['status']) => ({
  READ: 'Read', DELIVERED: 'Delivered', ACCEPTED: 'Accepted by WhatsApp', SENT: 'Accepted by WhatsApp',
  FAILED: 'Failed', PROCESSING: 'Processing', SUPPRESSED: 'Skipped', PENDING: 'Queued',
})[status];

const deliveryReasons: Record<string, string> = {
  customer_paused: 'Reminders are paused for this customer.',
  customer_consent_missing: 'Customer consent is missing or was withdrawn.',
  customer_balance_disputed: 'The customer has a disputed balance.',
  no_verified_overdue_balance: 'There is no verified overdue balance.',
  customer_balance_or_recipient_changed: 'The balance or recipient changed after preparation.',
  recent_customer_reminder: 'A recent or unconfirmed reminder already exists.',
  scheduled_policy_changed: 'The owner changed or paused the schedule.',
  template_not_approved: 'This message type is awaiting activation.',
  operational_delivery_not_enabled: 'WhatsApp delivery is awaiting activation.',
  category_disabled: 'This message type is turned off.',
  owner_not_opted_in: 'The owner has not opted in.',
  recipient_changed: 'The WhatsApp number changed after preparation.',
  source_changed: 'The underlying records changed after preparation.',
};
export function whatsappReason(reason: string | null) {
  return reason ? deliveryReasons[reason] ?? 'This message was skipped because it was no longer eligible.' : null;
}

function TimePicker({ label, value, onChange, disabled = false }: { label: string; value: number; disabled?: boolean; onChange: (hour: number) => void }) {
  return <label className="field"><span>{label}</span><select disabled={disabled} value={value} onChange={event => onChange(Number(event.target.value))}>
    {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00 IST</option>)}
  </select></label>;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const allowed = user?.role === 'OWNER' && !user.demoExpiresAt;
  const [data, setData] = useState<NotificationBootstrap>();
  const [settings, setSettings] = useState<NotificationSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changed = Boolean(settings && data && JSON.stringify(settings) !== JSON.stringify(data.settings));
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (changed) window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [changed]);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void api.notificationSettings().then(result => {
      if (active) { setData(result); setSettings(result.settings); }
    }).catch(() => { if (active) setError('Unable to load alert settings.'); });
    return () => { active = false; };
  }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    const refresh = () => { void api.ownerEmailStatus().then(result => {
      if (active) setData(current => current ? { ...current, emailStatus: result.emailStatus } : current);
    }).catch(() => { /* Keep the last verified state; saving remains available. */ }); };
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60_000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [allowed]);
  if (!allowed) return <main className="page"><p className="form-error">Only the owner can manage email and WhatsApp alerts.</p></main>;
  if (!data || !settings) return <main className="page">{error ? <div role="alert" className="form-error">{error} <button className="secondary small" onClick={() => { setError(''); void api.notificationSettings().then(result => { setData(result); setSettings(result.settings); }).catch(() => setError('Unable to load alert settings.')); }}>Try again</button></div> : <p>Loading alert settings…</p>}</main>;

  const edit = <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) =>
    { setNotice(''); setSettings(current => current ? { ...current, [key]: value } : current); }
  const choice = (key: 'emailEnabled' | 'whatsappOptedIn' | 'dailySummaryEnabled' | 'lowStockEnabled' | 'shiftSummaryEnabled' | 'receiptSummaryEnabled' | 'overdueCustomerEnabled' | 'customerReminderScheduled', title: string, detail?: string) =>
    <label className="notification-rule"><span className="notification-rule-icon" aria-hidden="true"><BellRing /></span><span className="notification-rule-copy"><b>{title}</b>{detail && <small>{detail}</small>}</span><input type="checkbox" disabled={busy} checked={Boolean(settings[key])} onChange={event => edit(key, event.target.checked)} /><i /></label>;

  async function act(run: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); }
    catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : 'Unable to update alert settings.'); }
    finally { setBusy(false); }
  }
  const savedOptIn = Boolean(data.settings.whatsappOptedIn && data.settings.whatsappNumber);
  const emailState = data.emailStatus?.state ?? (data.settings.emailEnabled ? 'SETUP' : 'OFF');
  const emailLabels = { OFF: 'Email updates are off', SETUP: 'Email updates are being set up', ACTIVE: 'Email updates are on', PAUSED: 'Email updates are paused' };
  const emailDetail = changed ? 'Save your changes to update your alert choices.' : emailState === 'SETUP' ? 'Your preferences are saved. We’re completing your setup; no further action is needed.' : emailState === 'ACTIVE' ? 'We’ll send your selected updates to your saved email address.' : emailState === 'PAUSED' ? 'Your preferences are saved. Contact support if you need help restarting updates.' : 'Turn on email updates and choose what you’d like to receive.';
  const nextSummary = data.emailStatus?.nextSummaryAt ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(data.emailStatus.nextSummaryAt)) : null;

  return <main className="page notifications-page">
    <section className="notification-hero"><div><p className="notification-eyebrow">YOUR FUEL STATION, CONNECTED</p><h1>Email &amp; WhatsApp alerts</h1><p>Useful updates, at the times you choose.</p><Link className="notification-guide" to="/help/guide"><BookOpen size={16} /> How alerts work</Link></div><span><MessageCircleMore /></span></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="success-banner" role="status">{notice}</p>}
    <section className="notification-setup">
      <header><div><span className="notification-icon"><Mail /></span><div><h2>Your email updates</h2><p>Receive updates at your sign-in email.</p></div></div><span className={emailState === 'ACTIVE' ? 'notification-ready' : 'notification-pending'}>{changed ? 'Unsaved changes' : emailLabels[emailState]}</span></header>
      <div className="notification-number"><label><span>Email address</span><input type="email" value={data.emailAddress ?? user?.email ?? ''} readOnly /></label>
        {choice('emailEnabled', 'Send me FuelNerve email updates', 'Receive the updates selected below. You can turn email off anytime.')}
      </div>
      <div className="notification-email-state"><p>{emailDetail}</p>{!changed && emailState === 'ACTIVE' && nextSummary && <p><b>Next daily summary</b> · {nextSummary} IST <small>Timing may vary by a few minutes.</small></p>}</div><p className="notification-delivery-note">From FuelNerve · hello@mindvector.tech. Email and WhatsApp are separate choices.</p>
    </section>
    <section className="notification-setup">
      <header><div><span className="notification-icon"><MessageCircleMore /></span><div><h2>Owner’s WhatsApp</h2><p>Use the country code when entering your number.</p></div></div>
        <span className={changed || !savedOptIn ? 'notification-pending' : 'notification-ready'}>{changed ? <><TriangleAlert /> Unsaved changes</> : savedOptIn ? <><Check /> Preferences saved</> : <><TriangleAlert /> Alerts off</>}</span>
      </header>
      <div className="notification-number">
        <label><span>WhatsApp number</span><input type="tel" value={settings.whatsappNumber ?? ''} placeholder="+91 98765 43210" disabled={busy} onChange={event => { setNotice(''); setSettings({ ...settings, whatsappNumber: event.target.value, whatsappOptedIn: false }); }} /></label>
        {choice('whatsappOptedIn', 'I agree to receive FuelNerve alerts on this WhatsApp number')}
      </div>
      <p className="notification-delivery-note">{changed ? 'Save your changes to update your WhatsApp number and alert choices.' : !savedOptIn ? 'Add your WhatsApp number and agree to receive alerts, then save your preferences.' : 'Your WhatsApp number and alert preferences are saved. You can update them anytime.'}</p>
    </section>
    <section className="notification-layout">
      <article className="notification-rules"><header><h2>Messages to the owner</h2><p>Choose your updates and preferred times. Customer reminders use WhatsApp only.</p></header>
        {(!data.intelligenceActive || settings.emailEnabled) && <>
          {choice('dailySummaryEnabled', 'Daily operating summary', data.intelligenceActive ? 'A daily email with sales quantities, collections and tank stock.' : 'Sales quantities, collections and tank stock by email and WhatsApp when enabled.')}
          <TimePicker disabled={busy} label="Daily summary time" value={settings.dailySummaryHour} onChange={hour => edit('dailySummaryHour', hour)} />
        </>}
        {data.intelligenceActive && <>
          {choice('lowStockEnabled', 'Low stock', 'A tank reaches your chosen stock threshold. Open the alert to review the balance.')}
          <label className="field"><span>Low-stock threshold (% of working capacity)</span><input disabled={busy} type="number" min="1" max="50" value={settings.lowStockPercent} onChange={event => edit('lowStockPercent', Number(event.target.value))} /></label>
          {choice('shiftSummaryEnabled', 'Shift closure summary', 'After reconciliation: litres sold, collections, any shortage or excess, and closing tank stock.')}
          {choice('receiptSummaryEnabled', 'Stock received', 'What arrived, which tank received it, invoice amount and supplier payment due date.')}
          {choice('overdueCustomerEnabled', 'Customer dues', 'Customers who owe you money, their balances and overdue days. Sent only when balances exist.')}
          <TimePicker disabled={busy} label="Credit report time" value={settings.creditReportHour} onChange={hour => edit('creditReportHour', hour)} />
        </>}
      </article>
      {data.intelligenceActive && <aside className="notification-thresholds">
        <h2>Customer payment reminders</h2>
        <p>Review and approve individual reminders from the customer profile. Customers must consent before receiving reminders.</p>
        {choice('customerReminderScheduled', 'Send scheduled reminders', 'Automatically remind eligible customers with verified overdue balances. A customer receives at most one reminder every seven days.')}
        {settings.customerReminderScheduled && <TimePicker disabled={busy} label="Scheduled reminder time" value={settings.customerReminderHour} onChange={hour => edit('customerReminderHour', hour)} />}
        <Link className="notification-action" to="/customers">Open customer accounts <ArrowRight size={16} aria-hidden="true" /></Link>
      </aside>}
    </section>
    <div className="editor-footer notification-save-bar"><span>{busy ? 'Saving your preferences…' : changed ? 'You have unsaved changes' : 'Your preferences are saved'}</span>
      <button type="button" className="primary small" disabled={busy} onClick={() => void act(async () => {
        const result = await api.updateNotificationSettings({ ...settings, whatsappNumber: settings.whatsappNumber ?? '', confirmNewNumber: settings.whatsappOptedIn });
        setSettings(result.settings);
        setData({ ...data, settings: result.settings, ...(result.emailStatus ? { emailStatus: result.emailStatus } : {}) });
        setNotice('Email and WhatsApp preferences saved.');
      })}>{busy ? 'Saving…' : 'Save preferences'}</button>
    </div>
  </main>;
}
