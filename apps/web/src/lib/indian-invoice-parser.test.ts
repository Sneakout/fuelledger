import { describe, expect, it } from "vitest";
import { parseIndianInvoice } from "./indian-invoice-parser";

describe("parseIndianInvoice", () => {
  it("reconciles two IOCL fuels using each material total and a separately OCR'd invoice total", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B022177
Date 13-Aug-26
PAYER - 187714 SALEEMA PETROLEUM
10 16730 EBMS 4.000 KL 2710 12 42
BASIC DESTINATION PRICE 4.000 KL 82203.320 KL 328813.28
ZLST Local sales tax 98907.03
ZAST Additional Tax 4000.00
ZSOC Social Sec Cess 1029.07
ZCS2 Cess 8000.00
Total for material
440749.38
20 50700 HSD-BSVI 8.000 KL 2710 19 44
BASIC DESTINATION PRICE 8.000 KL 79341.270 KL 634730.16
ZLST Local sales tax 144464.58
ZAST Additional Tax 8000.00
ZSOC Social Sec Cess 1524.65
ZCS2 Cess 16000.00
Total for material
804719.39
ZRND Rounding Difference 0.23
Total
1245469.00`);

    expect(result.lines).toMatchObject([
      { product: "MS", description: "EBMS", quantity: 4, amount: 328813.28, grossAmount: 440749.38 },
      { product: "HSD", quantity: 8, amount: 634730.16, grossAmount: 804719.39 },
    ]);
    expect(result.totalAmount?.value).toBe(1245469);
    expect(result.tax.total).toBe(281925.56);
  });
  it("recovers the actual scanned two-product layout when OCR reads KL as ML and drops decimal points", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
DocName TAX INVOICE 20274247B022177
Date 13-Aug-26
10 16730 EBMS 4.000 KL 27101242
BASIC DESTINATION PRICE . 4000 ML 82203320 KL 32881328)
Tank no: SUP1 Comp No(s) 1, Density@ 15: 750 600 Total for material 440749.38
20 50700 HSD-BSVI 8000 KL 271019 44
BASIC DESTINATION PRICE 8000 KL 79341270 KL 634730.16
Tank no: T005 Comp No(s) 2,3, Density @ 15: 835.500 Total for material 804719.39
ZRND Rounding Difference 023
fins Total 1245469.00`);
    expect(result.lines.map(line => [line.product, line.quantity, line.amount, line.grossAmount])).toEqual([
      ["MS", 4, 328813.28, 440749.38],
      ["HSD", 8, 634730.16, 804719.39],
    ]);
    expect(result.totalAmount?.value).toBe(1245469);
    expect(result.tax.total).toBe(281925.56);
  });
  it("reconstructs a missing IOCL grand-total row only from complete material totals and matching rounding", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B022177
Date 13-Aug-26
10 16730 EBMS 4.000 KL 27101242
BASIC DESTINATION PRICE 4000 ML 82203320 KL 32881328
Total for material 440749.38
20 50700 HSD-BSVI 8000 KL 271019 44
BASIC DESTINATION PRICE 8000 KL 79341270 KL 634730.16
Total for material 804719.39
ZRND Rounding Difference 023`);
    expect(result.totalAmount?.value).toBe(1245469);
    expect(result.totalAmount?.needsReview).toBe(true);
    expect(result.tax.total).toBe(281925.56);
    expect(result.missingFields).not.toContain("invoice total");
    expect(result.warnings).toContain("The invoice total was reconstructed from all product totals and the rounding line. Check it against the document before continuing.");
  });
  it("does not invent a missing total when the rounding line disagrees", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B022177
Date 13-Aug-26
10 16730 EBMS 4.000 KL 82203.320 KL 328813.28
Total for material 440749.38
20 50700 HSD-BSVI 8.000 KL 79341.270 KL 634730.16
Total for material 804719.39
ZRND Rounding Difference 0.15`);
    expect(result.totalAmount).toBeNull();
    expect(result.missingFields).toContain("invoice total");
  });
  it("reuses the proven iOS fuel-invoice fields without creating a record", () => {
    const result = parseIndianInvoice(`Kerala Fuel Supplies Pvt Ltd
GSTIN: 32ABCDE1234F1Z5
Tax Invoice No: KFS/2026/1842
Invoice Date: 12/09/2026
HSD 27101944 5000.000 L 87.50 437500.00
CGST 9% 39375.00
SGST 9% 39375.00
Grand Total 516250.00`);

    expect(result.supplierName?.value).toBe("Kerala Fuel Supplies Pvt Ltd");
    expect(result.supplierGSTIN?.value).toBe("32ABCDE1234F1Z5");
    expect(result.invoiceNumber?.value).toBe("KFS/2026/1842");
    expect(result.invoiceDate?.value).toBe("2026-09-12");
    expect(result.totalAmount?.value).toBe(516250);
    expect(result.tax.total).toBe(78750);
    expect(result.lines[0]).toMatchObject({ product: "HSD", hsnCode: "27101944", quantity: 5000, unit: "L", unitRate: 87.5, amount: 437500 });
    expect(result.status).toBe("READY_FOR_REVIEW");
  });

  it("reads an IndianOil-style number and named date without selecting the SAP entry number", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B025710
SAP Entry no. 7010369929 Date 31-Aug-26
Supplier GSTIN: 32AAACI1681G1ZZ
HSD-BS VI 27101944 12.000 KL 79341.270 952095.24
Total for material 1207079.09
Total 1207079.00`);

    expect(result.invoiceNumber?.value).toBe("20274247B025710");
    expect(result.invoiceNumber?.needsReview).toBe(true);
    expect(result.invoiceDate?.value).toBe("2026-08-31");
    expect(result.invoiceNumber?.value).not.toBe("7010369929");
    expect(result.lines[0]).toMatchObject({ product: "HSD", quantity: 12, unit: "KL", unitRate: 79341.27, amount: 952095.24 });
    expect(result.totalAmount?.value).toBe(1207079);
  });

  it("keeps the consignee separate from the supplier", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B025710
Date 31-Aug-26
Supplier CONSIGNEE
PAYER - 187714 SALEEMA PETROLEUM
HSD 12.000 KL 27101944 79341.270 952095.24
Total 1207079.00`);

    expect(result.supplierName?.value).toBe("Indian Oil Corporation Limited");
    expect(result.consigneeName?.value).toBe("SALEEMA PETROLEUM");
    expect(result.consigneeCode?.value).toBe("187714");
  });

  it("stops the consignee name before a product table merged onto the same OCR line", () => {
    const result = parseIndianInvoice("Supplier CONSIGNEE Indian Oil Corporation Limited 187714 SALEEMA PETROLEUM INDIAN OIL DEALER PAYER - 187714 SALEEMA PETROLEUM item Material Code / Material Description Quantity Unit Rate Unit HSN code Total 10 50700 HSD-BSVI 12.000 KL 79341.270 KL 952095.24");
    expect(result.consigneeName?.value).toBe("SALEEMA PETROLEUM");
    expect(result.consigneeCode?.value).toBe("187714");
  });

  it("reconstructs an IOCL product whose measurements are on the following OCR line", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B025710
SAP Entry no. 7010369929 Date 31-Aug-26
10 50700 HSD-BSVI 12.000 KL 2710 19 44
BASIC DESTINATION PRICE 12.000 KL 79341270 KL 95209524
§ & Total : ₹ 1207079.00`);

    expect(result.lines[0]).toMatchObject({
      description: "HSD-BSVI",
      product: "HSD",
      hsnCode: "27101944",
      quantity: 12,
      unit: "KL",
      unitRate: 79341.27,
      amount: 952095.24,
    });
    expect(result.totalAmount?.value).toBe(1207079);
    expect(result.warnings).toContain("Check the invoice number against the document before continuing.");
  });

  it("does not duplicate a product recovered by a targeted OCR pass", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B025710
Date 31-Aug-26
10 50700 HSD-BSVI 12000 KL 2710 19 44
BASIC DESTINATION PRICE 12000 KL 79341270 KL 95209524

10 50700 HSD-BSVI 12000 KL 2710 19 44
BASIC DESTINATION PRICE 12000 KL 79341270 KL 95209524
Total : 1207079.00`);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.amount).toBe(952095.24);
  });

  it("recovers the final total when OCR damages only its label", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B025710
Date 31-Aug-26
HSD-BSVI 12.000 KL 27101944
BASIC DESTINATION PRICE 12.000 KL 79341.270 KL 952095.24
Total for material 1207079.09
ZRND Rounding Difference 0.09
E Te a aeotall 1207079.00`);

    expect(result.totalAmount?.value).toBe(1207079);
    expect(result.totalAmount?.needsReview).toBe(true);
    expect(result.tax.total).toBe(254983.76);
  });

  it("does not create a false tax mismatch when OCR changes one product-amount digit", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
TAX INVOICE 20274247B025710
Date 31-Aug-26
HSD-BSVI 12.000 KL 27101944
BASIC DESTINATION PRICE 12.000 KL 79341.270 KL 952005.24
Total 1207079.00`);

    expect(result.lines[0]).toMatchObject({ quantity: 12, unitRate: 79341.27, amount: 952005.24 });
    expect(result.tax.total).toBe(254983.76);
    expect(result.warnings).toContain("The quantity and rate do not match the amount shown for HSD-BSVI.");
  });

  it("keeps the printed product amount when the OCR rate is materially different", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
Tax Invoice No: 20274247B025710
Date 31-Aug-26
HSD-BSVI 12.000 KL 80000.00 KL 952095.24
Total 1207079.00`);

    expect(result.tax.total).toBe(254983.76);
  });

  it("recovers decimal points lost by OCR when the quantity-rate arithmetic supports them", () => {
    const result = parseIndianInvoice(`Indian Oil Corporation Limited
Doc.Name TAX INVOICE 20274247B025710
31-Aug-26
10 50700 HSD-BSVI 12000 KL 271019 44
BASIC DESTINATION PRICE 12000 KL 79341270 KL 95209524
2ZLST Local sales tax 22.760 % 21669688
2CS2 Cess 2000.000 KL 24000.00
§ & Total : ₹ 1207079.00`);

    expect(result.invoiceDate?.value).toBe("2026-08-31");
    expect(result.invoiceDate?.needsReview).toBe(true);
    expect(result.totalAmount?.value).toBe(1207079);
    expect(result.lines[0]).toMatchObject({ product: "HSD", hsnCode: "27101944", quantity: 12, unitRate: 79341.27, amount: 952095.24 });
    expect(result.tax.total).toBe(254983.76);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "The invoice date was recovered without a clear label. Check it against the document before continuing.",
      "Taxes and charges were recovered from the invoice total. Check their classification before continuing.",
    ]));
  });

  it.each([
    ["MS-BS VI", "MS"],
    ["XP95", "MS"],
    ["XP100", "MS"],
    ["XTRAPREMIUM", "MS"],
    ["Speed 97", "MS"],
    ["Power95", "MS"],
    ["XtraGreen", "HSD"],
    ["XtraMile", "HSD"],
    ["V-Power Diesel", "HSD"],
    ["Ethanol100", "ETHANOL"],
    ["AutoGas", "AUTO_LPG"],
    ["Jet A-1", "AVIATION_FUEL"],
  ])("keeps branded fuel %s and maps it to %s", (description, product) => {
    const result = parseIndianInvoice(`Fuel supplier
Invoice No: BRAND-1
Invoice Date: 13/09/2026
${description} 27101241 2.000 KL 100000.00 200000.00
Grand Total 200000.00`);

    expect(result.lines[0]).toMatchObject({ description, product, quantity: 2, unit: "KL", amount: 200000 });
  });

  it("retains an unknown branded petroleum line without guessing its family", () => {
    const result = parseIndianInvoice(`Fuel supplier
Invoice No: BRAND-2
Invoice Date: 13/09/2026
EcoBoost Max 27101241 2.000 KL 100000.00 200000.00
Grand Total 200000.00`);

    expect(result.lines[0]).toMatchObject({ description: "EcoBoost Max", product: "OTHER", quantity: 2, amount: 200000 });
  });

  it("withholds an impossible OCR date instead of silently correcting it", () => {
    const result = parseIndianInvoice("Indian Oil Corporation Limited\nInvoice No: IOCL-44\nDate 51-Aug-26\nGrand Total 1200.00");
    expect(result.invoiceDate).toBeNull();
    expect(result.warnings.join(" ")).toContain("not a valid calendar date");
    expect(result.status).toBe("NEEDS_REVIEW");
  });

  it("does not invent a product line or supplier when required fields are absent", () => {
    const result = parseIndianInvoice("Tax Invoice\nGrand Total 437500.00");
    expect(result.supplierName).toBeNull();
    expect(result.invoiceNumber).toBeNull();
    expect(result.lines).toEqual([]);
    expect(result.missingFields).toEqual(expect.arrayContaining(["supplier name", "invoice number", "invoice date", "product lines"]));
    expect(result.status).toBe("NEEDS_REVIEW");
  });

  it("keeps supplier and buyer GST numbers separate when their labels are present", () => {
    const result = parseIndianInvoice(`Supplier: Bharat Fuels Pvt Ltd
Supplier GSTIN: 32ABCDE1234F1Z5
Buyer GSTIN: 32PQRSX6789A1Z2
Invoice No: B-101
Invoice Date: 13-09-2026
HSD 27101944 1000 L 90.00 90000.00
IGST 5% 4500.00
Grand Total 94500.00`);
    expect(result.supplierGSTIN?.value).toBe("32ABCDE1234F1Z5");
    expect(result.buyerGSTIN?.value).toBe("32PQRSX6789A1Z2");
    expect(result.tax.total).toBe(4500);
  });

  it("does not mistake a later tax total for the invoice total", () => {
    const result = parseIndianInvoice(`Bharat Fuels Pvt Ltd
Invoice No: B-102
Invoice Date: 13/09/2026
HSD 27101944 1000 L 90.00 90000.00
Grand Total 94500.00
Total Tax 4500.00`);
    expect(result.totalAmount?.value).toBe(94500);
    expect(result.tax.total).toBe(4500);
  });
});
