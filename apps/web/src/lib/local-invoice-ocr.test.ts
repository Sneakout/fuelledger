import { describe, expect, it } from "vitest";
import { needsInvoiceHeaderPass, needsInvoiceTotalPass } from "./local-invoice-ocr";

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
});
