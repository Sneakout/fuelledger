import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, FileCheck2, PackageX, ShieldCheck, WalletCards, X } from "lucide-react";
import type { EditableInvoiceDraft } from "./EditableInvoiceReviewDialog";
import type { CatalogProduct } from "../lib/api";
import { buildInvoiceChangePreview } from "../lib/invoice-change-preview";
import { assessInvoiceStation, assessSingleProductInvoicePrice } from "../lib/invoice-local-safety";

export function InvoiceChangePreviewDialog({ fileName, draft, stationName, isDemo, catalogProducts = [], onBack, onClose, onContinue }: {
  fileName: string;
  draft: EditableInvoiceDraft;
  stationName: string;
  isDemo: boolean;
  catalogProducts?: CatalogProduct[];
  onBack: () => void;
  onClose: () => void;
  onContinue?: () => void;
}) {
  const preview = useMemo(() => buildInvoiceChangePreview(draft, stationName), [draft, stationName]);
  const stationAssessment = useMemo(() => assessInvoiceStation(draft.consigneeName, stationName), [draft.consigneeName, stationName]);
  const priceAssessment = useMemo(() => assessSingleProductInvoicePrice(draft, catalogProducts), [draft, catalogProducts]);
  const dialog = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div className="invoice-preview-overlay" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialog} className="invoice-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <header><div><span className="invoice-preview-icon"><Eye/></span><span><small>{isDemo ? "Demo preview" : "Preview only"}</small><h2 id="invoice-preview-title">See what this invoice would add</h2><p>{fileName}</p></span></div><button ref={closeButton} type="button" aria-label="Close invoice preview" onClick={onClose}><X/></button></header>

      <div className="invoice-preview-body">
        <section className={`invoice-preview-safety${isDemo ? " demo" : ""}`}><ShieldCheck/><div><strong>{isDemo ? "Your demo records will not change" : "Nothing will be saved yet"}</strong><p>This is a local preview for {preview.stationName}. The document and its details stay in this browser tab.</p></div></section>
        <section className={`invoice-preview-station ${stationAssessment.status.toLowerCase()}`}><ShieldCheck/><div><strong>{stationAssessment.status === "MATCH" ? "Fuel station verified" : "This invoice cannot be submitted"}</strong><p>{stationAssessment.message}</p></div></section>
        {priceAssessment && priceAssessment.direction !== "UNCHANGED" && <section className={`invoice-preview-price ${priceAssessment.direction.toLowerCase()}`}><AlertTriangle/><div><strong>Purchase price {priceAssessment.direction === "INCREASE" ? "increased" : "decreased"}</strong><p>{money(priceAssessment.previousPrice)} to {money(priceAssessment.invoicePrice)} per {priceAssessment.unit}. Review and update the retail selling price if required before the next sale.</p></div></section>}

        <section className="invoice-preview-summary"><span>Supplier invoice</span><h3>{preview.supplierName} · {money(preview.totalAmount)}</h3><p>Invoice {preview.invoiceNumber}, dated {date(preview.invoiceDate)}{preview.dueDate ? ` and due ${date(preview.dueDate)}` : ". A due date has not been set"}.</p><dl><div><dt>Before tax</dt><dd>{money(preview.subtotal)}</dd></div><div><dt>Tax shown</dt><dd>{money(preview.taxAmount)}</dd></div><div><dt>Total due</dt><dd>{money(preview.totalAmount)}</dd></div></dl></section>

        <section className="invoice-preview-section"><header><FileCheck2/><div><h3>Products found</h3><p>Each OCR line is shown separately so product, quantity, rate and tax can be checked.</p></div></header><div className="invoice-preview-products">{preview.products.map((product, index) => { const line = draft.lines[index]; const taxRate = Number(line?.taxRate || 0); const base = product.quantity * product.unitRate; return <article key={`${product.description}-${index}`}><span><strong>{product.description}</strong><small>{line?.product || "Unclassified"}{line?.hsnCode ? ` · HSN ${line.hsnCode}` : ""}</small><small>{number(product.quantity)} {product.unit || "units"} × {money(product.unitRate)} · Tax {number(taxRate)}%</small></span><span className="invoice-preview-product-value"><small>Base {money(base)}</small><strong>{money(base * (1 + taxRate / 100))}</strong></span></article>; })}</div></section>

        <section className="invoice-preview-section"><header><WalletCards/><div><h3>Money that would be recorded</h3><p>Shown in owner-friendly terms, without internal account codes.</p></div></header><div className="invoice-preview-accounting">{preview.accounting.map(item => <article key={item.label}><CheckCircle2/><span><strong>{item.label}</strong><small>{item.explanation}</small></span><strong>{money(item.amount)}</strong></article>)}</div>{Math.abs(preview.debitTotal - preview.creditTotal) <= 0.01 && <p className="invoice-preview-balanced"><CheckCircle2/> The invoice values balance at {money(preview.totalAmount)}.</p>}</section>

        <section className="invoice-preview-excluded"><PackageX/><div><h3>Not included in this preview</h3><p>Stock will not be received, no payment will be recorded, and no supplier, purchase or accounting record will be created.</p></div></section>
      </div>

      <footer><button type="button" className="secondary" onClick={onBack}><ArrowLeft/> Back to edit</button><span><ShieldCheck/> {stationAssessment.status !== "MATCH" ? "Consignee must match this station" : isDemo ? "Demo stays read-only" : "Nothing changes until you confirm"}</span><button type="button" onClick={isDemo || !onContinue || stationAssessment.status !== "MATCH" ? onClose : onContinue}>{isDemo || !onContinue || stationAssessment.status !== "MATCH" ? "Done" : "Continue to confirmation"}</button></footer>
    </section>
  </div>;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function number(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);
}

function date(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
