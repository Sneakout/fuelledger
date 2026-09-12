import { describe, expect, it } from "vitest";
import { analyzePurchases, type PurchaseReviewInvoice } from "../src/modules/nerve/purchase-analysis.js";

const asOf = new Date("2026-09-12T12:00:00.000Z");
const invoice = (overrides: Partial<PurchaseReviewInvoice> = {}): PurchaseReviewInvoice => ({ id: "invoice-1", supplierId: "supplier-1", supplier: "IndianOil", invoiceNumber: "IO-100", invoiceDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-09-05T00:00:00.000Z", totalAmount: 910_000, outstanding: 410_000, status: "PART_PAID", receiptId: "receipt-1", correctionCount: 1, lines: [{ id: "line-1", productId: "hsd", product: "HSD", unit: "L", quantity: 10_000, receivedQuantity: 8_000, unitCost: 91, agreedRate: 90, taxRate: 18, agreedTaxRate: 18 }], ...overrides });

describe("purchase analysis", () => {
  it("detects compatible duplicate candidates but never confirms a duplicate", () => {
    const findings = analyzePurchases([invoice(), invoice({ id: "invoice-2", invoiceNumber: "IO-101", receiptId: "receipt-2" })], [], asOf);
    const duplicate = findings.find(row => row.type === "PURCHASE_DUPLICATE_CANDIDATE");
    expect(duplicate.status).toBe("CANDIDATE_ONLY");
    expect(duplicate.explanation).toMatch(/not a confirmed duplicate/i);
  });

  it("does not compare duplicate or rate candidates across incompatible product, unit, tax or date contexts", () => {
    const incompatible = invoice({ id: "invoice-2", invoiceNumber: "IO-101", invoiceDate: "2026-08-01T00:00:00.000Z", lines: [{ ...invoice().lines[0]!, productId: "ms", unit: "KL", taxRate: 12, agreedTaxRate: 18 }] });
    const findings = analyzePurchases([invoice(), incompatible], [], asOf);
    expect(findings.some(row => row.type === "PURCHASE_DUPLICATE_CANDIDATE")).toBe(false);
    expect(findings.filter(row => row.type === "PURCHASE_RATE_DISCREPANCY")).toHaveLength(1);
  });

  it("reports rate, partial receipt, correction and partial overdue payment from current records", () => {
    const findings = analyzePurchases([invoice()], [], asOf);
    expect(findings.find(row => row.type === "PURCHASE_RATE_DISCREPANCY")?.explanation).toMatch(/₹91.*₹90/);
    expect(findings.find(row => row.type === "PURCHASE_QUANTITY_DIFFERENCE")).toMatchObject({ deliveryStatus: "PARTIAL_OR_SHORT", correctionCount: 1 });
    expect(findings.find(row => row.type === "SUPPLIER_PAYMENT_OVERDUE")).toMatchObject({ outstanding: 410_000, paymentStatus: "PART_PAID_OVERDUE", daysOverdue: 7 });
  });

  it("reports unmatched receipts and ignores paid or not-yet-due supplier payments", () => {
    const findings = analyzePurchases([invoice({ status: "PAID", outstanding: 0 }), invoice({ id: "future", invoiceNumber: "IO-200", dueDate: "2026-09-20T00:00:00.000Z", outstanding: 100 })], [{ id: "receipt-x", supplier: "IndianOil", referenceNo: "GRN-9", receivedAt: "2026-09-10T00:00:00.000Z", lines: [{ productId: "hsd", product: "HSD", unit: "L", quantity: 100 }] }], asOf);
    expect(findings.filter(row => row.type === "SUPPLIER_PAYMENT_OVERDUE")).toHaveLength(0);
    expect(findings.find(row => row.type === "PURCHASE_RECEIPT_UNMATCHED")?.receiptId).toBe("receipt-x");
  });
});
