import { useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { api, type OwnerEmailDelivery } from '../lib/api';

const names: Record<string, string> = { OWNER_WELCOME: 'Welcome', DAILY_SUMMARY: 'Daily summary', LOW_STOCK: 'Low stock', SHIFT_CLOSED_SUMMARY: 'Shift summary', PURCHASE_RECEIPT_SUMMARY: 'Receipt summary', OVERDUE_CUSTOMER: 'Credit report' };
export function OwnerEmailWorkspace({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<{ ready: boolean; deliveries: OwnerEmailDelivery[] }>();
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(action?: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action?.(); setData(await api.ownerEmailDeliveries(organizationId)); }
    catch { setError('Unable to update email messages. Please try again.'); }
    finally { setBusy(false); }
  }
  return <details className="notification-setup" onToggle={event => { if (event.currentTarget.open && !data && !busy) void act(); }}>
    <summary className="notification-action"><Mail size={18} /> Owner email updates</summary>
    <p>Email uses the owner’s saved sign-in email and email preference. It is independent of WhatsApp rollout.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && <p className="notification-delivery-note">{data.ready ? 'Email sending enabled for this account.' : 'Email sending paused. Configure SMTP2GO and enable this account for the email pilot before sending.'}</p>}
    <div className="rollout-actions"><button className="secondary small" disabled={busy} onClick={() => void act()}><RefreshCw size={16} />Refresh emails</button><button className="secondary small" disabled={busy} onClick={() => void act(() => api.prepareOwnerEmailWelcome(organizationId))}>Prepare welcome email</button></div>
    <p>Accepted means SMTP2GO accepted the email. Check SMTP2GO for delivery or bounce details. Uncertain outcomes are held to prevent duplicates.</p>
    {data?.deliveries.length === 0 && <p>No emails prepared. The owner must enable email updates in their alert preferences.</p>}
    {data?.deliveries.map(job => <article className="notification-rules" key={job.id}>
      <header><h3>{names[job.type] ?? job.type}</h3><span>{job.status === 'ACCEPTED' ? 'Accepted by email service' : job.status === 'UNKNOWN' ? 'Outcome uncertain — check SMTP2GO' : job.status.toLowerCase()}</span></header>
      <p>{job.destination} · {new Date(job.createdAt).toLocaleString('en-IN')} · {job.attempts} attempts</p>
      {(job.errorMessage || job.suppressionReason) && <p className="form-error">{job.errorMessage ?? job.suppressionReason?.replaceAll('_', ' ')}</p>}
      {job.providerMessageId && <p>SMTP2GO reference: {job.providerMessageId}</p>}
      <div className="rollout-actions"><button className="secondary small" disabled={busy} onClick={() => void act(async () => setPreview(await api.previewOwnerEmail(organizationId, job.id)))}>Preview email</button>
        {job.status === 'FAILED' && <button className="secondary small" disabled={busy} onClick={() => void act(() => api.retryOwnerEmail(organizationId, job.id))}>Retry rejected email</button>}
        {job.status === 'PENDING' && <button className="primary small" disabled={busy || !data.ready} onClick={() => void act(() => api.processOwnerEmail(organizationId, job.id))}>Send this email</button>}</div>
    </article>)}
    {preview && <section><h3>{preview.subject}</h3><button className="secondary small" onClick={() => setPreview(undefined)}>Close preview</button><iframe title="Owner email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 680, border: '1px solid #dbe8df', borderRadius: 16, marginTop: 16 }} /></section>}
  </details>;
}
