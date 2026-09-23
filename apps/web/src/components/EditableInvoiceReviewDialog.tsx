import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileCheck2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { IndianInvoiceLine, ParsedIndianInvoice } from "../lib/indian-invoice-parser";

export type EditableInvoiceLine = {
  id: string;
  product: IndianInvoiceLine["product"];
  description: string;
  hsnCode: string;
  quantity: string;
  unit: string;
  unitRate: string;
  taxRate: string;
};

export type EditableInvoiceDraft = {
  supplierName: string;
  supplierGSTIN: string;
  consigneeName?: string;
  consigneeCode?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  taxAmount: string;
  purchasePriceExcludedAmount?: string;
  totalAmount: string;
  lines: EditableInvoiceLine[];
};

export function createEditableInvoiceDraft(invoice: ParsedIndianInvoice): EditableInvoiceDraft {
  return {
    supplierName: invoice.supplierName?.value ?? "",
    supplierGSTIN: invoice.supplierGSTIN?.value ?? "",
    consigneeName: invoice.consigneeName?.value ?? "",
    consigneeCode: invoice.consigneeCode?.value ?? "",
    invoiceNumber: invoice.invoiceNumber?.value ?? "",
    invoiceDate: invoice.invoiceDate?.value ?? "",
    dueDate: invoice.dueDate?.value ?? "",
    taxAmount: invoice.tax.total === null ? "" : decimal(invoice.tax.total),
    purchasePriceExcludedAmount: "",
    totalAmount: invoice.totalAmount ? decimal(invoice.totalAmount.value) : "",
    lines: invoice.lines.length ? invoice.lines.map(toEditableLine) : [emptyInvoiceLine()],
  };
}

export function validateEditableInvoiceDraft(draft: EditableInvoiceDraft) {
  const errors: string[] = [];
  if (!draft.supplierName.trim()) errors.push("Enter the supplier name.");
  if (!draft.invoiceNumber.trim()) errors.push("Enter the invoice number.");
  if (!validDate(draft.invoiceDate)) errors.push("Enter a valid invoice date.");
  if (draft.dueDate && !validDate(draft.dueDate)) errors.push("Enter a valid due date or leave it blank.");
  if (draft.dueDate && draft.invoiceDate && draft.dueDate < draft.invoiceDate) errors.push("The due date cannot be before the invoice date.");
  if (draft.supplierGSTIN && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/i.test(draft.supplierGSTIN.trim())) errors.push("Check the supplier GST number.");
  if (!positiveNumber(draft.totalAmount)) errors.push("Enter an invoice total greater than zero.");
  if (!nonNegativeNumber(draft.taxAmount, true)) errors.push("Enter a valid tax amount.");
  if (draft.purchasePriceExcludedAmount && !nonNegativeNumber(draft.purchasePriceExcludedAmount, true)) errors.push("Enter a valid excluded adjustment amount.");
  if (number(draft.purchasePriceExcludedAmount ?? "0") >= number(draft.totalAmount)) errors.push("Excluded adjustments must be less than the invoice total.");
  if (!draft.lines.length) errors.push("Add at least one product line.");
  draft.lines.forEach((line, index) => {
    const label = draft.lines.length > 1 ? `Product ${index + 1}` : "Product";
    if (!line.description.trim()) errors.push(`${label}: enter a description.`);
    if (!positiveNumber(line.quantity)) errors.push(`${label}: quantity must be greater than zero.`);
    if (!nonNegativeNumber(line.unitRate)) errors.push(`${label}: enter a valid rate.`);
    if (!nonNegativeNumber(line.taxRate) || number(line.taxRate) > 100) errors.push(`${label}: enter a tax rate from 0 to 100%.`);
    if (line.hsnCode && !/^\d{4,8}$/.test(line.hsnCode.trim())) errors.push(`${label}: HSN must contain 4 to 8 digits.`);
  });
  const total = Number(draft.totalAmount);
  const calculated = calculatedInvoiceTotal(draft);
  if (Number.isFinite(total) && total > 0 && Math.abs(total - calculated) > 1) errors.push(`The product amounts and tax come to ${money(calculated)}, not ${money(total)}.`);
  return [...new Set(errors)];
}

export function calculatedInvoiceSubtotal(draft: EditableInvoiceDraft) {
  return draft.lines.reduce((sum, line) => sum + number(line.quantity) * number(line.unitRate), 0);
}

