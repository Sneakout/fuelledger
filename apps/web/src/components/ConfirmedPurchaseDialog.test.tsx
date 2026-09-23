import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditableInvoiceDraft } from "./EditableInvoiceReviewDialog";

const mocks = vi.hoisted(() => ({ purchasesBootstrap: vi.fn(), invoiceImportPolicy: vi.fn(), createImportedPurchaseInvoice: vi.fn(), receiveImportedPurchaseInvoice: vi.fn(), recordInvoiceImportMetric: vi.fn() }));
vi.mock("../lib/api", async importOriginal => {
  const original = await importOriginal<typeof import("../lib/api")>();
  return { ...original, api: { ...original.api, purchasesBootstrap: mocks.purchasesBootstrap, invoiceImportPolicy: mocks.invoiceImportPolicy, createImportedPurchaseInvoice: mocks.createImportedPurchaseInvoice, receiveImportedPurchaseInvoice: mocks.receiveImportedPurchaseInvoice, recordInvoiceImportMetric: mocks.recordInvoiceImportMetric } };
});

import { ConfirmedPurchaseDialog } from "./ConfirmedPurchaseDialog";

const draft: EditableInvoiceDraft = {
  supplierName: "Indian Oil Corporation Limited", supplierGSTIN: "32AAACI1681G1ZZ", invoiceNumber: "IOCL-91", invoiceDate: "2026-09-02", dueDate: "2026-09-05", taxAmount: "1800", totalAmount: "11800",
  consigneeName: "FuelNerve Petroleum", consigneeCode: "187714",
  lines: [{ id: "line-1", product: "HSD", description: "HSD", hsnCode: "27101944", quantity: "100", unit: "L", unitRate: "100", taxRate: "0" }],
};

