import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, Mail, RefreshCw, Send, X } from 'lucide-react';
import { api, ApiRequestError, type DemoLead, type DemoFollowUpPreview, type DemoFollowUpState } from '../lib/api';
import './demo-follow-up.css';
const dateLabel = (value: string) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const statusLabel = (status?: string) => ({ ACCEPTED: 'Accepted by email service', PROCESSING: 'Sending…', UNKNOWN: 'Delivery review needed', FAILED: 'Send failed', OPTED_OUT: 'Opted out', SUPPRESSED: 'Sending stopped', PENDING: 'Preview prepared' }[status ?? ''] ?? 'Not contacted by email');
export function DemoFollowUpPanel({ lead, onClose, onUpdated }: { lead: DemoLead; onClose(): void; onUpdated(state: DemoFollowUpState): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<DemoFollowUpPreview | null>(null);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  async function load() {
    setLoading(true); setError('');
    try { const next = await api.previewDemoFollowUp(lead.id); setPreview(next); onUpdated(next); }
    catch (e) { setError(e instanceof ApiRequestError ? e.message : 'Unable to load this email. Please try again.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { const trigger = document.activeElement as HTMLElement | null; dialog.current?.showModal(); void load(); return () => { trigger?.focus(); }; }, [lead.id]);
  async function send() {
    if (!preview || !permission || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.sendDemoFollowUp(lead.id, { id: preview.id, previewHash: preview.previewHash, permissionConfirmed: true });
      setPreview({ ...preview, ...result }); onUpdated(result); setSent(result.status === 'ACCEPTED');
    } catch (e) { setError(e instanceof ApiRequestError ? e.message : 'Could not confirm the sending result. Refresh status before trying again.'); }
    finally { setBusy(false); }
  }
  const canSend = preview?.ready && ['PENDING', 'FAILED'].includes(preview.status) && preview.attempts < 3;
  return <dialog ref={dialog} className="demo-followup-dialog" aria-labelledby="demo-followup-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <header className="demo-followup-heading"><span className="demo-followup-icon"><Mail size={24}/></span><div><span className="eyebrow">Demo enquiry · personal follow-up</span><h2 id="demo-followup-title">A clearer picture of FuelNerve</h2><p>Review the email, then send it to this visitor.</p></div><button className="secondary small" aria-label="Close email preview" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <div className="demo-followup-body">
      <div className="demo-followup-destination"><span><small>To</small><strong>{lead.contact}</strong></span><span className="demo-followup-status">{statusLabel(preview?.status ?? lead.followUp?.status)}</span></div>
      {loading && <p role="status">Preparing your preview…</p>}
      {error && <p role="alert" className="demo-followup-error">{error}</p>}
      {sent && <div className="demo-followup-success" role="status"><CheckCircle2/><div><strong>Follow-up accepted by the email service</strong><p>It is recorded against this address. Provider acceptance does not confirm inbox delivery.</p></div></div>}
      {!loading && preview && <>
        <p className="demo-followup-note">{preview.attempts} send attempt{preview.attempts === 1 ? '' : 's'}{preview.acceptedAt ? ` · Accepted ${dateLabel(preview.acceptedAt)}` : ''}</p>
        <div className="demo-followup-subject"><small>Subject</small><strong>{preview.subject}</strong></div>
        <iframe title="FuelNerve demo follow-up email" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} className="demo-followup-frame"/>
        {preview.errorMessage && <p role="status" className="demo-followup-error">{preview.errorMessage}</p>}
        {!preview.ready && <p className="demo-followup-error">Email sending is paused. An administrator must check the email setup before sending.</p>}
        {canSend && <label className="demo-followup-permission"><input type="checkbox" checked={permission} onChange={e => setPermission(e.target.checked)} disabled={busy}/><span>This visitor agreed to receive a FuelNerve demo follow-up at this email address.<small>Using the demo alone does not record permission. An opt-out link is included.</small></span></label>}
        <p className="demo-followup-note">One follow-up per email address. This does not activate owner alerts or extend demo access.</p>
      </>}
    </div>
    <footer className="demo-followup-footer"><button className="secondary" disabled={busy || loading} onClick={() => void load()}><RefreshCw size={16}/>Refresh status</button><button className="primary" disabled={busy || loading || !canSend || !permission} onClick={() => void send()}>{busy ? <RefreshCw size={17}/> : <Send size={17}/>} {busy ? 'Sending…' : preview?.status === 'FAILED' ? 'Retry this email' : 'Send follow-up email'}</button></footer>
  </dialog>;
}
export function DemoFollowUpAction({ lead, onOpen }: { lead: DemoLead; onOpen(): void }) {
  return <div className="demo-followup-action"><small>{statusLabel(lead.followUp?.status)}{lead.followUp?.acceptedAt ? ` · ${dateLabel(lead.followUp.acceptedAt)}` : ''}</small><button className="secondary small" onClick={onOpen}><Eye size={16}/>{lead.followUp ? 'View follow-up' : 'Preview follow-up'}</button></div>;
}
