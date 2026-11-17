import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Clock3, ExternalLink, PackageCheck, RefreshCw, ShieldCheck, SlidersHorizontal, X, XCircle } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ApiRequestError, api, type OwnerApproval } from "../lib/api";
import { useAuth } from "../components/AuthProvider";

type Tab = "PENDING" | "REVIEWED";

const numberFrom = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0);
const objectFrom = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const money = (value: unknown) => `₹${numberFrom(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const quantity = (value: unknown, unit = "L") => `${numberFrom(value).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`;
const dateOnly = (value: unknown) => {
  const parsed = typeof value === "string" ? new Date(value) : new Date();
  const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}-${String(safe.getDate()).padStart(2, "0")}`;
};
const dateTime = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function approvalTitle(approval: OwnerApproval) {
  const evidence = objectFrom(approval.evidence);
  const product = objectFrom(evidence.product);
  if (approval.actionType === "PRODUCT_PRICE_CHANGE") return `${String(product.code || product.name || "Product")} price change`;
  if (approval.actionType === "PRODUCT_CATALOG_CHANGE") return `${String(product.code || product.name || "Product")} catalog ${String(evidence.operation || "change").toLowerCase()}`;
  if (approval.actionType === "INVENTORY_ADJUSTMENT") return `${String(product.code || product.name || "Stock")} adjustment`;
  return "Owner decision";
}

function ApprovalSummary({ approval }: { approval: OwnerApproval }) {
  const evidence = objectFrom(approval.evidence);
  const product = objectFrom(evidence.product);
  const tank = objectFrom(evidence.tank);
  if (approval.actionType === "PRODUCT_PRICE_CHANGE") {
    return <div className="approval-comparison">
      <span><small>Purchase price before</small><b>{money(evidence.currentPurchasePrice)}</b></span>
      <ArrowRight aria-hidden="true" />
      <span className="proposed"><small>Purchase price proposed</small><b>{money(evidence.proposedPurchasePrice)}</b></span>
    </div>;
  }
  if (approval.actionType === "PRODUCT_CATALOG_CHANGE") {
    const before = objectFrom(evidence.before); const after = objectFrom(evidence.after);
    return <div className="approval-comparison">
      <span><small>{evidence.operation === "CREATE" ? "New catalog item" : "Current product"}</small><b>{evidence.operation === "CREATE" ? "Not yet created" : String(before.name || product.name || "Product")}</b></span>
      <ArrowRight aria-hidden="true" />
      <span className="proposed"><small>Requested product</small><b>{String(after.name || product.name || "Product")}</b></span>
      <em>{money(after.sellingPrice)} selling</em>
    </div>;
  }
  return <div className="approval-comparison">
    <span><small>Book stock before</small><b>{quantity(evidence.bookStockBefore, String(product.unit || "L"))}</b></span>
    <ArrowRight aria-hidden="true" />
    <span className="proposed"><small>Proposed book stock</small><b>{quantity(evidence.proposedBookStock, String(product.unit || "L"))}</b></span>
    {tank.code ? <em>{String(tank.code)}</em> : null}
  </div>;
}

function DecisionDialog({ approval, onClose, onSaved }: { approval: OwnerApproval; onClose(): void; onSaved(): void }) {
  const evidence = objectFrom(approval.evidence);
  const payload = objectFrom(approval.payload);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [note, setNote] = useState("");
  const [sellingPrice, setSellingPrice] = useState(numberFrom(evidence.suggestedSellingPrice || payload.suggestedSellingPrice));
  const [effectiveDate, setEffectiveDate] = useState(dateOnly(payload.purchaseEffectiveFrom));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isPrice = approval.actionType === "PRODUCT_PRICE_CHANGE";
  const isCatalog = approval.actionType === "PRODUCT_CATALOG_CHANGE";
  const canSave = decision === "REJECT" ? note.trim().length >= 3 : !isPrice || (sellingPrice > 0 && Boolean(effectiveDate));

  async function save() {
    setSaving(true); setError("");
    try {
      await api.decideApproval(approval.id, {
        decision, note: note.trim(), version: approval.version,
        ...(decision === "APPROVE" && isPrice ? {
          sellingPrice,
          sellingPriceEffectiveFrom: new Date(`${effectiveDate}T00:00:00`).toISOString(),
        } : {}),
      });
      window.dispatchEvent(new CustomEvent("fuelnerve:approvals-changed"));
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "This decision could not be saved. Refresh and try again.");
    } finally { setSaving(false); }
  }

  return <div className="approval-modal" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-dialog-title">
      <header><div><span className="approval-dialog-icon"><ShieldCheck /></span><span><small>Owner approval</small><h2 id="approval-dialog-title">{approvalTitle(approval)}</h2><p>{approval.station.name} · requested by {approval.requestedBy.name}</p></span></div><button aria-label="Close" onClick={onClose}><X /></button></header>
      <div className="approval-dialog-body">
        <ApprovalSummary approval={approval} />
        <p className="approval-reason">{approval.reason}</p>
        {isPrice ? <div className="approval-price-review"><label><span>Confirmed selling price (₹/L)</span><input type="number" min="0.01" step="0.01" value={sellingPrice || ""} onChange={event => setSellingPrice(Number(event.target.value))} disabled={decision === "REJECT"} /></label><label><span>Selling price effective from</span><input type="date" value={effectiveDate} min={dateOnly(payload.purchaseEffectiveFrom)} onChange={event => setEffectiveDate(event.target.value)} disabled={decision === "REJECT"} /></label></div> : <div className="approval-safety-note"><PackageCheck /><span><b>{isCatalog ? "Approval applies the catalog change." : "Approval records the owner’s decision."}</b><small>{isCatalog ? "The requested product is created or updated only after you approve. Rejection leaves the catalog unchanged." : "The stock adjustment is not silently posted. The approved adjustment remains visible for the authorised inventory workflow."}</small></span></div>}
        <div className="approval-decision-choice"><button className={decision === "APPROVE" ? "active approve" : ""} onClick={() => setDecision("APPROVE")}><Check />Approve</button><button className={decision === "REJECT" ? "active reject" : ""} onClick={() => setDecision("REJECT")}><XCircle />Reject</button></div>
        <label className="approval-note"><span>{decision === "REJECT" ? "Reason for rejection" : "Decision note (optional)"}</span><textarea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder={decision === "REJECT" ? "Tell the requester what must be corrected" : "Add context for the audit trail"} /></label>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
      <footer><button className="secondary" onClick={onClose}>Cancel</button><button className={`approval-submit ${decision === "REJECT" ? "reject" : ""}`} disabled={!canSave || saving} onClick={() => void save()}>{saving ? "Saving decision…" : decision === "APPROVE" ? "Approve request" : "Reject request"}</button></footer>
    </section>
  </div>;
}