export function calculatedInvoiceTotal(draft: EditableInvoiceDraft) {
  return calculatedInvoiceSubtotal(draft) + number(draft.taxAmount);
}

export function EditableInvoiceReviewDialog({ fileName, initialDraft, onCancel, onKeep }: { fileName: string; initialDraft: EditableInvoiceDraft; onCancel: () => void; onKeep: (draft: EditableInvoiceDraft) => void }) {
  const [draft, setDraft] = useState<EditableInvoiceDraft>(() => cloneDraft(initialDraft));
  const dialog = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const errors = useMemo(() => validateEditableInvoiceDraft(draft), [draft]);
  const subtotal = calculatedInvoiceSubtotal(draft);
  const total = calculatedInvoiceTotal(draft);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const update = (field: keyof Omit<EditableInvoiceDraft, "lines">, value: string) => setDraft(current => ({ ...current, [field]: value }));
  const updateLine = (id: string, field: keyof Omit<EditableInvoiceLine, "id">, value: string) => setDraft(current => ({ ...current, lines: current.lines.map(line => line.id === id ? { ...line, [field]: value } : line) }));

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('input, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div className="invoice-review-overlay" role="presentation">
    <section ref={dialog} className="invoice-review-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-review-title" onKeyDown={onKeyDown}>
      <header><div><span className="invoice-review-icon"><FileCheck2/></span><span><small>Invoice review</small><h2 id="invoice-review-title">Check every detail</h2><p>{fileName}</p></span></div><button ref={closeButton} type="button" aria-label="Close invoice review" onClick={onCancel}><X/></button></header>
      <form onSubmit={event => { event.preventDefault(); if (!errors.length) onKeep(cloneDraft(draft)); }}>
        <div className="invoice-review-intro"><CheckCircle2/><div><strong>Edit anything that was not read correctly.</strong><p>This is still a draft on this device. Keeping it here will not update purchases, stock, payments or accounts.</p></div></div>

        <fieldset><legend>Invoice</legend><div className="invoice-review-grid">
          <label><span>Supplier name</span><input value={draft.supplierName} onChange={event => update("supplierName", event.target.value)} autoComplete="off"/></label>
          <label><span>Supplier GST number <em>Optional</em></span><input value={draft.supplierGSTIN} onChange={event => update("supplierGSTIN", event.target.value.toUpperCase())} maxLength={15} autoCapitalize="characters" autoComplete="off"/></label>
          <label><span>Delivered to</span><input value={draft.consigneeName ?? ""} onChange={event => update("consigneeName", event.target.value)} autoComplete="off"/></label>
          <label><span>Dealer code <em>Optional</em></span><input value={draft.consigneeCode ?? ""} onChange={event => update("consigneeCode", event.target.value.replace(/[^A-Za-z0-9/-]/g, ""))} autoComplete="off"/></label>
          <label><span>Invoice number</span><input value={draft.invoiceNumber} onChange={event => update("invoiceNumber", event.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off"/></label>
          <label><span>Invoice date</span><input type="date" value={draft.invoiceDate} onChange={event => update("invoiceDate", event.target.value)}/></label>
          <label><span>Due date <em>Optional</em></span><input type="date" value={draft.dueDate} min={draft.invoiceDate || undefined} onChange={event => update("dueDate", event.target.value)}/></label>
          <label><span>Taxes and charges</span><input type="number" inputMode="decimal" min="0" step="0.01" value={draft.taxAmount} onChange={event => update("taxAmount", event.target.value)}/></label>
          <label><span>Non-product adjustments <small>Optional</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={draft.purchasePriceExcludedAmount ?? ""} onChange={event => update("purchasePriceExcludedAmount", event.target.value)} placeholder="Deposits or unrelated charges"/></label>
          <label><span>Invoice total</span><input type="number" inputMode="decimal" min="0" step="0.01" value={draft.totalAmount} onChange={event => update("totalAmount", event.target.value)}/></label>
        </div></fieldset>

        <fieldset aria-labelledby="invoice-products-title"><div className="invoice-review-legend"><strong id="invoice-products-title">Products</strong><button type="button" onClick={() => setDraft(current => ({ ...current, lines: [...current.lines, emptyInvoiceLine()] }))}><Plus/> Add product</button></div>
          <div className="invoice-review-lines">{draft.lines.map((line, index) => <article key={line.id}><header><strong>Product {index + 1}</strong><button type="button" aria-label={`Remove product ${index + 1}`} onClick={() => setDraft(current => ({ ...current, lines: current.lines.filter(item => item.id !== line.id) }))}><Trash2/> Remove</button></header><div className="invoice-line-grid">
            <label className="wide"><span>Description</span><input value={line.description} onChange={event => updateLine(line.id, "description", event.target.value)}/></label>
            <label><span>Product</span><select value={line.product} onChange={event => updateLine(line.id, "product", event.target.value)}>{["HSD", "MS", "PETROL", "DIESEL", "CNG", "DEF", "LUBRICANT", "ETHANOL", "AUTO_LPG", "LNG", "AVIATION_FUEL", "OTHER"].map(product => <option key={product} value={product}>{product === "OTHER" ? "Other" : product.replaceAll("_", " ")}</option>)}</select></label>
            <label><span>HSN <em>Optional</em></span><input inputMode="numeric" value={line.hsnCode} onChange={event => updateLine(line.id, "hsnCode", event.target.value.replace(/\D/g, "").slice(0, 8))}/></label>
            <label><span>Quantity</span><input type="number" inputMode="decimal" min="0" step="0.001" value={line.quantity} onChange={event => updateLine(line.id, "quantity", event.target.value)}/></label>
            <label><span>Unit</span><input value={line.unit} onChange={event => updateLine(line.id, "unit", event.target.value.toUpperCase())} placeholder="L or KL"/></label>
            <label><span>Rate</span><input type="number" inputMode="decimal" min="0" step="0.001" value={line.unitRate} onChange={event => updateLine(line.id, "unitRate", event.target.value)}/></label>
            <label><span>Tax %</span><input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={line.taxRate} onChange={event => updateLine(line.id, "taxRate", event.target.value)}/></label>
            <div className="invoice-line-amount"><span>Base amount</span><strong>{money(number(line.quantity) * number(line.unitRate))}</strong>{number(line.taxRate) > 0 && <small>With product taxes: {money(number(line.quantity) * number(line.unitRate) * (1 + number(line.taxRate) / 100))}</small>}</div>
          </div></article>)}</div>
        </fieldset>

        <section className="invoice-review-totals" aria-label="Calculated invoice totals"><div><span>Products</span><strong>{money(subtotal)}</strong></div><div><span>Taxes & charges</span><strong>{money(number(draft.taxAmount))}</strong></div><div><span>Calculated total</span><strong>{money(total)}</strong></div><div className={Math.abs(number(draft.totalAmount) - total) <= 1 ? "matches" : "differs"}><span>Invoice total</span><strong>{money(number(draft.totalAmount))}</strong></div></section>

        {errors.length > 0 && <section className="invoice-review-errors" aria-live="polite"><AlertTriangle/><div><strong>Check these details before continuing</strong>{errors.slice(0, 4).map(error => <p key={error}>{error}</p>)}</div></section>}
        <footer><div><ShieldCheck/><span><strong>No records will change</strong><small>This only keeps your reviewed draft in this browser tab.</small></span></div><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={errors.length > 0}>Keep reviewed details</button></footer>
      </form>
    </section>
  </div>;
}

function toEditableLine(line: IndianInvoiceLine): EditableInvoiceLine {
  const baseAmount = line.quantity * line.unitRate;
  const taxRate = line.grossAmount && baseAmount > 0 && line.grossAmount >= baseAmount
    ? String(Number((((line.grossAmount - baseAmount) / baseAmount) * 100).toFixed(8)))
    : "0";
  return { id: crypto.randomUUID(), product: line.product, description: line.description, hsnCode: line.hsnCode ?? "", quantity: decimal(line.quantity), unit: line.unit ?? "", unitRate: decimal(line.unitRate), taxRate };
}

function emptyInvoiceLine(): EditableInvoiceLine {
  return { id: crypto.randomUUID(), product: "OTHER", description: "", hsnCode: "", quantity: "", unit: "", unitRate: "", taxRate: "0" };
}

function cloneDraft(draft: EditableInvoiceDraft): EditableInvoiceDraft {
  return { ...draft, lines: draft.lines.map(line => ({ ...line })) };
}

function decimal(value: number) { return String(Number(value.toFixed(3))); }
function number(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function positiveNumber(value: string) { return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0; }
function nonNegativeNumber(value: string, emptyIsZero = false) { return (emptyIsZero && value.trim() === "") || (value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0); }
function validDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
