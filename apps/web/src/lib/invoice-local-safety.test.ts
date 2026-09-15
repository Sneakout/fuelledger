import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "./api";
import type { EditableInvoiceDraft } from "../components/EditableInvoiceReviewDialog";
import { assessInvoiceStation, assessSingleProductInvoicePrice } from "./invoice-local-safety";

const product = {
  id: "hsd-1", name: "High Speed Diesel", code: "HSD", hsnCode: "27101944", category: "FUEL", unit: "L",
  purchasePrice: "99.50", purchasePriceHistory: [], sellingPrice: "102", sellingPriceHistory: [], inventoryTracked: true,
  tankLinked: true, meterLinked: true, isService: false, active: true, taxCategoryId: null, customCategoryId: null,
  taxCategory: null, customCategory: null,
} satisfies CatalogProduct;

const draft = {
  supplierName: "Indian Oil Corporation Limited", supplierGSTIN: "", consigneeName: "Saleema Petroleum", consigneeCode: "187714",
  invoiceNumber: "20274247B025710", invoiceDate: "2026-08-31", dueDate: "", taxAmount: "254983.76", totalAmount: "1207079",
  lines: [{ id: "line-1", product: "HSD", description: "HSD-BSVI", hsnCode: "27101944", quantity: "12", unit: "KL", unitRate: "79341.27", taxRate: "0" }],
} satisfies EditableInvoiceDraft;

describe("local invoice safety", () => {
  it("matches a consignee to the selected station without sending the document", () => {
    expect(assessInvoiceStation("Saleema Petroleum", "Saleema Petroleum").status).toBe("MATCH");
    expect(assessInvoiceStation("Saleema Petroleum", "Station C")).toMatchObject({ status: "MISMATCH" });
    expect(assessInvoiceStation("", "Station C")).toMatchObject({ status: "UNKNOWN" });
  });

  it("calculates a landed litre price from one KL product and the full invoice total", () => {
    expect(assessSingleProductInvoicePrice(draft, [product])).toMatchObject({
      productName: "High Speed Diesel",
      unit: "L",
      previousPrice: 99.5,
      invoicePrice: 100.59,
      difference: 1.09,
      direction: "INCREASE",
    });
  });

  it("excludes deposits and unrelated adjustments from the landed price", () => {
    expect(assessSingleProductInvoicePrice({ ...draft, purchasePriceExcludedAmount: "12079" }, [product])).toMatchObject({
      invoicePrice: 99.58,
      direction: "INCREASE",
    });
  });

  it("withholds a blended price when more than one product is supplied", () => {
    const secondLine: EditableInvoiceDraft["lines"][number] = {
      id: "line-2", product: "MS", description: "Motor Spirit", hsnCode: "27101241",
      quantity: "10", unit: "KL", unitRate: "85000", taxRate: "0",
    };
    expect(assessSingleProductInvoicePrice({ ...draft, lines: [...draft.lines, secondLine] }, [product])).toBeNull();
  });
});
