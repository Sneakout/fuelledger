import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ purchaseReceipt: { findMany: vi.fn() }, shift: { findMany: vi.fn().mockResolvedValue([]) }, receiptLine: { findMany: vi.fn().mockResolvedValue([]) } }));
vi.mock("../src/lib/prisma.js", () => ({ prisma: db }));

import { receiptTimingAudit, resolveReceiptTiming } from "../src/modules/purchases/service.js";

describe("purchase receipt timing", () => {
  const now = new Date("2026-09-06T08:30:00.000Z");

  it("defaults physical receipt time to the actual entry time", () => {
    expect(resolveReceiptTiming(undefined, undefined, now)).toEqual({ receivedAt: now, receivedAtReason: null });
  });

  it("does not derive physical receipt time from a past invoice date", () => {
    const pastInvoiceDate = new Date("2025-12-28T00:00:00.000Z");
    const timing = resolveReceiptTiming(undefined, undefined, now);
    expect(timing.receivedAt).toEqual(now);
    expect(timing.receivedAt).not.toEqual(pastInvoiceDate);
  });

  it("requires a reason for a deliberately earlier receipt time", () => {
    expect(() => resolveReceiptTiming("2025-12-28T08:30:00.000Z", undefined, now)).toThrowError(expect.objectContaining({ code: "RECEIPT_TIME_REASON_REQUIRED" }));
    expect(resolveReceiptTiming("2025-12-28T08:30:00.000Z", "Delivery entered from the dip register", now)).toEqual({ receivedAt: new Date("2025-12-28T08:30:00.000Z"), receivedAtReason: "Delivery entered from the dip register" });
  });

  it("rejects a future physical receipt time", () => {
    expect(() => resolveReceiptTiming("2026-09-07T08:30:00.000Z", "Planned delivery", now)).toThrowError(expect.objectContaining({ code: "RECEIPT_TIME_FUTURE" }));
  });
});

describe("legacy receipt timing audit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports suspicious legacy matches without changing records", async () => {
    const invoiceDate = new Date("2025-12-28T00:00:00.000Z");
    db.purchaseReceipt.findMany.mockResolvedValue([
      { id: "old", referenceNo: "INV-1", receivedAt: invoiceDate, receivedAtReason: null, createdAt: new Date("2026-09-06T08:30:00.000Z"), supplierName: "Oil Co", station: { id: "s", name: "Fuel Station", code: "FS" }, createdBy: { name: "Owner" }, invoice: { invoiceNumber: "INV-1", invoiceDate } },
      { id: "explained", referenceNo: "INV-2", receivedAt: invoiceDate, receivedAtReason: "Verified delivery register", createdAt: new Date("2026-09-06T08:30:00.000Z"), supplierName: "Oil Co", station: { id: "s", name: "Fuel Station", code: "FS" }, createdBy: { name: "Owner" }, invoice: { invoiceNumber: "INV-2", invoiceDate } },
    ]);
    const report = await receiptTimingAudit("org", ["s"]);
    expect(report.recordsChanged).toBe(false);
    expect(report.candidates.map(row => row.id)).toEqual(["old"]);
    expect(db.purchaseReceipt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org", stationId: { in: ["s"] } }) }));
  });
});
