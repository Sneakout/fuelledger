import { calculatedInvoiceSubtotal, type EditableInvoiceDraft } from "../components/EditableInvoiceReviewDialog";

export type InvoiceChangePreview = {
  stationName: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  products: Array<{ description: string; quantity: number; unit: string; unitRate: number; amount: number }>;
  accounting: Array<{ label: string; explanation: string; amount: number; side: "increase" | "owed" }>;
  debitTotal: number;
  creditTotal: number;
};

/** Builds a display-only preview from owner-reviewed facts. It never calls an API. */
export function buildInvoiceChangePreview(draft: EditableInvoiceDraft, stationName: string): InvoiceChangePreview {
  const subtotal = roundMoney(calculatedInvoiceSubtotal(draft));
  const taxAmount = roundMoney(asNumber(draft.taxAmount));
  const totalAmount = roundMoney(asNumber(draft.totalAmount));

  return {
    stationName: stationName.trim() || "the selected fuel station",
    supplierName: draft.supplierName.trim(),
    invoiceNumber: draft.invoiceNumber.trim(),
    invoiceDate: draft.invoiceDate,
    dueDate: draft.dueDate || null,
    subtotal,
    taxAmount,
    totalAmount,
    products: draft.lines.map(line => ({
      description: line.description.trim(),
      quantity: asNumber(line.quantity),
      unit: line.unit.trim(),
      unitRate: asNumber(line.unitRate),
      amount: roundMoney(asNumber(line.quantity) * asNumber(line.unitRate)),
    })),
    accounting: [
      { label: "Goods purchased", explanation: "The value before tax would be recorded from this invoice.", amount: subtotal, side: "increase" },
      ...(taxAmount > 0 ? [{ label: "Taxes and charges", explanation: "The extracted components still need to be checked before any tax treatment is applied.", amount: taxAmount, side: "increase" as const }] : []),
      { label: "Amount owed to the supplier", explanation: "The full invoice would remain unpaid until a payment is recorded.", amount: totalAmount, side: "owed" },
    ],
    debitTotal: roundMoney(subtotal + taxAmount),
    creditTotal: totalAmount,
  };
}

function asNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
