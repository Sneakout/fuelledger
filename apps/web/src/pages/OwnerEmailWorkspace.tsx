import { useState } from 'react';
import './owner-email-workspace.css';
import { Mail, RefreshCw, ChevronDown, Eye, Send, Info } from 'lucide-react';
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
  return <details className="owner-email-workspace" onToggle={event => { if (event.currentTarget.open && !data && !busy) void act(); }}>
    <summary className="owner-email-heading"><span className="owner-email-icon"><Mail size={20} /></span><span>Owner email updates<small>Prepare, preview and send owner updates</small></span><ChevronDown size={18} className="owner-email-chevron" /></summary>
    <div className="owner-email-body">
    <p className="owner-email-description">Updates go to the owner’s saved sign-in email, using their email preferences. Email is managed separately from WhatsApp.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && <p className="owner-email-readiness" data-ready={data.ready}>{data.ready ? 'Email sending enabled for this account.' : 'Email sending paused. Configure SMTP2GO and enable this account for the email pilot before sending.'}</p>}
    <div className="owner-email-actions"><button className="secondary small" disabled={busy} onClick={() => void act()}><RefreshCw size={16} />Refresh emails</button><button className="secondary small" disabled={busy} onClick={() => void act(() => api.prepareOwnerEmailWelcome(organizationId))}>Prepare welcome email</button></div>
    <p className="owner-email-guidance"><Info size={16} /><span>Accepted means the email service received the message. Check SMTP2GO for delivery or bounce details. Uncertain outcomes are held to prevent duplicates.</span></p>
    {data?.deliveries.length === 0 && <p>No emails prepared. The owner must enable email updates in their alert preferences.</p>}
    {data?.deliveries.map(job => <section className="owner-email-card" key={job.id}>
      <div className="owner-email-card-heading"><h3>{names[job.type] ?? job.type}</h3><span className="owner-email-status" data-status={job.status}>{job.status === 'ACCEPTED' ? 'Accepted by email service' : job.status === 'UNKNOWN' ? 'Outcome uncertain — check SMTP2GO' : job.status === 'PENDING' ? 'Ready to send' : job.status.charAt(0) + job.status.slice(1).toLowerCase()}</span></div>
      <p className="owner-email-meta"><span>{job.destination}</span><span>{new Date(job.createdAt).toLocaleString('en-IN')}</span><span>{job.attempts} {job.attempts === 1 ? 'attempt' : 'attempts'}</span></p>
      {(job.errorMessage || job.suppressionReason) && <p className="form-error">{job.errorMessage ?? job.suppressionReason?.replaceAll('_', ' ')}</p>}
      {job.providerMessageId && <p>SMTP2GO reference: {job.providerMessageId}</p>}
      <div className="owner-email-actions"><button className="secondary small" disabled={busy} onClick={() => void act(async () => setPreview(await api.previewOwnerEmail(organizationId, job.id)))}><Eye size={16} />Preview email</button>
        {job.status === 'FAILED' && <button className="secondary small" disabled={busy} onClick={() => void act(() => api.retryOwnerEmail(organizationId, job.id))}>Retry rejected email</button>}
        {job.status === 'PENDING' && <button className="primary small" disabled={busy || !data.ready} onClick={() => void act(() => api.processOwnerEmail(organizationId, job.id))}><Send size={16} />Send this email</button>}</div>
    </section>)}
    {preview && <section className="owner-email-preview"><h3>{preview.subject}</h3><button className="secondary small" onClick={() => setPreview(undefined)}>Close preview</button><iframe title="Owner email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 680, border: '1px solid #dbe8df', borderRadius: 16, marginTop: 16 }} /></section>}
    </div>
  </details>;
}
