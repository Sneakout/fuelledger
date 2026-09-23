import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AppError } from "../src/lib/errors.js";

const auth = vi.hoisted(() => ({ currentUser: vi.fn() }));
const purchases = vi.hoisted(() => ({ createInvoice: vi.fn(), receiveInvoiceStock: vi.fn(), bootstrap: vi.fn() }));
const approvals = vi.hoisted(() => ({ requestProductPriceChangeFromInvoice: vi.fn() }));
vi.mock("../src/modules/auth/service.js", () => ({ currentUser: auth.currentUser }));
vi.mock("../src/modules/purchases/service.js", () => purchases);
vi.mock("../src/modules/approvals/service.js", () => approvals);
vi.mock("../src/lib/prisma.js", () => ({ prisma: { $queryRaw: vi.fn() } }));

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.INVOICE_IMPORT_RELEASE_STAGE = "LOCAL";
process.env.INVOICE_IMPORT_ROLLOUT_PERCENT = "100";
process.env.INVOICE_IMPORT_MONITORING_PERCENT = "100";

const owner = { id: "owner-1", name: "Owner", email: "owner@example.com", role: "OWNER", organization: { id: "org-1", name: "FuelNerve Petroleum" }, allStations: false, stations: [{ id: "cm00000000000000000000001", name: "FuelNerve Petroleum", code: "FNP" }] };
const input = {
  stationId: "cm00000000000000000000001",
  supplierId: "cm00000000000000000000002",
  invoiceNumber: "IOCL-91",
  invoiceDate: "2026-09-02T00:00:00.000Z",
  dueDate: "2026-09-05T00:00:00.000Z",
  invoiceTotal: 11800,
  taxAmount: 1800,
  receiveNow: false,
  paidNow: false,
  attachment: null,
  lines: [{ productId: null, tankId: null, description: "HSD", quantity: 100, unitCost: 100, taxRate: 0, hsnCode: "27101944" }],
};

describe("Nerve invoice import route", async () => {
  const { createApp } = await import("../src/app.js");
  beforeEach(() => {
    vi.clearAllMocks();
    auth.currentUser.mockResolvedValue(owner);
    const savedInvoice = { id: "invoice-1", stationId: input.stationId, invoiceNumber: "IOCL-91", invoiceDate: new Date(input.invoiceDate), dueDate: new Date(input.dueDate), subtotal: 10000, taxAmount: 1800, totalAmount: 11800, supplier: { id: input.supplierId }, lines: [{ id: "cm00000000000000000000006", productId: "cm00000000000000000000003", description: "HSD", quantity: 100, unitCost: 100, taxRate: 0, hsnCode: "27101944" }] };
    purchases.createInvoice.mockResolvedValue(savedInvoice);
    purchases.receiveInvoiceStock.mockResolvedValue({ ...savedInvoice, receipt: { id: "receipt-1" } });
    approvals.requestProductPriceChangeFromInvoice.mockResolvedValue([{ id: "price-approval-1" }]);
  });

  it("uses the existing purchase service for a tightly scoped unpaid invoice", async () => {
    const response = await request(createApp()).post("/api/purchases/invoice-import").set("Cookie", "fuelledger_session=valid").set("Idempotency-Key", "invoice-import-test-0001").send(input);
    expect(response.status).toBe(201);
    expect(purchases.createInvoice).toHaveBeenCalledWith("org-1", "owner-1", expect.objectContaining({ receiveNow: false, paidNow: false, attachment: null }));
    expect(approvals.requestProductPriceChangeFromInvoice).toHaveBeenCalledOnce();
  });

  it("rejects payment or document-storage expansion", async () => {
    const response = await request(createApp()).post("/api/purchases/invoice-import").set("Cookie", "fuelledger_session=valid").set("Idempotency-Key", "invoice-import-test-0002").send({ ...input, paidNow: true, paymentMethod: "UPI" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVOICE_IMPORT_SCOPE_INVALID");
    expect(purchases.createInvoice).not.toHaveBeenCalled();
  });

  it("allows a confirmed stock receipt with product and tank allocations", async () => {
    const response = await request(createApp()).post("/api/purchases/invoice-import").set("Cookie", "fuelledger_session=valid").set("Idempotency-Key", "invoice-import-test-stock").send({
      ...input,
      receiveNow: true,
      lines: [{ ...input.lines[0], productId: "cm00000000000000000000003", tankId: "cm00000000000000000000004" }],
    });
    expect(response.status).toBe(201);
    expect(purchases.createInvoice).toHaveBeenCalledWith("org-1", "owner-1", expect.objectContaining({ receiveNow: true, lines: [expect.objectContaining({ productId: "cm00000000000000000000003", tankId: "cm00000000000000000000004" })] }));
  });

  it("repairs the missing receipt of an existing imported invoice without recreating it", async () => {
    const response = await request(createApp()).post("/api/purchases/invoices/cm00000000000000000000005/receive").set("Cookie", "fuelledger_session=valid").set("Idempotency-Key", "invoice-import-receipt-repair").send({
      allocations: [{ invoiceLineId: "cm00000000000000000000006", productId: "cm00000000000000000000003", tankId: "cm00000000000000000000004" }],
    });
    expect(response.status).toBe(201);
    expect(purchases.receiveInvoiceStock).toHaveBeenCalledWith("org-1", "owner-1", "cm00000000000000000000005", { allocations: [{ invoiceLineId: "cm00000000000000000000006", productId: "cm00000000000000000000003", tankId: "cm00000000000000000000004" }] }, ["cm00000000000000000000001"]);
    expect(purchases.createInvoice).not.toHaveBeenCalled();
    expect(approvals.requestProductPriceChangeFromInvoice).toHaveBeenCalledWith("org-1", "owner-1", expect.objectContaining({ id: "invoice-1" }), expect.objectContaining({ invoiceTotal: 11800, receiveNow: true, lines: [expect.objectContaining({ productId: "cm00000000000000000000003", quantity: 100, unitCost: 100 })] }));
  });

  it("denies a station outside the signed-in owner’s scope", async () => {
    const response = await request(createApp()).post("/api/purchases/invoice-import").set("Cookie", "fuelledger_session=valid").set("Idempotency-Key", "invoice-import-test-0003").send({ ...input, stationId: "cm00000000000000000000009" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("STATION_ACCESS_DENIED");
    expect(purchases.createInvoice).not.toHaveBeenCalled();
  });

  it("keeps confirmed import owner-only without changing the normal purchase workflow", async () => {
    auth.currentUser.mockResolvedValue({ ...owner, role: "MANAGER" });
    const response = await request(createApp()).post("/api/purchases/invoice-import").set("Cookie", "fuelledger_session=valid").set("Idempotency-Key", "invoice-import-test-0005").send(input);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INVOICE_IMPORT_UNAVAILABLE");
    expect(purchases.createInvoice).not.toHaveBeenCalled();
  });

  it("preserves the duplicate protection returned by the purchase workflow", async () => {
    purchases.createInvoice.mockRejectedValue(new AppError(409, "INVOICE_EXISTS", "This invoice number already exists for the supplier."));
    const response = await request(createApp()).post("/api/purchases/invoice-import").set("Cookie", "fuelledger_session=valid").set("Idempotency-Key", "invoice-import-test-0004").send(input);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVOICE_EXISTS");
  });

  it("rejects private business fields in performance measurements", async () => {
    const response = await request(createApp()).post("/api/purchases/invoice-import/metrics").set("Cookie", "fuelledger_session=valid").send({ stage: "OCR", durationMs: 1200, outcome: "SUCCESS", invoiceNumber: "SECRET-91" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("METRIC_INVALID");
  });
});
