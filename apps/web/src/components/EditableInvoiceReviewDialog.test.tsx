import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseIndianInvoice } from "../lib/indian-invoice-parser";
import { createEditableInvoiceDraft, EditableInvoiceReviewDialog, validateEditableInvoiceDraft } from "./EditableInvoiceReviewDialog";

const invoiceText = `Kerala Fuel Supplies Pvt Ltd
Supplier GSTIN: 32ABCDE1234F1Z5
Tax Invoice No: KFS/2026/1842
Invoice Date: 12/09/2026
HSD 27101944 5000 L 87.50 437500.00
CGST 9% 39375.00
SGST 9% 39375.00
Grand Total 516250.00`;

afterEach(cleanup);

describe("editable invoice review", () => {
  it("creates an editable draft that follows purchase total rules", () => {
    const draft = createEditableInvoiceDraft(parseIndianInvoice(invoiceText));
    expect(draft).toMatchObject({ supplierName: "Kerala Fuel Supplies Pvt Ltd", invoiceNumber: "KFS/2026/1842", invoiceDate: "2026-09-12", dueDate: "2026-09-15", taxAmount: "78750", totalAmount: "516250" });
    expect(draft.lines[0]).toMatchObject({ product: "HSD", quantity: "5000", unit: "L", unitRate: "87.5", hsnCode: "27101944" });
    expect(validateEditableInvoiceDraft(draft)).toEqual([]);
  });

  it("blocks a locally reviewed draft when identity or totals are unsafe", () => {
    const draft = createEditableInvoiceDraft(parseIndianInvoice(invoiceText));
    draft.supplierGSTIN = "NOT-A-GSTIN";
    draft.dueDate = "2026-09-01";
    draft.totalAmount = "1";
    const errors = validateEditableInvoiceDraft(draft).join(" ");
    expect(errors).toContain("GST number");
    expect(errors).toContain("due date cannot be before");
    expect(errors).toContain("product amounts and tax");
  });

  it("keeps the reviewed total consistent after a one-digit OCR error in the printed product amount", () => {
    const parsed = parseIndianInvoice(`Indian Oil Corporation Limited
Tax Invoice No: 20274247B025710
Invoice Date: 31-Aug-26
HSD-BSVI 12.000 KL 27101944
BASIC DESTINATION PRICE 12.000 KL 79341.270 KL 952005.24
Total 1207079.00`);
    const draft = createEditableInvoiceDraft(parsed);

    expect(draft.taxAmount).toBe("254983.76");
    expect(validateEditableInvoiceDraft(draft)).not.toContainEqual(expect.stringContaining("product amounts and tax"));
  });

  it("automatically limits derived material rates and tax percentages to two decimals", () => {
    const draft = createEditableInvoiceDraft(parseIndianInvoice(`Indian Oil Corporation Limited
Tax Invoice No: 20274247B022177
Invoice Date: 13-Aug-26
EBMS 4.000 KL 27101242
BASIC DESTINATION PRICE 4.000 KL 82203.320 KL 328813.28
Total for material 440749.38
Grand Total 440749.38`));
    expect(draft.lines[0]).toMatchObject({ unitRate: "82203.32", taxRate: "34.04" });
  });

  it("lets the owner edit and keep a draft without offering a record update", () => {
    const onKeep = vi.fn();
    render(<EditableInvoiceReviewDialog fileName="invoice.pdf" initialDraft={createEditableInvoiceDraft(parseIndianInvoice(invoiceText))} onCancel={vi.fn()} onKeep={onKeep}/>);
    expect(screen.getByRole("dialog", { name: "Check every detail" })).toBeInTheDocument();
    expect(screen.getByText(/will not update purchases, stock, payments or accounts/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /post|update records|submit/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Supplier name"), { target: { value: "Kerala Fuel Supplies Limited" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep reviewed details" }));
    expect(onKeep).toHaveBeenCalledWith(expect.objectContaining({ supplierName: "Kerala Fuel Supplies Limited" }));
  });

  it("closes safely with Escape without keeping edits", () => {
    const onCancel = vi.fn();
    const onKeep = vi.fn();
    render(<EditableInvoiceReviewDialog fileName="invoice.pdf" initialDraft={createEditableInvoiceDraft(parseIndianInvoice(invoiceText))} onCancel={onCancel} onKeep={onKeep}/>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onKeep).not.toHaveBeenCalled();
  });
});