export function ApprovalsPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const requestedId = params.get("approvalId");
  const [tab, setTab] = useState<Tab>("PENDING");
  const [approvals, setApprovals] = useState<OwnerApproval[]>([]);
  const [selected, setSelected] = useState<OwnerApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setApprovals((await api.approvals()).approvals); }
    catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : "Approvals could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const approval = approvals.find(item => item.id === requestedId);
    if (!approval) return;
    setTab(approval.status === 'PENDING' ? 'PENDING' : 'REVIEWED');
    if (approval.status === 'PENDING') setSelected(approval);
    else document.getElementById(`approval-${approval.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [approvals, requestedId]);
  const visible = useMemo(() => approvals.filter(item => tab === "PENDING" ? item.status === "PENDING" : item.status !== "PENDING"), [approvals, tab]);
  const pendingCount = approvals.filter(item => item.status === "PENDING").length;

  if (user?.role !== "OWNER") return <Navigate to="/" replace />;

  return <main className="page approvals-page">
    <div className="page-heading"><div><span className="eyebrow">Owner control</span><h1>Approvals</h1><p>Review exceptional stock, price and product changes before they affect trusted records.</p></div><button className="secondary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} />Refresh</button></div>
    <section className="approval-overview"><span><ShieldCheck /></span><div><small>Pending owner decisions</small><strong>{pendingCount}</strong><p>Nothing is approved automatically. Every decision records who reviewed it and when.</p></div></section>
    <div className="approval-tabs" role="tablist"><button className={tab === "PENDING" ? "active" : ""} onClick={() => setTab("PENDING")}>Pending <b>{pendingCount}</b></button><button className={tab === "REVIEWED" ? "active" : ""} onClick={() => setTab("REVIEWED")}>Reviewed</button></div>
    {error ? <div className="form-error">{error}</div> : null}
    {loading ? <div className="approval-loading"><RefreshCw className="spin" />Loading approvals…</div> : visible.length === 0 ? <section className="approval-empty"><Check /><h2>{tab === "PENDING" ? "No approvals waiting" : "No reviewed requests yet"}</h2><p>{tab === "PENDING" ? "New price, stock or product requests will appear here for the owner." : "Completed decisions will remain here as an audit trail."}</p></section> : <div className="approval-list">{visible.map(approval => {
      const evidence = objectFrom(approval.evidence); const path = typeof evidence.evidencePath === "string" ? evidence.evidencePath : null;
      return <article id={`approval-${approval.id}`} key={approval.id} className={`approval-card ${approval.status.toLowerCase()}`}><header><span className="approval-type-icon">{approval.actionType === "PRODUCT_PRICE_CHANGE" ? <SlidersHorizontal /> : <PackageCheck />}</span><div><small>{approval.station.name} · {dateTime(approval.requestedAt)}</small><h2>{approvalTitle(approval)}</h2><p>Requested by {approval.requestedBy.name}</p></div><em>{approval.status === "PENDING" ? <><Clock3 />Waiting</> : approval.status === "APPROVED" ? <><Check />Approved</> : <><XCircle />Rejected</>}</em></header><ApprovalSummary approval={approval} /><p className="approval-card-reason">{approval.reason}</p><footer>{path ? <Link to={path}><ExternalLink />View evidence</Link> : <span />}{approval.status === "PENDING" ? <button onClick={() => setSelected(approval)}>Review decision <ArrowRight /></button> : <small>{approval.decidedBy?.name ?? "Owner"} · {approval.decidedAt ? dateTime(approval.decidedAt) : "Reviewed"}{approval.decisionNote ? ` · ${approval.decisionNote}` : ""}</small>}</footer></article>;
    })}</div>}
    {selected ? <DecisionDialog approval={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void load(); }} /> : null}
  </main>;
}
