import { describe, expect, it } from "vitest";
import type { EditableInvoiceDraft } from "../components/EditableInvoiceReviewDialog";
import type { PurchaseProduct, Supplier } from "./api";
import { buildConfirmedPurchaseInput, findDuplicateInvoice, findDuplicateInvoiceForDraft, findMatchingProduct, findMatchingSupplier, onlyCompatibleTankId, validateConfirmedPurchase, validateReceiptSelections } from "./confirmed-purchase-submission";

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
const stations = [{ id: "station-1", name: "FuelNerve Petroleum", code: "FNP", configurations: [{ tanks: [{ id: "tank-1", code: "HSD-1", productId: "product-1" }] }] }];

describe("confirmed purchase submission", () => {
  it("matches an existing supplier and product using exact verified identifiers", () => {
    expect(findMatchingSupplier(draft, suppliers)).toBe("supplier-1");
    expect(findMatchingProduct("HSD", "HSD", "27101944", products)).toBe("product-1");
    expect(findMatchingSupplier({ ...draft, supplierGSTIN: "", supplierName: "Unknown Oil" }, suppliers)).toBe("");
  });

  it("creates an unpaid invoice and stock receipt without sending the document", () => {
    const input = buildConfirmedPurchaseInput(draft, "station-1", "supplier-1", ["product-1"], { tankIds: ["tank-1"] });
    expect(input).toMatchObject({
      stationId: "station-1",
      supplierId: "supplier-1",
      invoiceNumber: "IOCL-91",
      dueDate: "2026-09-05T00:00:00.000Z",
      invoiceTotal: 11800,
      receiveNow: true,
      paidNow: false,
      attachment: null,
    });
    expect(input.lines[0]).toMatchObject({ productId: "product-1", tankId: "tank-1", description: "HSD", quantity: 100, unitCost: 100 });
  });

  it("defaults a missing due date to T+3 while still requiring an existing supplier", () => {
    expect(validateConfirmedPurchase({ ...draft, dueDate: "" }, "station-1", "").join(" ")).toContain("existing supplier");
    expect(validateConfirmedPurchase({ ...draft, dueDate: "" }, "station-1", "supplier-1")).toEqual([]);
    expect(buildConfirmedPurchaseInput({ ...draft, dueDate: "" }, "station-1", "supplier-1", ["product-1"], { tankIds: ["tank-1"] }).dueDate).toBe("2026-09-05T00:00:00.000Z");
  });

  it("detects a supplier-scoped duplicate despite harmless number formatting", () => {
    const duplicate = findDuplicateInvoice("supplier-1", " iocl / 91 ", [{ supplier: { id: "supplier-1" }, invoiceNumber: "IOCL/91" } as never]);
    expect(duplicate).toBeDefined();
    expect(findDuplicateInvoice("supplier-2", "IOCL/91", [{ supplier: { id: "supplier-1" }, invoiceNumber: "IOCL/91" } as never])).toBeUndefined();
  });

  it("detects an OCR duplicate from verified supplier identity and invoice number", () => {
    const invoice = { id: "invoice-1", supplier: { id: "supplier-1" }, invoiceNumber: "IOCL/91" } as never;
    expect(findDuplicateInvoiceForDraft({ ...draft, invoiceNumber: " iocl / 91 " }, suppliers, [invoice])).toBe(invoice);
    expect(findDuplicateInvoiceForDraft({ ...draft, supplierGSTIN: "", supplierName: "Different Supplier", invoiceNumber: "IOCL/91" }, suppliers, [invoice])).toBeUndefined();
  });

  it("never includes document bytes, receipt or payment instructions", () => {
    const input = buildConfirmedPurchaseInput(draft, "station-1", "supplier-1", [null], { receiveNow: false });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("contentBase64");
    expect(input).toMatchObject({ attachment: null, receiveNow: false, paidNow: false });
    expect(input.lines[0]?.tankId).toBeNull();
  });

  it("auto-selects a sole tank and requires a choice when several tanks match", () => {
    expect(onlyCompatibleTankId(stations, "station-1", "product-1")).toBe("tank-1");
    expect(validateReceiptSelections(true, "station-1", ["product-1"], ["tank-1"], products, stations)).toEqual([]);
    const twoTanks = [{ ...stations[0]!, configurations: [{ tanks: [...stations[0]!.configurations[0]!.tanks, { id: "tank-2", code: "HSD-2", productId: "product-1" }] }] }];
    expect(onlyCompatibleTankId(twoTanks, "station-1", "product-1")).toBeNull();
    expect(validateReceiptSelections(true, "station-1", ["product-1"], [null], products, twoTanks)).toEqual(["Choose the receiving tank for High Speed Diesel."]);
  });

  it("rejects a station that is not in the confirmed station scope", () => {
    expect(validateConfirmedPurchase(draft, "", "supplier-1").join(" ")).toContain("selected fuel station");
  });
});
