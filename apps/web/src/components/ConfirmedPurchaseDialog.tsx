import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileCheck2, PackageX, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { InvoiceImportPolicy, ProductPriceApprovalNotice, PurchaseInvoice, PurchasesBootstrap } from "../lib/api";
import { api, ApiRequestError } from "../lib/api";
import { buildConfirmedPurchaseInput, findDuplicateInvoice, findMatchingProduct, findMatchingSupplier, validateConfirmedPurchase } from "../lib/confirmed-purchase-submission";
import { flushInvoiceImportPerformance, recordInvoiceImportPerformance } from "../lib/invoice-import-performance";
import type { EditableInvoiceDraft } from "./EditableInvoiceReviewDialog";
import { assessInvoiceStation } from "../lib/invoice-local-safety";
import { defaultPurchaseDueDate } from "../lib/purchase-due-date";

export function ConfirmedPurchaseDialog({ draft, stationId, stationName, isDemo, onBack, onClose, onSubmitted }: {
  draft: EditableInvoiceDraft;
  stationId: string;
  stationName: string;
  isDemo: boolean;
  onBack: () => void;
  onClose: () => void;
  onSubmitted: (invoice: PurchaseInvoice, priceApprovals: ProductPriceApprovalNotice[]) => void;
}) {
  const dialog = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const [data, setData] = useState<PurchasesBootstrap | null>(null);
  const [policy, setPolicy] = useState<InvoiceImportPolicy | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [productIds, setProductIds] = useState<Array<string | null>>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<PurchaseInvoice | null>(null);
  const [priceApprovals, setPriceApprovals] = useState<ProductPriceApprovalNotice[]>([]);
  const stationAssessment = useMemo(() => assessInvoiceStation(draft.consigneeName, stationName), [draft.consigneeName, stationName]);
  const dueDate = draft.dueDate || defaultPurchaseDueDate(draft.invoiceDate);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let active = true;
    if (isDemo) { setLoading(false); setError("Demo mode is read-only. Create your account before adding invoices."); return () => { active = false; }; }
    if (stationAssessment.status !== "MATCH") { setLoading(false); setError(stationAssessment.message); return () => { active = false; }; }
    const startedAt = performance.now();
    void (async () => {
      let monitored = false;
      try {
        const release = await api.invoiceImportPolicy();
        monitored = release.monitored;
        if (!active) return;
        setPolicy(release);
        await flushInvoiceImportPerformance(release.monitored);
        if (!release.enabled) { setError("Confirmed invoice import is being released gradually and is not available for this account yet."); return; }
        const result = await api.purchasesBootstrap();
        if (!active) return;
        const activeSuppliers = result.suppliers.filter(supplier => supplier.active);
        setData({ ...result, suppliers: activeSuppliers });
        setSupplierId(findMatchingSupplier(draft, activeSuppliers));
        setProductIds(draft.lines.map(line => findMatchingProduct(line.description, line.product, line.hsnCode, result.products)));
        await recordInvoiceImportPerformance({ stage: "PURCHASE_CHECK", durationMs: Math.min(120_000, Math.round(performance.now() - startedAt)), outcome: "SUCCESS" }, monitored);
      } catch (caught) {
        if (active) setError(caught instanceof ApiRequestError ? caught.message : "Purchase records could not be checked right now.");
        await recordInvoiceImportPerformance({ stage: "PURCHASE_CHECK", durationMs: Math.min(120_000, Math.round(performance.now() - startedAt)), outcome: "FAILED" }, monitored);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [draft, isDemo, stationAssessment.message, stationAssessment.status]);

  const stationAvailable = Boolean(data?.stations.some(station => station.id === stationId));
  const validationErrors = useMemo(() => [...validateConfirmedPurchase(draft, stationAvailable ? stationId : "", supplierId), ...(stationAssessment.status === "MATCH" ? [] : [stationAssessment.message])], [draft, stationAvailable, stationId, supplierId, stationAssessment]);
  const duplicate = findDuplicateInvoice(supplierId, draft.invoiceNumber, data?.invoices ?? []);

  const submit = async () => {
    if (isDemo || !policy?.enabled || saving || created || !confirmed || validationErrors.length || duplicate) return;
    const startedAt = performance.now();
    setSaving(true); setError("");
    try {
      const input = buildConfirmedPurchaseInput(draft, stationId, supplierId, productIds);
      const result = await api.createImportedPurchaseInvoice(input);
      const approvals = result.priceApprovals ?? [];
      setCreated(result.invoice);
      setPriceApprovals(approvals);
      onSubmitted(result.invoice, approvals);
      window.dispatchEvent(new Event("fuelnerve:records-changed"));
      await recordInvoiceImportPerformance({ stage: "SUBMISSION", durationMs: Math.min(120_000, Math.round(performance.now() - startedAt)), outcome: "SUCCESS" }, Boolean(policy.monitored));
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : caught instanceof Error ? caught.message : "The invoice could not be created safely.");
      await recordInvoiceImportPerformance({ stage: "SUBMISSION", durationMs: Math.min(120_000, Math.round(performance.now() - startedAt)), outcome: "FAILED" }, Boolean(policy?.monitored));
    } finally { setSaving(false); }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !saving) { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div className="invoice-submit-overlay" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !saving) onClose(); }}>
    <section ref={dialog} className="invoice-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-submit-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <header><div><span className="invoice-submit-icon"><FileCheck2/></span><span><small>Final confirmation</small><h2 id="invoice-submit-title">Create this supplier invoice?</h2><p>{stationName} · {draft.supplierName}</p></span></div><button ref={closeButton} type="button" aria-label="Close invoice confirmation" disabled={saving} onClick={onClose}><X/></button></header>

      {loading && <div className="invoice-submit-loading"><RefreshCw className="spinning"/><strong>Checking suppliers and purchase records…</strong><p>I’m making sure this invoice can be added to the selected fuel station.</p></div>}

      {!loading && created && <div className="invoice-submit-success"><CheckCircle2/><span><small>Invoice created</small><h3>{created.supplier.name} · {money(Number(created.totalAmount))}</h3><p>Invoice {created.invoiceNumber} is now recorded as unpaid. Stock and payment were not changed.</p>{priceApprovals.length > 0 && <div className="invoice-submit-price-alert" role="alert"><AlertTriangle/><span><strong>{priceApprovals.length === 1 ? `${priceApprovals[0]!.evidence.product.code} purchase price changed` : `${priceApprovals.length} purchase prices changed`}</strong><small>The owner has been alerted. Purchase Agent will keep this visible until the purchase and retail selling prices are confirmed.</small></span></div>}</span><button type="button" onClick={onClose}>Done</button></div>}

      {!loading && !created && <div className="invoice-submit-body">
        <section className="invoice-submit-boundary"><ShieldCheck/><div><strong>Only one unpaid invoice will be created</strong><p>The source document stays on this device. Stock, tanks, supplier payments and bank balances will not change.</p></div></section>

        <label className="invoice-submit-field"><span>Existing supplier</span><select aria-label="Existing supplier" value={supplierId} onChange={event => { setSupplierId(event.target.value); setConfirmed(false); }} disabled={!data || isDemo}><option value="">Choose the supplier</option>{data?.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.taxId ? ` · ${supplier.taxId}` : ""}</option>)}</select><small>{supplierId ? "Please confirm that this is the supplier named on the document." : "FuelNerve will not create a new supplier automatically."}</small></label>

        <section className="invoice-submit-lines"><header><div><h3>Product links</h3><p>Link a product only when it is clearly the same item. This does not receive stock.</p></div></header>{draft.lines.map((line, index) => <article key={line.id}><span><strong>{line.description}</strong><small>{number(Number(line.quantity))} {line.unit || "units"} · {money(Number(line.quantity) * Number(line.unitRate))}</small></span><select aria-label={`Product for ${line.description}`} value={productIds[index] ?? ""} onChange={event => { const next = [...productIds]; next[index] = event.target.value || null; setProductIds(next); setConfirmed(false); }} disabled={!data || isDemo}><option value="">Keep description only</option>{data?.products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.code}</option>)}</select></article>)}</section>

        <dl className="invoice-submit-facts"><div><dt>Invoice</dt><dd>{draft.invoiceNumber}</dd></div><div><dt>Invoice date</dt><dd>{date(draft.invoiceDate)}</dd></div><div><dt>Due date · T+3</dt><dd>{dueDate ? date(dueDate) : "Check invoice date"}</dd></div><div><dt>Unpaid amount</dt><dd>{money(Number(draft.totalAmount))}</dd></div></dl>

        {duplicate && <section className="invoice-submit-warning"><AlertTriangle/><div><strong>This invoice already exists</strong><p>{duplicate.supplier.name} invoice {duplicate.invoiceNumber} is already recorded. It has not been submitted again.</p></div></section>}
        {!duplicate && validationErrors.length > 0 && <section className="invoice-submit-warning"><AlertTriangle/><div><strong>Review this before continuing</strong>{validationErrors.slice(0, 3).map(item => <p key={item}>{item}</p>)}</div></section>}
        {error && <p className="invoice-submit-error" role="alert">{error}</p>}

        {!isDemo && policy?.enabled && !duplicate && validationErrors.length === 0 && <label className="invoice-submit-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span><strong>I checked the supplier, invoice number, dates and amount.</strong><small>Create it as unpaid. I understand that stock and payment remain unchanged.</small></span></label>}
        {isDemo && <section className="invoice-submit-warning"><PackageX/><div><strong>Demo stays read-only</strong><p>You can inspect this confirmation, but the demo cannot create an invoice.</p></div></section>}
      </div>}

      {!loading && !created && <footer><button type="button" className="secondary" disabled={saving} onClick={onBack}>Back to preview</button><button type="button" disabled={isDemo || !policy?.enabled || saving || !confirmed || validationErrors.length > 0 || Boolean(duplicate)} onClick={() => void submit()}>{saving ? "Creating invoice…" : `Create unpaid invoice · ${money(Number(draft.totalAmount))}`}</button></footer>}
    </section>
  </div>;
}

function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
function number(value: number) { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value); }
function date(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
