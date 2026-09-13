import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditableInvoiceDraft } from "./EditableInvoiceReviewDialog";
import { InvoiceChangePreviewDialog } from "./InvoiceChangePreviewDialog";

const draft: EditableInvoiceDraft = {
  supplierName: "Indian Oil Corporation Limited",
  supplierGSTIN: "32AAACI1681G1ZZ",
  consigneeName: "FuelNerve Petroleum",
  consigneeCode: "187714",
  invoiceNumber: "IOCL-2026-91",
  invoiceDate: "2026-09-02",
  dueDate: "2026-09-05",
  taxAmount: "1800",
  totalAmount: "11800",
  lines: [{ id: "line-1", product: "HSD", description: "HSD", hsnCode: "27101944", quantity: "100", unit: "L", unitRate: "100", taxRate: "0" }],
};

afterEach(cleanup);

describe("demo-safe invoice preview", () => {
  it("shows exact human-readable effects without any action that changes records", () => {
    render(<InvoiceChangePreviewDialog fileName="invoice.pdf" draft={draft} stationName="FuelNerve Petroleum" isDemo onBack={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByRole("dialog", { name: "See what this invoice would add" })).toBeInTheDocument();
    expect(screen.getByText("Demo preview")).toBeInTheDocument();
    expect(screen.getByText("Your demo records will not change")).toBeInTheDocument();
    expect(screen.getByText(/local preview for FuelNerve Petroleum/i)).toBeInTheDocument();
    expect(screen.getByText(/Invoice IOCL-2026-91, dated 2 September 2026 and due 5 September 2026/i)).toBeInTheDocument();
    expect(screen.getByText("Amount owed to the supplier")).toBeInTheDocument();
    expect(screen.getByText(/Stock will not be received, no payment will be recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm|submit|save|create|update/i })).not.toBeInTheDocument();
  });

  it("returns to editing or closes without saving", () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    render(<InvoiceChangePreviewDialog fileName="invoice.pdf" draft={draft} stationName="FuelNerve Petroleum" isDemo onBack={onBack} onClose={onClose}/>);
    fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(onBack).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires a separate confirmation step for a real account", () => {
    const onContinue = vi.fn();
    render(<InvoiceChangePreviewDialog fileName="invoice.pdf" draft={draft} stationName="FuelNerve Petroleum" isDemo={false} onBack={vi.fn()} onClose={vi.fn()} onContinue={onContinue}/>);
    fireEvent.click(screen.getByRole("button", { name: "Continue to confirmation" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
