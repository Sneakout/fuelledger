import { describe, expect, it } from "vitest";
import { needsFullPagePass, needsInvoiceHeaderPass, needsInvoiceTotalPass } from "./local-invoice-ocr";

describe("local invoice OCR targeted passes", () => {
  it("checks the header only when the whole-page text has no readable date", () => {
    expect(needsInvoiceHeaderPass("SAP Entry no. 7010369929 Date 31-Aug-26")).toBe(false);
    expect(needsInvoiceHeaderPass("SAP Entry no. 7010369929 rer X45 ee by pe")).toBe(true);
    expect(needsInvoiceHeaderPass("C.E.Regn 4/KKD-11/0/97 Rem.Date/Time")).toBe(true);
    expect(needsInvoiceHeaderPass("Date 31-Aug 2 ret ED; 5")).toBe(true);
  });

  it("does not mistake total for material for the final invoice total", () => {
    expect(needsInvoiceTotalPass("Total for material 1207079.09")).toBe(true);
    expect(needsInvoiceTotalPass("Total for material 1207079.09\nTotal : 1207079.00")).toBe(false);
  });

  it("skips the slower full-page pass when targeted regions contain enough invoice evidence", () => {
    const completeTargetedText = `
      TAX INVOICE 20274247B025710
      Indian Oil Corporation Limited
      HSD-BSVI 12.000 KL 79341.270 952095.24
      Total 1207079.00
      Supplier: Kozhikode Depot, Indian Oil Corporation Limited.
      Consignee: Saleema Petroleum, Indian Oil dealer, Tirur-Malappuram Road, Tirur, Kerala 676101.
      Payer: Saleema Petroleum. HSN 27101944. Basic destination price and applicable taxes are shown above.
    `;
    expect(needsFullPagePass(completeTargetedText)).toBe(false);
  });

  it("uses the full-page fallback for sparse or incomplete targeted text", () => {
    expect(needsFullPagePass("TAX INVOICE 20274247B025710")).toBe(true);
    expect(needsFullPagePass("TAX INVOICE 20274247B025710\nTotal 1207079.00")).toBe(true);
  });
});
