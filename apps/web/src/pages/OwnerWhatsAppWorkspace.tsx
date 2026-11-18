import { useEffect, useState } from 'react';
import { Eye, MessageCircleMore, RefreshCw, Send } from 'lucide-react';
import { api, ApiRequestError, type AdminWhatsAppDelivery, type PlatformCustomer, type WhatsAppRolloutPolicy } from '../lib/api';

const names: Record<string, string> = { OWNER_WELCOME: 'Owner welcome', SYSTEM_TEST: 'Connection test', LOW_STOCK: 'Low stock', SHIFT_CLOSED_SUMMARY: 'Shift summary', PURCHASE_RECEIPT_SUMMARY: 'Receipt summary', DAILY_SUMMARY: 'Daily summary', OVERDUE_CUSTOMER: 'Owner credit report', CUSTOMER_CREDIT_REMINDER: 'Customer reminder' };
const holds: Record<string, string> = { shadow_mode: 'Preview mode is on.', delivery_paused: 'All sending is paused.', account_not_enrolled: 'This owner is not enabled for delivery.', category_paused: 'This message category is paused.', preview_only: 'Prepared for review.', deployment_delivery_disabled: 'Delivery has not been enabled for this deployment.' };
export function OwnerWhatsAppWorkspace({ customers, policy, onTestSetup }: { customers: PlatformCustomer[]; policy: WhatsAppRolloutPolicy; onTestSetup(ownerId: string): Promise<void> }) {
  const [ownerId, setOwnerId] = useState(customers[0]?.id ?? '');
  const owner = customers.find(row => row.id === ownerId);
  const [deliveries, setDeliveries] = useState<AdminWhatsAppDelivery[]>([]);
  const [loadedOwner, setLoadedOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => {
    const result = await api.customerWhatsAppDeliveries(ownerId);
    setDeliveries(result.deliveries); setLoadedOwner(ownerId);
  };
  useEffect(() => {
    let active = true;
    setMessage(''); setError(''); setLoadedOwner('');
    if (ownerId) void api.customerWhatsAppDeliveries(ownerId).then(result => {
      if (active) { setDeliveries(result.deliveries); setLoadedOwner(ownerId); }
    }).catch(() => { if (active) setError('Could not load messages. Try refreshing.'); });
    return () => { active = false; };
  }, [ownerId]);
  async function act(action: () => Promise<string>) {
    setBusy(true); setMessage(''); setError('');
    try { setMessage(await action()); await refresh(); }
    catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : 'Could not complete this step. Please try again.'); }
    finally { setBusy(false); }
  }
  if (!owner) return <p>No owner accounts yet. Accounts will appear here after signup.</p>;
  const eligible = Boolean(owner.notificationSettings.whatsappOptedIn && owner.notificationSettings.whatsappNumber);
  const enrolled = policy.organizationIds.includes(ownerId);
  const paused = policy.paused || policy.stage === 'SHADOW';
  return <div className="owner-whatsapp-workspace">
    <label className="field"><span>Choose owner account</span><select disabled={busy} value={ownerId} onChange={event => setOwnerId(event.target.value)}>{customers.map(row => <option key={row.id} value={row.id}>{row.name} · {row.owner?.email ?? 'No owner email'}</option>)}</select></label>
    <div className="wa-steps">
      <section><span className="eyebrow">1 · Check destination</span><h3>{owner.name}</h3><p>{owner.owner?.name ?? 'Owner'} · {owner.owner?.email ?? 'No email'}</p><strong>{owner.notificationSettings.whatsappNumber ? `+${owner.notificationSettings.whatsappNumber}` : 'WhatsApp number not added'}</strong><p>{eligible ? 'Owner consent recorded. Ready to prepare a preview.' : 'The owner must add their number and consent in Settings → WhatsApp alerts.'}</p></section>
      <section><span className="eyebrow">2 · Prepare a message</span><h3>Preview before sending</h3><p>Preparing a preview does not send a WhatsApp message. Welcome messages also require an approved welcome template.</p><div className="rollout-actions"><button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { const result = await api.testCustomerWhatsApp(ownerId, true); return result.delivery.status === 'QUEUED' ? 'Welcome preview prepared. Review it below.' : result.delivery.reason ?? 'Welcome was not queued.'; })}><Eye size={16}/>Welcome preview</button><button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { const result = await api.testCustomerWhatsApp(ownerId, false); return result.delivery.status === 'QUEUED' ? 'Connection-test preview prepared. Review it below.' : result.delivery.reason ?? 'Test was not queued.'; })}><MessageCircleMore size={16}/>Connection test</button></div></section>
      <section><span className="eyebrow">3 · Enable & review</span><h3>{paused ? 'Sending paused' : enrolled ? 'Owner enabled' : 'Owner not enabled'}</h3><p>For your first test, enable only this owner and the two test categories. This replaces the current rollout selection; other accounts and business categories stay paused.</p><button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { await onTestSetup(ownerId); return 'Internal test enabled for this owner only. Review and approve the exact message below, then send it.'; })}>Enable test for this owner only</button></section>
    </div>
    {message && <p className="wa-feedback" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="wa-history-heading"><div><h3>Message previews & delivery history</h3><p>Approve the content first, then send that message. Accepted means the provider received it; Delivered confirms arrival.</p></div><button className="secondary small" disabled={busy} onClick={() => void act(async () => 'Message status refreshed.')}><RefreshCw size={16}/>Refresh status</button></div>
    {loadedOwner !== ownerId ? <p role="status">Loading owner messages…</p> : !deliveries.length ? <p className="rollout-empty">No messages yet. Prepare a welcome preview or connection test above.</p> : <div className="wa-message-list">{deliveries.map(delivery => {
      const approved = Boolean(delivery.previewHash && delivery.previewHash === delivery.approvedPreviewHash);
      const blocked = paused || !enrolled || !policy.enabledCategories.includes(delivery.type);
      return <section className="wa-message" key={delivery.id}><header><h4>{names[delivery.type] ?? delivery.type.replaceAll('_', ' ')}</h4><span className="rollout-status">{delivery.status === 'PENDING' ? approved ? 'Approved · awaiting send' : 'Needs review' : delivery.status === 'ACCEPTED' || delivery.status === 'SENT' ? 'Accepted · awaiting delivery' : delivery.status.toLowerCase()}</span></header><p className="wa-message-meta">Recipient ending {delivery.recipientEnding} · {new Date(delivery.createdAt).toLocaleString('en-IN')} · {delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}</p>
        {delivery.previewTemplate && <><p className="admin-whatsapp-preview">{delivery.previewBody || 'Connection-test template with no inserted text.'}</p><details><summary>Template & source</summary><p>{delivery.previewTemplate}{delivery.sourceId ? ` · ${delivery.sourceId}` : ''}</p></details></>}
        {(delivery.errorMessage || delivery.suppressionReason) && <p className="wa-feedback">{delivery.errorMessage ?? delivery.suppressionReason?.replaceAll('_', ' ')}</p>}
        {delivery.status === 'PENDING' && <><p>{blocked ? 'Sending is blocked by the current rollout settings. Enable this owner and category before sending.' : delivery.rolloutHold ? holds[delivery.rolloutHold] ?? delivery.rolloutHold.replaceAll('_', ' ') : 'Delivery checks will run again before sending.'}</p><div className="rollout-actions">{!approved && delivery.previewHash && <button className="secondary small" disabled={busy} onClick={() => void act(async () => { await api.approveWhatsAppPreview(ownerId, delivery.id, delivery.previewHash!); return 'Message preview approved. You can now send this message when delivery is enabled.'; })}>Approve this preview</button>}<button className="primary small" disabled={busy || !approved || blocked} onClick={() => void act(async () => { const result = await api.processOwnerWhatsApp(ownerId, delivery.id); return result.accepted ? 'Provider accepted this message. Refresh status to check delivery.' : result.failed ? 'Sending failed. See the reason on this message.' : result.suppressed ? 'Message was suppressed by a delivery check. See the reason below.' : 'Message is waiting. Check the hold reason or template approval, then refresh status.'; })}><Send size={16}/>Send this message</button></div></>}
        {delivery.canRetry && <button className="secondary small" disabled={busy} onClick={() => void act(async () => { await api.retryCustomerWhatsAppDelivery(ownerId, delivery.id); return 'Safe retry queued. Delivery checks will run again.'; })}>Queue safe retry</button>}
      </section>;
    })}</div>}
  </div>;
}
