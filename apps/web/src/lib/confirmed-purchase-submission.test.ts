import { describe, expect, it } from "vitest";
import type { EditableInvoiceDraft } from "../components/EditableInvoiceReviewDialog";
import type { PurchaseProduct, Supplier } from "./api";
import { buildConfirmedPurchaseInput, findDuplicateInvoice, findMatchingProduct, findMatchingSupplier, validateConfirmedPurchase } from "./confirmed-purchase-submission";

const draft: EditableInvoiceDraft = {
  supplierName: "Indian Oil Corporation Limited",
  supplierGSTIN: "32AAACI1681G1ZZ",
  invoiceNumber: "IOCL-91",
  invoiceDate: "2026-09-02",
  dueDate: "2026-09-05",
  taxAmount: "1800",
  totalAmount: "11800",
  lines: [{ id: "line-1", product: "HSD", description: "HSD", hsnCode: "27101944", quantity: "100", unit: "L", unitRate: "100", taxRate: "0" }],
};

const suppliers = [{ id: "supplier-1", name: "Indian Oil Corporation Limited", code: "IOCL", phone: null, email: null, taxId: "32AAACI1681G1ZZ", address: null, paymentTerms: 3, active: true }] satisfies Supplier[];
const products = [{ id: "product-1", name: "High Speed Diesel", code: "HSD", category: "FUEL", unit: "L", hsnCode: "27101944", purchasePrice: "100", purchasePriceHistory: [], tankLinked: true, taxCategory: null }] satisfies PurchaseProduct[];

describe("confirmed purchase submission", () => {
  it("matches an existing supplier and product using exact verified identifiers", () => {
    expect(findMatchingSupplier(draft, suppliers)).toBe("supplier-1");
    expect(findMatchingProduct("HSD", "HSD", "27101944", products)).toBe("product-1");
    expect(findMatchingSupplier({ ...draft, supplierGSTIN: "", supplierName: "Unknown Oil" }, suppliers)).toBe("");
  });

  it("creates only an unpaid, unreceived invoice without sending the document", () => {
    const input = buildConfirmedPurchaseInput(draft, "station-1", "supplier-1", ["product-1"]);
    expect(input).toMatchObject({
      stationId: "station-1",
      supplierId: "supplier-1",
      invoiceNumber: "IOCL-91",
      dueDate: "2026-09-05T00:00:00.000Z",
      invoiceTotal: 11800,
      receiveNow: false,
      paidNow: false,
      attachment: null,
    });
    expect(input.lines[0]).toMatchObject({ productId: "product-1", tankId: null, description: "HSD", quantity: 100, unitCost: 100 });
  });

  it("defaults a missing due date to T+3 while still requiring an existing supplier", () => {
    expect(validateConfirmedPurchase({ ...draft, dueDate: "" }, "station-1", "").join(" ")).toContain("existing supplier");
    expect(validateConfirmedPurchase({ ...draft, dueDate: "" }, "station-1", "supplier-1")).toEqual([]);
    expect(buildConfirmedPurchaseInput({ ...draft, dueDate: "" }, "station-1", "supplier-1", ["product-1"]).dueDate).toBe("2026-09-05T00:00:00.000Z");
  });

  it("detects a supplier-scoped duplicate despite harmless number formatting", () => {
    const duplicate = findDuplicateInvoice("supplier-1", " iocl / 91 ", [{ supplier: { id: "supplier-1" }, invoiceNumber: "IOCL/91" } as never]);
    expect(duplicate).toBeDefined();
    expect(findDuplicateInvoice("supplier-2", "IOCL/91", [{ supplier: { id: "supplier-1" }, invoiceNumber: "IOCL/91" } as never])).toBeUndefined();
  });

  it("never includes document bytes, receipt or payment instructions", () => {
    const input = buildConfirmedPurchaseInput(draft, "station-1", "supplier-1", [null]);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("contentBase64");
    expect(input).toMatchObject({ attachment: null, receiveNow: false, paidNow: false });
    expect(input.lines[0]?.tankId).toBeNull();
  });

  it("rejects a station that is not in the confirmed station scope", () => {
    expect(validateConfirmedPurchase(draft, "", "supplier-1").join(" ")).toContain("selected fuel station");
  });
});
