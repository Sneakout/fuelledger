export type PurchaseReviewInvoice = {
  id: string; supplierId: string; supplier: string; invoiceNumber: string; invoiceDate: string; dueDate: string; totalAmount: number; outstanding: number; status: string;
  lines: Array<{ id: string; productId: string | null; product: string; unit: string; quantity: number; receivedQuantity: number; unitCost: number; agreedRate: number | null; taxRate: number; agreedTaxRate: number | null }>;
  receiptId: string | null; correctionCount: number;
};
export type UnmatchedPurchaseReceipt = { id: string; supplier: string; referenceNo: string | null; receivedAt: string; lines: Array<{ productId: string; product: string; unit: string; quantity: number }> };

export function analyzePurchases(invoices: PurchaseReviewInvoice[], unmatchedReceipts: UnmatchedPurchaseReceipt[], asOf: Date) {
  const findings: any[] = [];
  for (let leftIndex = 0; leftIndex < invoices.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < invoices.length; rightIndex += 1) {
    const left = invoices[leftIndex]!, right = invoices[rightIndex]!;
    if (left.supplierId !== right.supplierId || Math.abs(Date.parse(left.invoiceDate) - Date.parse(right.invoiceDate)) > 7 * 86_400_000 || Math.abs(left.totalAmount - right.totalAmount) > .01 || lineSignature(left) !== lineSignature(right)) continue;
    findings.push({ type: "PURCHASE_DUPLICATE_CANDIDATE", status: "CANDIDATE_ONLY", invoiceId: left.id, relatedInvoiceId: right.id, title: `${left.supplier}'s invoices ${left.invoiceNumber} and ${right.invoiceNumber} may be duplicates`, explanation: "The supplier, compatible product lines, units, tax rates, dates and total match closely. This is a review candidate, not a confirmed duplicate.", severity: "ATTENTION" });
  }
  for (const invoice of invoices) {
    for (const line of invoice.lines) {
      if (line.agreedRate !== null && line.productId && line.unit && line.agreedTaxRate !== null && Math.abs(line.taxRate - line.agreedTaxRate) <= .001 && Math.abs(line.unitCost - line.agreedRate) > .01)
        findings.push({ type: "PURCHASE_RATE_DISCREPANCY", invoiceId: invoice.id, receiptId: invoice.receiptId, lineId: line.id, title: `${invoice.supplier}'s ${invoice.invoiceNumber} rate needs review`, explanation: `${line.product} was invoiced at ${money(line.unitCost)} per ${line.unit}; the effective agreed rate for the same product, unit, tax and invoice date is ${money(line.agreedRate)}.`, severity: "ATTENTION", difference: line.unitCost - line.agreedRate });
      const difference = line.receivedQuantity - line.quantity;
      if (invoice.receiptId && Math.abs(difference) > .001) findings.push({ type: "PURCHASE_QUANTITY_DIFFERENCE", invoiceId: invoice.id, receiptId: invoice.receiptId, lineId: line.id, title: `${invoice.supplier}'s ${invoice.invoiceNumber} quantity needs review`, explanation: `${line.quantity} ${line.unit} was invoiced and ${line.receivedQuantity} ${line.unit} was received for ${line.product}.${difference < 0 ? " This may be a partial delivery; verify before treating it as a shortage." : " The receipt exceeds the invoiced quantity."}${invoice.correctionCount ? ` ${invoice.correctionCount} correction record${invoice.correctionCount === 1 ? " is" : "s are"} attached.` : ""}`, severity: "ATTENTION", invoicedQuantity: line.quantity, receivedQuantity: line.receivedQuantity, difference, deliveryStatus: difference < 0 ? "PARTIAL_OR_SHORT" : "OVER_RECEIVED", correctionCount: invoice.correctionCount });
    }
    const daysOverdue = Math.max(0, Math.floor((day(asOf).getTime() - day(new Date(invoice.dueDate)).getTime()) / 86_400_000));
    if (invoice.outstanding > .005 && daysOverdue > 0 && invoice.status !== "VOID") findings.push({ type: "SUPPLIER_PAYMENT_OVERDUE", invoiceId: invoice.id, receiptId: invoice.receiptId, title: `${invoice.supplier}'s ${invoice.invoiceNumber} payment is overdue`, explanation: `${money(invoice.outstanding)} remains payable ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} after the due date.${invoice.outstanding < invoice.totalAmount ? " A partial payment is recorded." : ""}`, severity: daysOverdue >= 30 ? "URGENT" : "ATTENTION", daysOverdue, outstanding: invoice.outstanding, paymentStatus: invoice.outstanding < invoice.totalAmount ? "PART_PAID_OVERDUE" : "OVERDUE" });
  }
  for (const receipt of unmatchedReceipts) findings.push({ type: "PURCHASE_RECEIPT_UNMATCHED", receiptId: receipt.id, title: `${receipt.supplier}'s receipt is not matched to an invoice`, explanation: `Receipt ${receipt.referenceNo ?? receipt.id} dated ${receipt.receivedAt.slice(0, 10)} has recorded stock lines but no linked supplier invoice.`, severity: "ATTENTION" });
  return findings;
}

const lineSignature = (invoice: PurchaseReviewInvoice) => invoice.lines.map(line => `${line.productId ?? line.product}|${line.unit}|${line.taxRate}|${line.quantity}`).sort().join(";");
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const day = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
