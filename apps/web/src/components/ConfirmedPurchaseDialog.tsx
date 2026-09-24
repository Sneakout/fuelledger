import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileCheck2, PackageX, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { InvoiceImportPolicy, ProductForm, ProductPriceApprovalNotice, PurchaseInvoice, PurchasesBootstrap } from "../lib/api";
import { api, ApiRequestError } from "../lib/api";
import { buildConfirmedPurchaseInput, compatibleTanks, findDuplicateInvoice, findMatchingProduct, findMatchingSupplier, onlyCompatibleTankId, validateConfirmedPurchase, validateReceiptSelections } from "../lib/confirmed-purchase-submission";
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
  const [tankIds, setTankIds] = useState<Array<string | null>>([]);
  const [receiveNow, setReceiveNow] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<PurchaseInvoice | null>(null);
  const [recoveredReceipt, setRecoveredReceipt] = useState(false);
  const [priceApprovals, setPriceApprovals] = useState<ProductPriceApprovalNotice[]>([]);
  const [creatingCatalog, setCreatingCatalog] = useState<string | null>(null);
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
        const matchedProducts = draft.lines.map(line => findMatchingProduct(line.description, line.product, line.hsnCode, result.products));
        setProductIds(matchedProducts);
        setTankIds(matchedProducts.map(productId => productId ? onlyCompatibleTankId(result.stations, stationId, productId) : null));
        await recordInvoiceImportPerformance({ stage: "PURCHASE_CHECK", durationMs: Math.min(120_000, Math.round(performance.now() - startedAt)), outcome: "SUCCESS" }, monitored);
      } catch (caught) {
        if (active) setError(caught instanceof ApiRequestError ? caught.message : "Purchase records could not be checked right now.");
        await recordInvoiceImportPerformance({ stage: "PURCHASE_CHECK", durationMs: Math.min(120_000, Math.round(performance.now() - startedAt)), outcome: "FAILED" }, monitored);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [draft, isDemo, stationAssessment.message, stationAssessment.status]);

  const stationAvailable = Boolean(data?.stations.some(station => station.id === stationId));
  const validationErrors = useMemo(() => [
    ...validateConfirmedPurchase(draft, stationAvailable ? stationId : "", supplierId),
    ...validateReceiptSelections(receiveNow, stationId, productIds, tankIds, data?.products ?? [], data?.stations ?? []),
    ...(stationAssessment.status === "MATCH" ? [] : [stationAssessment.message]),
  ], [data, draft, productIds, receiveNow, stationAvailable, stationId, stationAssessment, supplierId, tankIds]);
  const duplicate = findDuplicateInvoice(supplierId, draft.invoiceNumber, data?.invoices ?? []);
  const canReceiveExisting = Boolean(duplicate && !duplicate.receipt && receiveNow);

  const createReviewedSupplier = async () => {
    if (!data || !draft.supplierName.trim() || creatingCatalog) return;
    setCreatingCatalog("supplier"); setError("");
    try {
      const result = await api.createSupplier({ name: draft.supplierName.trim(), code: uniqueCode(draft.supplierName, data.suppliers.map(item => item.code)), taxId: draft.supplierGSTIN.trim() || undefined, paymentTerms: 3, active: true });
      setData(current => current ? { ...current, suppliers: [...current.suppliers, result.supplier] } : current);
      setSupplierId(result.supplier.id); setConfirmed(false);
    } catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : "The reviewed supplier could not be added."); }
    finally { setCreatingCatalog(null); }
  };

  const createReviewedProduct = async (index: number) => {
    if (!data || creatingCatalog) return;
    const line = draft.lines[index];
    if (!line) return;
    setCreatingCatalog(`product-${index}`); setError("");
    try {
      const form = proposedProduct(line, data.products.map(item => item.code), draft.invoiceDate);
      const result = await api.createProduct(form);
      setData(current => current ? { ...current, products: [...current.products, result.product] } : current);
      const nextProducts = [...productIds]; const nextTanks = [...tankIds];
      nextProducts[index] = result.product.id; nextTanks[index] = null;
      setProductIds(nextProducts); setTankIds(nextTanks); setConfirmed(false);
    } catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : "The reviewed product could not be added."); }
    finally { setCreatingCatalog(null); }
  };

  const submit = async () => {
    if (isDemo || !policy?.enabled || saving || created || !confirmed || validationErrors.length || (duplicate && !canReceiveExisting)) return;
    const startedAt = performance.now();
    setSaving(true); setError("");
    try {
      let savedInvoice: PurchaseInvoice;
      let approvals: ProductPriceApprovalNotice[] = [];
      if (canReceiveExisting && duplicate) {
        const result = await api.receiveImportedPurchaseInvoice(duplicate.id, { allocations: duplicate.lines.map((line, index) => ({ invoiceLineId: line.id, productId: productIds[index]!, tankId: tankIds[index] || null })) });
        savedInvoice = result.invoice;
        approvals = result.priceApprovals ?? [];
      } else {
        const result = await api.createImportedPurchaseInvoice(buildConfirmedPurchaseInput(draft, stationId, supplierId, productIds, { receiveNow, tankIds }));
        savedInvoice = result.invoice;
        approvals = result.priceApprovals ?? [];
      }
      setCreated(savedInvoice);
      setRecoveredReceipt(canReceiveExisting);
      setPriceApprovals(approvals);
      onSubmitted(savedInvoice, approvals);
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

      {!loading && created && <div className="invoice-submit-success"><CheckCircle2/><span><small>{recoveredReceipt ? "Stock receipt created" : "Invoice created"}</small><h3>{created.supplier.name} · {money(Number(created.totalAmount))}</h3><p>Invoice {created.invoiceNumber} is recorded as unpaid. {receiveNow ? "The confirmed quantities were added to the selected tanks and inventory." : "Stock and payment were not changed."}</p>{priceApprovals.length > 0 && <div className="invoice-submit-price-alert" role="alert"><AlertTriangle/><span><strong>{priceApprovals.length === 1 ? `${priceApprovals[0]!.evidence.product.code} purchase price changed` : `${priceApprovals.length} purchase prices changed`}</strong><small>The owner has been alerted. Purchase Agent will keep this visible until the purchase and retail selling prices are confirmed.</small></span></div>}</span><button type="button" onClick={onClose}>Done</button></div>}

      {!loading && !created && <div className="invoice-submit-body">
        <section className="invoice-submit-boundary"><ShieldCheck/><div><strong>One unpaid invoice and one stock receipt</strong><p>The source document stays on this device. Confirmed quantities can update inventory and the selected tanks; supplier payment and bank balances will not change.</p></div></section>

        <label className="invoice-submit-stock"><input type="checkbox" checked={receiveNow} onChange={event => { setReceiveNow(event.target.checked); setConfirmed(false); }}/><span><strong>Receive this stock now</strong><small>Creates the receipt and inventory movements at the time you confirm.</small></span></label>

        <label className="invoice-submit-field"><span>Supplier</span><select aria-label="Existing supplier" value={supplierId} onChange={event => { setSupplierId(event.target.value); setConfirmed(false); }} disabled={!data || isDemo || Boolean(creatingCatalog)}><option value="">No matching supplier found</option>{data?.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.taxId ? ` · ${supplier.taxId}` : ""}</option>)}</select>{supplierId ? <small className="invoice-match-note matched">Matched to an existing supplier. Confirm the selection.</small> : <span className="invoice-new-record"><small className="invoice-match-note new">New supplier recognised · {draft.supplierName}{draft.supplierGSTIN ? ` · GSTIN ${draft.supplierGSTIN}` : ""}</small><button type="button" disabled={isDemo || Boolean(creatingCatalog)} onClick={() => void createReviewedSupplier()}>{creatingCatalog === "supplier" ? "Adding…" : "Add reviewed supplier"}</button></span>}</label>

        <section className="invoice-submit-lines"><header><div><h3>Products and receiving tanks</h3><p>Each OCR line remains separate. Confirm product, quantity, rate, tax and receiving tank before saving.</p></div></header>{draft.lines.map((line, index) => { const productId = productIds[index] ?? ""; const product = data?.products.find(item => item.id === productId); const tanks = compatibleTanks(data?.stations ?? [], stationId, productId); const base=Number(line.quantity)*Number(line.unitRate); return <article key={line.id}><span><strong>{line.description}</strong><small>{line.product || "Unclassified"}{line.hsnCode ? ` · HSN ${line.hsnCode}` : ""}</small><small>{number(Number(line.quantity))} {line.unit || "units"} × {money(Number(line.unitRate))} · Tax {number(Number(line.taxRate)||0)}% · Base {money(base)}</small><em className={productId ? "matched" : "new"}>{productId ? `Matched · ${product?.name}` : "New product recognised · review before adding"}</em></span><div className="invoice-submit-line-fields"><select aria-label={`Product for ${line.description}`} value={productId} onChange={event => { const selectedProductId = event.target.value || null; const nextProducts = [...productIds]; const nextTanks = [...tankIds]; nextProducts[index] = selectedProductId; nextTanks[index] = selectedProductId && data ? onlyCompatibleTankId(data.stations, stationId, selectedProductId) : null; setProductIds(nextProducts); setTankIds(nextTanks); setConfirmed(false); }} disabled={!data || isDemo || Boolean(creatingCatalog)}><option value="">No matching product found</option>{data?.products.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select>{!productId && <button type="button" className="invoice-add-record" disabled={isDemo || Boolean(creatingCatalog)} onClick={() => void createReviewedProduct(index)}>{creatingCatalog === `product-${index}` ? "Adding…" : "Add reviewed product"}</button>}{receiveNow && product?.tankLinked && <select aria-label={`Receiving tank for ${line.description}`} value={tankIds[index] ?? ""} onChange={event => { const next = [...tankIds]; next[index] = event.target.value || null; setTankIds(next); setConfirmed(false); }} disabled={!data || isDemo}><option value="">Choose receiving tank</option>{tanks.map(tank => <option key={tank.id} value={tank.id}>{tank.code}</option>)}</select>}</div></article>; })}</section>

        <dl className="invoice-submit-facts"><div><dt>Invoice</dt><dd>{draft.invoiceNumber}</dd></div><div><dt>Invoice date</dt><dd>{date(draft.invoiceDate)}</dd></div><div><dt>Due date · T+3</dt><dd>{dueDate ? date(dueDate) : "Check invoice date"}</dd></div><div><dt>Unpaid amount</dt><dd>{money(Number(draft.totalAmount))}</dd></div></dl>

        {duplicate && <section className={canReceiveExisting ? "invoice-submit-boundary" : "invoice-submit-warning"}><AlertTriangle/><div><strong>{canReceiveExisting ? "Invoice exists; stock receipt is missing" : "This invoice already exists"}</strong><p>{canReceiveExisting ? "FuelNerve will keep the existing invoice and create only its missing inventory receipt." : `${duplicate.supplier.name} invoice ${duplicate.invoiceNumber} is already recorded. It has not been submitted again.`}</p></div></section>}
        {!duplicate && validationErrors.length > 0 && <section className="invoice-submit-warning"><AlertTriangle/><div><strong>Review this before continuing</strong>{validationErrors.slice(0, 3).map(item => <p key={item}>{item}</p>)}</div></section>}
        {error && <p className="invoice-submit-error" role="alert">{error}</p>}

        {!isDemo && policy?.enabled && (!duplicate || canReceiveExisting) && validationErrors.length === 0 && <label className="invoice-submit-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span><strong>I checked the supplier, products, tanks, dates and amount.</strong><small>{canReceiveExisting ? "Keep the existing invoice and create only its missing stock receipt." : `Create it as unpaid${receiveNow ? " and add the confirmed quantities to stock" : " without changing stock"}. Payment remains unchanged.`}</small></span></label>}
        {isDemo && <section className="invoice-submit-warning"><PackageX/><div><strong>Demo stays read-only</strong><p>You can inspect this confirmation, but the demo cannot create an invoice.</p></div></section>}
      </div>}

      {!loading && !created && <footer><button type="button" className="secondary" disabled={saving} onClick={onBack}>Back to preview</button><button type="button" disabled={isDemo || !policy?.enabled || saving || !confirmed || validationErrors.length > 0 || Boolean(duplicate && !canReceiveExisting)} onClick={() => void submit()}>{saving ? "Saving…" : `${canReceiveExisting ? "Receive stock for existing invoice" : receiveNow ? "Create invoice & receive stock" : "Create unpaid invoice"} · ${money(Number(draft.totalAmount))}`}</button></footer>}
    </section>
  </div>;
}

function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
function number(value: number) { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value); }
function uniqueCode(value: string, existing: string[]) {
  const base = value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "OCR-RECORD";
  const used = new Set(existing.map(item => item.toUpperCase()));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) { const code = `${base.slice(0, 20)}-${suffix}`; if (!used.has(code)) return code; }
  return `${base.slice(0, 16)}-${Date.now().toString().slice(-6)}`;
}
function proposedProduct(line: EditableInvoiceDraft["lines"][number], existingCodes: string[], invoiceDate: string): ProductForm {
  const classification = line.product.toUpperCase();
  const isFuel = ["MS", "HSD", "PETROL", "DIESEL", "EBMS"].some(value => classification.includes(value));
  const isDef = classification.includes("DEF");
  const sourceUnit = line.unit.toUpperCase().replace(/[^A-Z]/g, "");
  const unit = sourceUnit === "KG" || sourceUnit === "KILOGRAM" ? "KILOGRAM" : sourceUnit === "L" || sourceUnit === "LTR" || sourceUnit === "LITRE" || sourceUnit === "KL" ? "LITRE" : "UNIT";
  const purchasePrice = Math.max(0, Number(line.unitRate) / (sourceUnit === "KL" && unit === "LITRE" ? 1000 : 1));
  return { name: line.description.trim(), code: uniqueCode(line.product || line.description, existingCodes), hsnCode: line.hsnCode.trim(), category: isFuel ? "FUEL" : isDef ? "DEF" : "OTHER", unit, purchasePrice, ...(invoiceDate ? { purchasePriceEffectiveFrom: `${invoiceDate}T00:00:00.000Z` } : {}), sellingPrice: purchasePrice, inventoryTracked: true, tankLinked: false, meterLinked: false, isService: false, active: true, taxCategoryId: null, customCategoryId: null };
}
function date(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
