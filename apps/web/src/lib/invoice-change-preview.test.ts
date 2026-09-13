import { describe, expect, it } from "vitest";
import type { EditableInvoiceDraft } from "../components/EditableInvoiceReviewDialog";
import { buildInvoiceChangePreview } from "./invoice-change-preview";

const draft: EditableInvoiceDraft = {
  supplierName: "Indian Oil Corporation Limited",
  supplierGSTIN: "32AAACI1681G1ZZ",
  invoiceNumber: "20274247B025710",
  invoiceDate: "2026-08-31",
  dueDate: "2026-09-05",
  taxAmount: "254983.76",
  totalAmount: "1207079",
  lines: [{ id: "line-1", product: "HSD", description: "HSD BS-VI", hsnCode: "27101944", quantity: "12", unit: "KL", unitRate: "79341.27", taxRate: "0" }],
};

describe("invoice change preview", () => {
  it("uses only reviewed invoice facts and keeps both sides balanced", () => {
    const preview = buildInvoiceChangePreview(draft, "FuelNerve Petroleum");
    expect(preview).toMatchObject({
      stationName: "FuelNerve Petroleum",
      supplierName: "Indian Oil Corporation Limited",
      invoiceNumber: "20274247B025710",
      subtotal: 952095.24,
      taxAmount: 254983.76,
      totalAmount: 1207079,
    });
    expect(preview.debitTotal).toBe(preview.creditTotal);
    expect(preview.accounting.map(item => item.label)).toEqual(["Goods purchased", "Taxes and charges", "Amount owed to the supplier"]);
  });

  it("does not invent a tax line when the reviewed invoice has no tax", () => {
    const preview = buildInvoiceChangePreview({ ...draft, taxAmount: "0", totalAmount: "952095.24" }, "FuelNerve Petroleum");
    expect(preview.accounting.map(item => item.label)).not.toContain("Tax shown on the invoice");
    expect(preview.debitTotal).toBe(952095.24);
    expect(preview.creditTotal).toBe(952095.24);
  });
});
