import { useEffect, useState } from 'react';
import { ArrowRight, BellRing, Mail, Check, MessageCircleMore, TriangleAlert } from 'lucide-react';
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

function TimePicker({ label, value, onChange }: { label: string; value: number; onChange: (hour: number) => void }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={event => onChange(Number(event.target.value))}>
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
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void api.notificationSettings().then(result => {
      if (active) { setData(result); setSettings(result.settings); }
    }).catch(() => { if (active) setError('Unable to load alert settings.'); });
    return () => { active = false; };
  }, [allowed]);
  if (!allowed) return <main className="page"><p className="form-error">Only the owner can manage email and WhatsApp alerts.</p></main>;
  if (!data || !settings) return <main className="page">{error ? <p role="alert" className="form-error">{error}</p> : <p>Loading alert settings…</p>}</main>;

  const edit = <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) =>
    setSettings(current => current ? { ...current, [key]: value } : current);
  const choice = (key: 'emailEnabled' | 'whatsappOptedIn' | 'dailySummaryEnabled' | 'lowStockEnabled' | 'shiftSummaryEnabled' | 'receiptSummaryEnabled' | 'overdueCustomerEnabled' | 'customerReminderScheduled', title: string, detail?: string) =>
    <label className="notification-rule"><span className="notification-rule-icon" aria-hidden="true"><BellRing /></span><span className="notification-rule-copy"><b>{title}</b>{detail && <small>{detail}</small>}</span><input type="checkbox" checked={Boolean(settings[key])} onChange={event => edit(key, event.target.checked)} /><i /></label>;

  async function act(run: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); }
    catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : 'Unable to update alert settings.'); }
    finally { setBusy(false); }
  }
  const savedOptIn = Boolean(data.settings.whatsappOptedIn && data.settings.whatsappNumber);
  const changed = JSON.stringify(settings) !== JSON.stringify(data.settings);

  return <main className="page notifications-page">
    <section className="notification-hero"><div><h1>Email &amp; WhatsApp alerts</h1><p>Choose what FuelNerve sends to you and how customers receive payment reminders.</p></div><span><MessageCircleMore /></span></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="success-banner" role="status">{notice}</p>}
    <section className="notification-setup">
      <header><div><span className="notification-icon"><Mail /></span><div><h2>Owner’s email</h2><p>Receive FuelNerve updates at your sign-in email.</p></div></div></header>
      <div className="notification-number"><label><span>Email address</span><input type="email" value={data.emailAddress ?? user?.email ?? ''} readOnly /></label>
        {choice('emailEnabled', 'Send me FuelNerve email updates', 'A welcome email, followed by the updates selected below. You can turn email off anytime.')}
      </div>
      <p className="notification-delivery-note">Sent by FuelNerve from hello@mindvector.tech. Your email preference is independent of WhatsApp.</p>
    </section>
    <section className="notification-setup">
      <header><div><span className="notification-icon"><MessageCircleMore /></span><div><h2>Owner’s WhatsApp</h2><p>Use the country code when entering your number.</p></div></div>
        <span className={changed || !savedOptIn ? 'notification-pending' : 'notification-ready'}>{changed ? <><TriangleAlert /> Unsaved changes</> : savedOptIn ? <><Check /> Preferences saved</> : <><TriangleAlert /> Alerts off</>}</span>
      </header>
      <div className="notification-number">
        <label><span>WhatsApp number</span><input type="tel" value={settings.whatsappNumber ?? ''} placeholder="+91 98765 43210" onChange={event => setSettings({ ...settings, whatsappNumber: event.target.value, whatsappOptedIn: false })} /></label>
        {choice('whatsappOptedIn', 'I agree to receive FuelNerve alerts on this WhatsApp number')}
      </div>
      <p className="notification-delivery-note">{changed ? 'Save your changes to update your WhatsApp number and alert choices.' : !savedOptIn ? 'Add your WhatsApp number and agree to receive alerts, then save your preferences.' : 'Your WhatsApp number and alert preferences are saved. You can update them anytime.'}</p>
    </section>
    <section className="notification-layout">
      <article className="notification-rules"><header><h2>Messages to the owner</h2><p>Choose your updates and preferred times. Customer reminders use WhatsApp only.</p></header>
        {(!data.intelligenceActive || settings.emailEnabled) && <>
          {choice('dailySummaryEnabled', 'Daily operating summary', data.intelligenceActive ? 'A daily email with sales quantities, collections and tank stock.' : 'Sales quantities, collections and tank stock by email and WhatsApp when enabled.')}
          <TimePicker label="Daily summary time" value={settings.dailySummaryHour} onChange={hour => edit('dailySummaryHour', hour)} />
        </>}
        {data.intelligenceActive && <>
          {choice('lowStockEnabled', 'Low stock')}
          <label className="field"><span>Low-stock threshold (% of working capacity)</span><input type="number" min="1" max="50" value={settings.lowStockPercent} onChange={event => edit('lowStockPercent', Number(event.target.value))} /></label>
          {choice('shiftSummaryEnabled', 'Shift closure summary', 'Sales, collections, differences and closing tank stock.')}
          {choice('receiptSummaryEnabled', 'Purchase receipt summary', 'Product, tank, quantity, invoice and payment due date.')}
          {choice('overdueCustomerEnabled', 'Customer credit report', 'Sent when there are outstanding balances.')}
          <TimePicker label="Credit report time" value={settings.creditReportHour} onChange={hour => edit('creditReportHour', hour)} />
        </>}
      </article>
      {data.intelligenceActive && <aside className="notification-thresholds">
        <h2>Customer payment reminders</h2>
        <p>Review and approve individual reminders from the customer profile. Customers must consent before receiving reminders.</p>
        {choice('customerReminderScheduled', 'Send scheduled reminders', 'Automatically remind eligible customers with verified overdue balances. A customer receives at most one reminder every seven days.')}
        {settings.customerReminderScheduled && <TimePicker label="Scheduled reminder time" value={settings.customerReminderHour} onChange={hour => edit('customerReminderHour', hour)} />}
        <Link className="notification-action" to="/customers">Open customer accounts <ArrowRight size={16} aria-hidden="true" /></Link>
      </aside>}
    </section>
    <div className="editor-footer">
      <button type="button" className="primary small" disabled={busy} onClick={() => void act(async () => {
        const result = await api.updateNotificationSettings({ ...settings, whatsappNumber: settings.whatsappNumber ?? '', confirmNewNumber: settings.whatsappOptedIn });
        setSettings(result.settings);
        setData({ ...data, settings: result.settings });
        setNotice('Email and WhatsApp preferences saved.');
      })}>Save preferences</button>
    </div>
  </main>;
}