const bootstrap = {
  suppliers: [{ id: "supplier-1", name: "Indian Oil Corporation Limited", code: "IOCL", phone: null, email: null, taxId: "32AAACI1681G1ZZ", address: null, paymentTerms: 3, active: true }],
  products: [{ id: "product-1", name: "High Speed Diesel", code: "HSD", category: "FUEL", unit: "L", hsnCode: "27101944", purchasePrice: "100", purchasePriceHistory: [], tankLinked: true, taxCategory: null }],
  stations: [{ id: "station-1", name: "FuelNerve Petroleum", code: "FNP", configurations: [{ tanks: [{ id: "tank-1", code: "HSD-1", productId: "product-1" }] }] }],
  invoices: [], categories: [], expenses: [], summary: { payables: 0, overdue: 0, expensesThisMonth: 0 },
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("confirmed purchase dialog", () => {
  it("submits the reviewed structure only after exact owner confirmation", async () => {
    mocks.invoiceImportPolicy.mockResolvedValue({ enabled: true, monitored: true });
    mocks.purchasesBootstrap.mockResolvedValue(bootstrap);
    mocks.createImportedPurchaseInvoice.mockResolvedValue({ invoice: { id: "invoice-1", invoiceNumber: "IOCL-91", totalAmount: "11800", supplier: { name: "Indian Oil Corporation Limited" } } });
    mocks.recordInvoiceImportMetric.mockResolvedValue(undefined);
    const onSubmitted = vi.fn();
    render(<ConfirmedPurchaseDialog draft={draft} stationId="station-1" stationName="FuelNerve Petroleum" isDemo={false} onBack={vi.fn()} onClose={vi.fn()} onSubmitted={onSubmitted}/>);
    const create = await screen.findByRole("button", { name: /Create invoice & receive stock/ });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked the supplier/ }));
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(mocks.createImportedPurchaseInvoice).toHaveBeenCalledOnce());
    expect(mocks.createImportedPurchaseInvoice).toHaveBeenCalledWith(expect.objectContaining({ receiveNow: true, paidNow: false, attachment: null, lines: [expect.objectContaining({ productId: "product-1", tankId: "tank-1" })] }));
    expect(await screen.findByText("Invoice created")).toBeInTheDocument();
    expect(screen.getByText(/added to the selected tanks and inventory/i)).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalledOnce();
  });

  it("never offers submission in a demo", async () => {
    render(<ConfirmedPurchaseDialog draft={draft} stationId="station-1" stationName="FuelNerve Petroleum" isDemo onBack={vi.fn()} onClose={vi.fn()} onSubmitted={vi.fn()}/>);
    expect(await screen.findByText("Demo stays read-only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create invoice & receive stock/ })).toBeDisabled();
    expect(mocks.purchasesBootstrap).not.toHaveBeenCalled();
    expect(mocks.createImportedPurchaseInvoice).not.toHaveBeenCalled();
  });

  it("withholds confirmation outside the limited rollout", async () => {
    mocks.invoiceImportPolicy.mockResolvedValue({ enabled: false, monitored: false });
    render(<ConfirmedPurchaseDialog draft={draft} stationId="station-1" stationName="FuelNerve Petroleum" isDemo={false} onBack={vi.fn()} onClose={vi.fn()} onSubmitted={vi.fn()}/>);
    expect(await screen.findByText(/being released gradually/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create invoice & receive stock/ })).toBeDisabled();
    expect(mocks.purchasesBootstrap).not.toHaveBeenCalled();
  });

  it("stops an existing supplier invoice before submission", async () => {
    mocks.invoiceImportPolicy.mockResolvedValue({ enabled: true, monitored: false });
    mocks.purchasesBootstrap.mockResolvedValue({ ...bootstrap, invoices: [{ supplier: { id: "supplier-1", name: "Indian Oil Corporation Limited" }, invoiceNumber: "iocl-91", receipt: { id: "receipt-1" } }] });
    render(<ConfirmedPurchaseDialog draft={draft} stationId="station-1" stationName="FuelNerve Petroleum" isDemo={false} onBack={vi.fn()} onClose={vi.fn()} onSubmitted={vi.fn()}/>);
    expect(await screen.findByText("This invoice already exists")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /I checked the supplier/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create invoice & receive stock/ })).toBeDisabled();
    expect(mocks.createImportedPurchaseInvoice).not.toHaveBeenCalled();
  });

  it("repairs a matching invoice that was saved without its stock receipt", async () => {
    mocks.invoiceImportPolicy.mockResolvedValue({ enabled: true, monitored: false });
    const existing = { id: "invoice-1", supplier: { id: "supplier-1", name: "Indian Oil Corporation Limited" }, invoiceNumber: "iocl-91", receipt: null, lines: [{ id: "invoice-line-1" }] };
    mocks.purchasesBootstrap.mockResolvedValue({ ...bootstrap, invoices: [existing] });
    mocks.receiveImportedPurchaseInvoice.mockResolvedValue({ invoice: { ...existing, totalAmount: "11800", supplier: { ...existing.supplier, code: "IOCL", paymentTerms: 3 } }, priceApprovals: [{ id: "approval-1", evidence: { product: { id: "product-1", name: "High Speed Diesel", code: "HSD", unit: "LITRE" } } }] });
    render(<ConfirmedPurchaseDialog draft={draft} stationId="station-1" stationName="FuelNerve Petroleum" isDemo={false} onBack={vi.fn()} onClose={vi.fn()} onSubmitted={vi.fn()}/>);
    const repair = await screen.findByRole("button", { name: /Receive stock for existing invoice/ });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked the supplier/ }));
    fireEvent.click(repair);
    await waitFor(() => expect(mocks.receiveImportedPurchaseInvoice).toHaveBeenCalledWith("invoice-1", { allocations: [{ invoiceLineId: "invoice-line-1", productId: "product-1", tankId: "tank-1" }] }));
    expect(mocks.createImportedPurchaseInvoice).not.toHaveBeenCalled();
    expect(await screen.findByText("Stock receipt created")).toBeInTheDocument();
    expect(screen.getByText("HSD purchase price changed")).toBeInTheDocument();
  });

  it("stops a different consignee before any invoice data reaches the backend", async () => {
    render(<ConfirmedPurchaseDialog draft={{ ...draft, consigneeName: "Saleema Petroleum" }} stationId="station-1" stationName="FuelNerve Petroleum" isDemo={false} onBack={vi.fn()} onClose={vi.fn()} onSubmitted={vi.fn()}/>);
    expect((await screen.findAllByText(/invoice is for Saleema Petroleum, not FuelNerve Petroleum/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Create invoice & receive stock/ })).toBeDisabled();
    expect(mocks.invoiceImportPolicy).not.toHaveBeenCalled();
    expect(mocks.purchasesBootstrap).not.toHaveBeenCalled();
    expect(mocks.createImportedPurchaseInvoice).not.toHaveBeenCalled();
  });

  it("requires an explicit receiving tank when a fuel has multiple tanks", async () => {
    mocks.invoiceImportPolicy.mockResolvedValue({ enabled: true, monitored: false });
    mocks.purchasesBootstrap.mockResolvedValue({ ...bootstrap, stations: [{ ...bootstrap.stations[0], configurations: [{ tanks: [{ id: "tank-1", code: "HSD-1", productId: "product-1" }, { id: "tank-2", code: "HSD-2", productId: "product-1" }] }] }] });
    render(<ConfirmedPurchaseDialog draft={draft} stationId="station-1" stationName="FuelNerve Petroleum" isDemo={false} onBack={vi.fn()} onClose={vi.fn()} onSubmitted={vi.fn()}/>);
    expect(await screen.findByText("Choose the receiving tank for High Speed Diesel.")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /Create invoice & receive stock/ });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Receiving tank for HSD" }), { target: { value: "tank-2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked the supplier/ }));
    expect(create).toBeEnabled();
  });
});
