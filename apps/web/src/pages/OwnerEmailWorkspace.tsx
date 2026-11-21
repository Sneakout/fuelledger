import { useEffect, useRef, useState } from 'react';
import './owner-email-workspace.css';
import { Mail, RefreshCw, ChevronDown, Eye, Send, Info, CheckCircle2, Pause, Play } from 'lucide-react';
import { api, type OwnerEmailDelivery, type OwnerEmailRecipient } from '../lib/api';

const names: Record<string, string> = { OWNER_WELCOME: 'Welcome', DAILY_SUMMARY: 'Daily summary', LOW_STOCK: 'Low stock', SHIFT_CLOSED_SUMMARY: 'Shift summary', PURCHASE_RECEIPT_SUMMARY: 'Receipt summary', OVERDUE_CUSTOMER: 'Credit report' };
export function OwnerEmailWorkspace({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<{ ready: boolean; recipients?: OwnerEmailRecipient[]; deliveries: OwnerEmailDelivery[] }>();
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string; job?: OwnerEmailDelivery }>();
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => { if (preview) { previewRef.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth', block: 'start' }); previewRef.current?.focus({ preventScroll: true }); } }, [preview]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function act(action?: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action?.(); setData(await api.ownerEmailDeliveries(organizationId)); }
    catch { setError('Unable to update email messages. Please try again.'); }
    finally { setBusy(false); }
  }
  return <details className="owner-email-workspace" onToggle={event => { if (event.currentTarget.open && !data && !busy) void act(); }}>
    <summary className="owner-email-heading"><span className="owner-email-icon"><Mail size={20} /></span><span>Owner email updates<small>Welcome owners and manage email updates</small></span><ChevronDown size={18} className="owner-email-chevron" /></summary>
    <div className="owner-email-body">
    <p className="owner-email-description">Send a welcome to start the owner’s selected email updates. Check their destination and preview the message first. Email and WhatsApp are managed separately.</p>
    {notice && <p className="success-banner" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && <p className="owner-email-readiness" data-ready={data.ready}>{data.ready ? 'Sending connection ready.' : 'Email sending is paused. Check the sending connection and global email switch before sending.'}</p>}
    {data?.recipients?.map(recipient => <section className="owner-email-onboarding" key={recipient.ownerId}>
      <div className="owner-email-card-heading"><div><p className="owner-email-eyebrow">OWNER EMAIL SETUP</p><h3>{recipient.ownerName}</h3><p className="owner-email-destination">{recipient.destination}</p></div><span className="owner-email-status" data-status={recipient.state === 'ACTIVE' ? 'ACCEPTED' : recipient.state}>{recipient.state === 'ACTIVE' ? 'Updates active' : recipient.adminPaused ? 'Updates paused' : recipient.welcomeStatus === 'ACCEPTED' ? 'Welcome sent · setup incomplete' : recipient.welcomeStatus === 'UNKNOWN' ? 'Checking send outcome' : recipient.welcomeStatus === 'FAILED' ? 'Needs attention' : recipient.welcomeStatus === 'PROCESSING' ? 'Sending welcome…' : 'Welcome not sent'}</span></div>
      {recipient.state === 'ACTIVE' ? <p><CheckCircle2 size={16} /> Your selected email updates are active. {recipient.activatedAt && `Welcome sent ${new Date(recipient.activatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`}</p> : <p>{recipient.blocker}</p>}
      {recipient.welcomeStatus !== 'ACCEPTED' && <p className="owner-email-guidance">Preview the welcome first. Sending it starts the owner’s enabled email updates once all setup checks pass. Past shifts and receipts will not be replayed.</p>}
      <div className="owner-email-actions">
      {!['ACCEPTED', 'UNKNOWN', 'PROCESSING'].includes(recipient.welcomeStatus ?? '') && <button className="primary small" disabled={busy || !recipient.consent || !data.ready || recipient.adminPaused} onClick={() => void act(async () => {
        await api.prepareOwnerEmailWelcome(organizationId, recipient.ownerId);
        const current = await api.ownerEmailDeliveries(organizationId);
        const welcomeId = current.recipients?.find(owner => owner.ownerId === recipient.ownerId)?.welcomeId;
        const welcome = current.deliveries.find(job => welcomeId ? job.id === welcomeId : !current.recipients && job.type === 'OWNER_WELCOME' && job.destination === recipient.destination);
        if (!welcome) throw new Error('Welcome unavailable');
        setPreview({ ...await api.previewOwnerEmail(organizationId, welcome.id), job: welcome });
      })}><Eye size={16} />Preview welcome</button>}
      {recipient.welcomeStatus === 'ACCEPTED' && <button className="secondary small" disabled={busy} onClick={() => void act(() => api.pauseOwnerEmails(organizationId, recipient.ownerId, !recipient.adminPaused))}>{recipient.adminPaused ? <Play size={16} /> : <Pause size={16} />}{recipient.adminPaused ? 'Resume email updates' : 'Pause email updates'}</button>}
      </div>
    </section>)}
    <div className="owner-email-actions"><button className="secondary small" disabled={busy} onClick={() => void act()}><RefreshCw size={16} />{busy ? 'Updating…' : 'Refresh emails'}</button>{!data?.recipients && <button className="secondary small" disabled={busy} onClick={() => void act(() => api.prepareOwnerEmailWelcome(organizationId))}>Prepare welcome email</button>}</div>
    <p className="owner-email-guidance"><Info size={16} /><span>Accepted means the email service received the message. Check SMTP2GO for delivery or bounce details. Uncertain outcomes are held to prevent duplicates.</span></p>
    {data?.deliveries.length === 0 && <p>No emails prepared yet. Start with Preview welcome above.</p>}
    {data?.deliveries.map(job => <section className="owner-email-card" key={job.id}>
      <div className="owner-email-card-heading"><h3>{names[job.type] ?? job.type}</h3><span className="owner-email-status" data-status={job.status}>{job.status === 'ACCEPTED' ? 'Accepted by email service' : job.status === 'UNKNOWN' ? 'Outcome uncertain — check SMTP2GO' : job.status === 'PENDING' ? 'Ready to send' : job.status.charAt(0) + job.status.slice(1).toLowerCase()}</span></div>
      <p className="owner-email-meta"><span>{job.destination}</span><span>{new Date(job.createdAt).toLocaleString('en-IN')}</span><span>{job.attempts} {job.attempts === 1 ? 'attempt' : 'attempts'}</span></p>
      {(job.errorMessage || job.suppressionReason) && <p className="form-error">{job.errorMessage ?? job.suppressionReason?.replaceAll('_', ' ')}</p>}
      {job.providerMessageId && <p>SMTP2GO reference: {job.providerMessageId}</p>}
      <div className="owner-email-actions"><button className="secondary small" disabled={busy} onClick={() => void act(async () => setPreview({ ...await api.previewOwnerEmail(organizationId, job.id), job }))}><Eye size={16} />Preview email</button>
        {job.status === 'FAILED' && <button className="secondary small" disabled={busy} onClick={() => void act(() => api.retryOwnerEmail(organizationId, job.id))}>Retry rejected email</button>}
        {job.status === 'PENDING' && job.type !== 'OWNER_WELCOME' && <button className="primary small" disabled={busy || !data.ready || (data.recipients && !data.recipients.some(recipient => recipient.destination === job.destination && recipient.state === 'ACTIVE'))} onClick={() => void act(() => api.processOwnerEmail(organizationId, job.id))}><Send size={16} />Send this email</button>}</div>
    </section>)}
    {preview && <section ref={previewRef} tabIndex={-1} className="owner-email-preview"><h3>{preview.subject}</h3><button className="secondary small" disabled={busy} onClick={() => setPreview(undefined)}>Close preview</button><iframe title="Owner email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 680, border: '1px solid #dbe8df', borderRadius: 16, marginTop: 16 }} />{preview.job?.type === 'OWNER_WELCOME' && preview.job.status === 'PENDING' && <div className="owner-email-actions"><p>To: <b>{preview.job.destination}</b> · This starts enabled email updates after successful sending.</p><button className="primary small" disabled={busy || !data?.ready} onClick={() => void act(async () => { const result = await api.processOwnerEmail(organizationId, preview.job!.id); if (result.accepted === 1) { setPreview(undefined); setNotice('Welcome sent. Review the owner’s updated email status above.'); } else { setPreview(undefined); setNotice('Sending has not been confirmed. Review the message status before trying again.'); } })}><Send size={16} />{busy ? 'Sending…' : 'Send welcome & start email updates'}</button></div>}</section>}
    </div>
  </details>;
}
