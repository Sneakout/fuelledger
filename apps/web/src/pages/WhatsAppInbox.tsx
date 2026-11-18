import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, History, ListChecks, RefreshCw, Users } from 'lucide-react';
import { api, ApiRequestError, type WhatsAppOwnerSummary, type WhatsAppRolloutPolicy } from '../lib/api';
import { OwnerWhatsAppWorkspace, whatsappHoldReasons, whatsappMessageNames } from './OwnerWhatsAppWorkspace';

const views = [
  { id: 'owners', label: 'Owners', icon: Users },
  { id: 'attention', label: 'Needs attention', icon: ListChecks },
  { id: 'history', label: 'Delivery history', icon: History },
] as const;
type View = typeof views[number]['id'];
const statuses = {
  PENDING: 'Pending', PROCESSING: 'Processing', ACCEPTED: 'Accepted by WhatsApp', SENT: 'Accepted by WhatsApp',
  DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', SUPPRESSED: 'Skipped',
};
const timestamp = (value: string) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const loadOwners = async (filters: Record<string, string>) => {
  const result = await api.adminWhatsAppOwners(filters);
  return { rows: result.owners, nextCursor: result.nextCursor };
};
const loadMessages = async (filters: Record<string, string>) => {
  const result = await api.adminWhatsAppMessages(filters);
  return { rows: result.messages, nextCursor: result.nextCursor };
};

