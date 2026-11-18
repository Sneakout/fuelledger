import { useEffect, useState } from 'react';
import { Eye, MessageCircleMore, RefreshCw, Send } from 'lucide-react';
import { api, ApiRequestError, type AdminWhatsAppDelivery, type WhatsAppOwnerSummary, type WhatsAppRolloutPolicy } from '../lib/api';

export const whatsappMessageNames: Record<string, string> = { OWNER_WELCOME: 'Owner welcome', SYSTEM_TEST: 'Connection test', LOW_STOCK: 'Low stock', SHIFT_CLOSED_SUMMARY: 'Shift summary', PURCHASE_RECEIPT_SUMMARY: 'Receipt summary', DAILY_SUMMARY: 'Daily summary', OVERDUE_CUSTOMER: 'Owner credit report', CUSTOMER_CREDIT_REMINDER: 'Customer reminder',
  DENSITY_MISSING: 'Missing density', SHIFT_VARIANCE: 'Shift variance', SHIFT_OPEN: 'Open shift',
  APPROVAL_REQUIRED: 'Approval required', CREDIT_SALE: 'Credit sale', CATALOG_CHANGE: 'Product or supplier update',
  MARKET_PRICE_OUTLOOK: 'Market price outlook',
};
export const whatsappHoldReasons: Record<string, string> = { shadow_mode: 'Preview mode is on.', delivery_paused: 'All sending is paused.', account_not_enrolled: 'This owner is not enabled for delivery.', category_paused: 'This message category is paused.', preview_only: 'Prepared for review.', deployment_delivery_disabled: 'Delivery has not been enabled for this deployment.' };
export function OwnerWhatsAppWorkspace({ customers, policy, onRefresh, onTestSetup, messageId, onHistory }: { customers: Pick<WhatsAppOwnerSummary, "id" | "name" | "owner" | "notificationSettings">[]; messageId?: string; onHistory?(): void; policy: WhatsAppRolloutPolicy; onRefresh(): Promise<void>; onTestSetup(ownerId: string, category?: string): Promise<void> }) {
  const [ownerId, setOwnerId] = useState(customers[0]?.id ?? '');
  const owner = customers.find(row => row.id === ownerId);
  const [deliveries, setDeliveries] = useState<AdminWhatsAppDelivery[]>([]);
  const [loadedOwner, setLoadedOwner] = useState('');
  const [operationalType, setOperationalType] = useState('LOW_STOCK');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => {
    const [result] = await Promise.all([api.customerWhatsAppDeliveries(ownerId, { recent: true, ...(messageId ? { message: messageId } : {}) }), onRefresh()]);
    setDeliveries(result.deliveries); setLoadedOwner(ownerId);
  };
  useEffect(() => {
    let active = true;
    setMessage(''); setError(''); setLoadedOwner('');
    if (ownerId) void api.customerWhatsAppDeliveries(ownerId, { recent: true, ...(messageId ? { message: messageId } : {}) }).then(result => {
      if (active) { setDeliveries(result.deliveries); setLoadedOwner(ownerId); }
    }).catch(() => { if (active) setError('Could not load messages. Try refreshing.'); });
    return () => { active = false; };
  }, [ownerId, messageId]);
  async function act(action: () => Promise<string>) {
    setBusy(true); setMessage(''); setError('');
    try { const outcome = await action(); await refresh(); setMessage(outcome); }
    catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : 'Could not complete this step. Please try again.'); }
    finally { setBusy(false); }
  }
  if (!owner) return <p>No owner accounts yet. Accounts will appear here after signup.</p>;
  const eligible = Boolean(owner.notificationSettings.whatsappOptedIn && owner.notificationSettings.whatsappNumber);
  const enrolled = policy.organizationIds.includes(ownerId);
  const paused = policy.paused || policy.stage === 'SHADOW';
  return <div className="owner-whatsapp-workspace">
    {customers.length > 1 && <label className="field"><span>Choose owner account</span><select disabled={busy} value={ownerId} onChange={event => setOwnerId(event.target.value)}>{customers.map(row => <option key={row.id} value={row.id}>{row.name} · {row.owner?.email ?? 'No owner email'}</option>)}</select></label>}
    {customers.length === 1 && <p className="wa-owner-status">{eligible ? 'Owner consent saved' : 'Owner consent needed'} · {paused ? 'Sending paused' : enrolled ? 'Owner in rollout' : 'Owner outside rollout'}</p>}
    <details className="wa-testing"><summary>Set up & test WhatsApp</summary>
    <div className="wa-steps">
      <section><span className="eyebrow">1 · Check destination</span><h3>{owner.name}</h3><p>{owner.owner?.name ?? 'Owner'} · {owner.owner?.email ?? 'No email'}</p><strong>{owner.notificationSettings.whatsappNumber ? `+${owner.notificationSettings.whatsappNumber}` : 'WhatsApp number not added'}</strong><p>{eligible ? 'Owner consent recorded. Ready to prepare a preview.' : 'The owner must add their number and consent in Settings → WhatsApp alerts.'}</p></section>
      <section><span className="eyebrow">2 · Prepare a message</span><h3>Preview before sending</h3><p>Preparing a preview does not send a WhatsApp message. Welcome messages require an approved welcome template. Connection tests require a configured test template; you can use an operational template below instead.</p><div className="rollout-actions"><button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { const result = await api.testCustomerWhatsApp(ownerId, true); return result.delivery.status === 'QUEUED' ? 'Welcome preview prepared. Review it below.' : result.delivery.reason ?? 'Welcome was not queued.'; })}><Eye size={16}/>Welcome preview</button><button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { const result = await api.testCustomerWhatsApp(ownerId, false); return result.delivery.status === 'QUEUED' ? 'Connection-test preview prepared. Review it below.' : result.delivery.reason ?? 'Test was not queued.'; })}><MessageCircleMore size={16}/>Connection test</button></div></section>
      <section><span className="eyebrow">3 · Enable & review</span><h3>{paused ? 'Sending paused' : enrolled ? 'Owner enabled' : 'Owner not enabled'}</h3><p>For your first test, enable only this owner and the two test categories. This replaces the current rollout selection; other accounts and business categories stay paused.</p><button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { await onTestSetup(ownerId); return 'Internal test enabled for this owner only. Review and approve the exact message below, then send it.'; })}>Enable test for this owner only</button></section>
    </div>
    <section className="wa-operational-preview"><span className="eyebrow">Use an operational template</span><h3>Test with a real owner update</h3><p>No separate connection-test template is needed. Choose a message built from this owner’s actual records. Meta approval is checked before sending; preparing a preview does not send it.</p>
      <label className="field"><span>Message to preview</span><select disabled={busy} value={operationalType} onChange={event => setOperationalType(event.target.value)}><option value="LOW_STOCK">Low-stock alert · Intelligence</option><option value="SHIFT_CLOSED_SUMMARY">Latest reconciled shift · Intelligence</option><option value="PURCHASE_RECEIPT_SUMMARY">Latest stock receipt · Intelligence</option><option value="OVERDUE_CUSTOMER">Customer credit report · Intelligence</option><option value="DAILY_SUMMARY">Today’s operating summary · Core</option></select></label>
      <div className="rollout-actions"><button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { const result = await api.testCustomerWhatsApp(ownerId, false, operationalType); return result.delivery.status === 'QUEUED' ? 'Operational preview prepared using current records. Review it below.' : result.delivery.reason === 'no_outstanding_customers' ? 'No customers have an outstanding balance. Choose a different message.' : result.delivery.reason ?? 'No eligible records were found for this message.'; })}><Eye size={16}/>Prepare operational preview</button>
      <button className="secondary small" disabled={busy || !eligible} onClick={() => void act(async () => { await onTestSetup(ownerId, operationalType); return 'The selected message category is enabled for this owner only. Review and approve the preview, then send it.'; })}>Enable selected message for this owner only</button></div>
      <p>Core supports the daily summary. Intelligence supports stock, shift, receipt and credit updates. The owner’s preferences still apply. Shift and receipt previews require a qualifying record from the last 24 hours. Enabling replaces the current rollout selection; other owners and categories remain paused.</p>
    </section>
    </details>
    {message && <p className="wa-feedback" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="wa-history-heading"><div><h3>{messageId ? "Selected message & recent activity" : "Latest messages"}</h3><p>{onHistory ? "Showing up to five recent messages. Open full history to find older deliveries." : "Showing up to five recent messages."}</p></div><button className="secondary small" disabled={busy} onClick={() => void act(async () => 'Owner consent, WhatsApp number, delivery settings and message status refreshed.')}><RefreshCw size={16}/>Refresh status</button>{onHistory && <button type="button" className="secondary small" onClick={onHistory}>View full history</button>}</div>
    {loadedOwner !== ownerId ? <p role="status">Loading owner messages…</p> : !deliveries.length ? <p className="rollout-empty">No messages yet. Prepare a welcome preview or connection test above.</p> : <div className="wa-message-list">{deliveries.map(delivery => {
      const approved = Boolean(delivery.previewHash && delivery.previewHash === delivery.approvedPreviewHash);
      const blocked = !eligible || paused || !enrolled || !policy.enabledCategories.includes(delivery.type);
      return <section className="wa-message" key={delivery.id}><header><h4>{whatsappMessageNames[delivery.type] ?? delivery.type.replaceAll('_', ' ')}</h4><span className="rollout-status">{delivery.status === 'PENDING' ? approved ? 'Approved · awaiting send' : 'Needs review' : delivery.status === 'ACCEPTED' || delivery.status === 'SENT' ? 'Accepted · awaiting delivery' : delivery.status.toLowerCase()}</span></header><p className="wa-message-meta">Recipient ending {delivery.recipientEnding} · {new Date(delivery.createdAt).toLocaleString('en-IN')} · {delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}</p>
        {delivery.previewTemplate && <><p className="admin-whatsapp-preview">{delivery.previewBody || 'Connection-test template with no inserted text.'}</p><details><summary>Template & source</summary><p>{delivery.previewTemplate}{delivery.sourceId ? ` · ${delivery.sourceId}` : ''}</p></details></>}
        {(delivery.errorMessage || delivery.suppressionReason) && <p className="wa-feedback">{delivery.errorMessage ?? delivery.suppressionReason?.replaceAll('_', ' ')}</p>}
        {delivery.status === 'SUPPRESSED' && ['owner_not_opted_in', 'recipient_changed'].includes(delivery.suppressionReason ?? '') && <p>This message was stopped using the settings at that time. It will not be sent automatically after a settings change. Prepare a new preview with the current owner number and consent.</p>}
        {delivery.status === 'PENDING' && <><p>{blocked ? 'Sending is blocked by the current rollout settings. Enable this owner and category before sending.' : delivery.rolloutHold ? whatsappHoldReasons[delivery.rolloutHold] ?? delivery.rolloutHold.replaceAll('_', ' ') : 'Delivery checks will run again before sending.'}</p><div className="rollout-actions">{!approved && delivery.previewHash && <button className="secondary small" disabled={busy} onClick={() => void act(async () => { await api.approveWhatsAppPreview(ownerId, delivery.id, delivery.previewHash!); return 'Message preview approved. You can now send this message when delivery is enabled.'; })}>Approve this preview</button>}<button className="primary small" disabled={busy || !approved || blocked} onClick={() => void act(async () => { const result = await api.processOwnerWhatsApp(ownerId, delivery.id); return result.accepted ? 'Provider accepted this message. Refresh status to check delivery.' : result.failed ? 'Sending failed. See the reason on this message.' : result.suppressed ? 'Message was suppressed by a delivery check. See the reason below.' : 'Message is waiting. Check the hold reason or template approval, then refresh status.'; })}><Send size={16}/>Send this message</button></div></>}
        {delivery.canRetry && <button className="secondary small" disabled={busy} onClick={() => void act(async () => { await api.retryCustomerWhatsAppDelivery(ownerId, delivery.id); return 'Safe retry queued. Delivery checks will run again.'; })}>Queue safe retry</button>}
      </section>;
    })}</div>}
  </div>;
}