function useResults<T>(load: (filters: Record<string, string>) => Promise<{ rows: T[]; nextCursor: string | null }>, filters: Record<string, string>, listVersion: number) {
  const criteria = new URLSearchParams(filters).toString();
  const [pages, setPages] = useState<{ criteria: string; cursors: string[] }>({ criteria, cursors: [] });
  const cursors = pages.criteria === criteria ? pages.cursors : [];
  const cursor = cursors.at(-1);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([criteria, cursor, revision, listVersion]);
  const [result, setResult] = useState<{ key: string; rows: T[]; nextCursor: string | null; error?: string }>();
  useEffect(() => {
    let active = true;
    const request = Object.fromEntries(new URLSearchParams(criteria));
    if (cursor) request.cursor = cursor;
    // Let the admin finish typing before querying.
    const timer = window.setTimeout(() => {
      void load(request).then(data => {
        if (active) setResult({ key, ...data });
      }).catch(error => {
        if (active) setResult({ key, rows: [], nextCursor: null, error: error instanceof ApiRequestError ? error.message : 'Could not load records. Try refreshing.' });
      });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [load, criteria, cursor, key]);
  const current = result?.key === key ? result : undefined;
  return {
    rows: current?.rows, nextCursor: current?.nextCursor ?? null, error: current?.error,
    loading: !current, page: cursors.length + 1,
    refresh: () => setRevision(value => value + 1),
    next: () => { if (current?.nextCursor) setPages({ criteria, cursors: [...cursors, current.nextCursor] }); },
    previous: () => setPages({ criteria, cursors: cursors.slice(0, -1) }),
  };
}

function Pagination({ page, loading, nextCursor, previous, next }: {
  page: number; loading: boolean; nextCursor?: string | null; previous(): void; next(): void;
}) {
  if (page === 1 && !nextCursor) return null;
  return <div className="wa-pagination" aria-label="Results pages">
    <button type="button" className="secondary small" disabled={loading || page === 1} onClick={previous}><ChevronLeft size={16}/> Previous</button>
    <span>Page {page}</span>
    <button type="button" className="secondary small" disabled={loading || !nextCursor} onClick={next}>Next <ChevronRight size={16}/></button>
  </div>;
}

function OwnerDirectory({ policy, onOpen, listVersion }: { policy: WhatsAppRolloutPolicy; onOpen(id: string): void; listVersion: number }) {
  const [search, setSearch] = useState('');
  const records = useResults(loadOwners, search.trim() ? { search: search.trim() } : {}, listVersion);
  return <>
    <div className="wa-inbox-toolbar">
      <label className="field"><span>Find an owner</span><input type="search" placeholder="Fuel station, owner or email" maxLength={100} value={search} onChange={event => setSearch(event.target.value)}/></label>
      <button type="button" className="secondary small" onClick={records.refresh}><RefreshCw size={15}/> Refresh owners</button>
    </div>
    {records.loading && <p role="status">Loading owners…</p>}
    {records.error && <p role="alert" className="form-error">{records.error}</p>}
    {records.rows?.map(owner => {
      const hasConsent = owner.notificationSettings.whatsappOptedIn && owner.notificationSettings.whatsappNumber;
      const enrolled = policy.organizationIds.includes(owner.id);
      const enabled = enrolled && !policy.paused && policy.stage !== 'SHADOW' && policy.enabledCategories.length > 0;
      return <div className="wa-inbox-row" key={owner.id}>
        <div><strong>{owner.name}</strong><small>{[owner.owner?.name, owner.owner?.email].filter(Boolean).join(' · ') || 'Owner details unavailable'}</small></div>
        <div><b>{hasConsent ? 'Consent saved' : 'Consent needed'}</b><small>{enabled && hasConsent ? 'Rollout enabled' : enrolled ? 'Delivery unavailable' : 'Outside the rollout'}</small></div>
        <div><b>{owner.lastDeliveredAt ? `Last delivered ${timestamp(owner.lastDeliveredAt)}` : 'No confirmed delivery'}</b><small>{owner.failedCount} failed {owner.failedCount === 1 ? 'message' : 'messages'}</small></div>
        <button type="button" className="secondary small" onClick={() => onOpen(owner.id)} aria-label={`Open ${owner.name}`}>Open owner</button>
      </div>;
    })}
    {!records.loading && !records.error && !records.rows?.length && <p>No owners match this search.</p>}
    <Pagination {...records} />
  </>;
}

function MessageDirectory({ view, owner, clearOwner, onOpen, listVersion }: {
  view: 'attention' | 'history'; owner: WhatsAppOwnerSummary | null;
  listVersion: number; clearOwner(): void; onOpen(ownerId: string, messageId: string): void;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const set = (name: string, value: string) => setFilters(previous => ({ ...previous, [name]: value }));
  const records = useResults(loadMessages, { view, ...(owner ? { ownerId: owner.id } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim())) }, listVersion);
  return <>
    {owner && <p className="wa-owner-filter">Showing {owner.name} <button type="button" className="secondary small" onClick={clearOwner}>Show all owners</button></p>}
    <div className="wa-inbox-filters">
      {!owner && <label className="field"><span>Owner</span><input type="search" value={filters.search ?? ''} maxLength={100} placeholder="Station, name or email" onChange={event => set('search', event.target.value)}/></label>}
      <label className="field"><span>From (IST)</span><input type="date" value={filters.from ?? ''} onChange={event => set('from', event.target.value)}/></label>
      <label className="field"><span>To (IST)</span><input type="date" value={filters.to ?? ''} onChange={event => set('to', event.target.value)}/></label>
      <label className="field"><span>Category</span><select value={filters.category ?? ''} onChange={event => set('category', event.target.value)}><option value="">All categories</option>{Object.entries(whatsappMessageNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field"><span>Status</span><select value={filters.status ?? ''} onChange={event => set('status', event.target.value)}><option value="">All statuses</option>{Object.entries(statuses).filter(([key]) => view === 'history' || ['PENDING', 'FAILED'].includes(key)).map(([key, label]) => <option key={key} value={key}>{key === 'SENT' ? 'Accepted (previous records)' : label}</option>)}</select></label>
    </div>
    <div className="wa-inbox-toolbar">
      <p>{view === 'attention' ? 'Pending previews, blocked messages and failed deliveries.' : 'Open a message to see its preview, delivery details and available actions.'}</p>
      <button type="button" className="secondary small" onClick={records.refresh}><RefreshCw size={15}/> Refresh messages</button>
    </div>
    {records.loading && <p role="status">Loading messages…</p>}
    {records.error && <p role="alert" className="form-error">{records.error}</p>}
    {records.rows?.map(row => {
      const reason = row.errorMessage || (row.rolloutHold && whatsappHoldReasons[row.rolloutHold])
        || row.suppressionReason?.replaceAll('_', ' ') || row.rolloutHold?.replaceAll('_', ' ');
      const status = row.status === 'PENDING' && row.needsApproval ? 'Needs approval' : statuses[row.status];
      return <div className="wa-inbox-row" key={row.id}>
        <div><strong>{whatsappMessageNames[row.type] ?? row.type.replaceAll('_', ' ')}</strong><small>{row.organization.name}</small></div>
        <div><b>{status}</b><small>{reason}</small></div>
        <small>{timestamp(row.createdAt)}</small>
        <button type="button" className="secondary small" onClick={() => onOpen(row.organizationId, row.id)}>Open message</button>
      </div>;
    })}
    {!records.loading && !records.error && !records.rows?.length && <p>{view === 'attention' ? 'No messages need attention with these filters.' : 'No deliveries match these filters.'}</p>}
    <Pagination {...records} />
  </>;
}

export function WhatsAppInbox({ policy, onRefresh, onTestSetup }: {
  policy: WhatsAppRolloutPolicy; onRefresh(): Promise<void>; onTestSetup(ownerId: string, category?: string): Promise<void>;
}) {
  const [view, setView] = useState<View>('owners');
  const [selected, setSelected] = useState<{ ownerId: string; messageId?: string }>();
  const [owner, setOwner] = useState<WhatsAppOwnerSummary>();
  const [ownerError, setOwnerError] = useState('');
  const [historyOwner, setHistoryOwner] = useState<WhatsAppOwnerSummary | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const ownerId = selected?.ownerId;
  const ownerHeading = useRef<HTMLHeadingElement>(null);
  const selectedOwnerReady = Boolean(ownerId && owner?.id === ownerId);
  useEffect(() => {
    if (selectedOwnerReady) ownerHeading.current?.focus();
  }, [selectedOwnerReady]);
  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    void api.adminWhatsAppOwners({ ownerId }).then(result => {
      if (!active) return;
      if (result.owners[0]) setOwner(result.owners[0]);
      else setOwnerError('This owner account is unavailable.');
    }).catch(() => { if (active) setOwnerError('Could not load this owner. Go back and try again.'); });
    return () => { active = false; };
  }, [ownerId]);
  function openOwner(id: string, messageId?: string) {
    setOwnerError('');
    setSelected({ ownerId: id, ...(messageId ? { messageId } : {}) });
  }
  function closeOwner() {
    setSelected(undefined);
    setOwner(undefined);
    setListVersion(version => version + 1);
  }
  async function refreshOwner() {
    if (!ownerId) return;
    const [result] = await Promise.all([api.adminWhatsAppOwners({ ownerId }), onRefresh()]);
    if (!result.owners[0]) throw new Error('Owner unavailable');
    setOwner(result.owners[0]);
  }
  return <div className="wa-inbox">
    <nav className="wa-inbox-nav" aria-label="WhatsApp views">
      {views.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={view === id ? 'page' : undefined} onClick={() => {
        if (selected) closeOwner();
        if (id !== view && id === 'history') setHistoryOwner(null);
        setView(id);
      }}><Icon size={17}/> {label}</button>)}
    </nav>
    <div hidden={Boolean(selected)}>
      {view === 'owners' ? <OwnerDirectory listVersion={listVersion} policy={policy} onOpen={openOwner}/> :
        <MessageDirectory key={`${view}:${historyOwner?.id ?? ''}`} listVersion={listVersion} view={view} owner={view === 'history' ? historyOwner : null}
          clearOwner={() => setHistoryOwner(null)} onOpen={openOwner}/>}
    </div>
    {selected && <div>
      <button type="button" className="secondary small" onClick={closeOwner}><ArrowLeft size={16}/> Back to {views.find(item => item.id === view)?.label.toLowerCase()}</button>
      {ownerError && <p role="alert" className="form-error">{ownerError}</p>}
      {!ownerError && owner?.id !== selected.ownerId && <p role="status">Loading owner…</p>}
      {owner?.id === selected.ownerId && <>
        <h3 className="wa-inbox-owner-title" ref={ownerHeading} tabIndex={-1}>{owner.name}</h3>
        <OwnerWhatsAppWorkspace key={owner.id} customers={[owner]} policy={policy} onRefresh={refreshOwner} onTestSetup={onTestSetup}
          {...(selected.messageId ? { messageId: selected.messageId } : {})}
          onHistory={() => { setHistoryOwner(owner); closeOwner(); setView('history'); }}/>
      </>}
    </div>}
  </div>;
}
