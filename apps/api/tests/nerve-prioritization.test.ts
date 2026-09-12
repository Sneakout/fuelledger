import { beforeEach, describe, expect, it, vi } from "vitest";

const { reconciliationBootstrap, openShiftsForNerve, inventoryBootstrap, stockAnalyticsForNerve, receiptTimingAudit, buildReport } = vi.hoisted(() => ({
  reconciliationBootstrap: vi.fn(), openShiftsForNerve: vi.fn(), inventoryBootstrap: vi.fn(), stockAnalyticsForNerve: vi.fn(), receiptTimingAudit: vi.fn(), buildReport: vi.fn(),
}));

vi.mock("../src/modules/dashboard/service.js", () => ({ bootstrap: vi.fn() }));
vi.mock("../src/modules/reconciliation/service.js", () => ({ bootstrap: reconciliationBootstrap, openShiftsForNerve }));
vi.mock("../src/modules/inventory/service.js", () => ({ bootstrap: inventoryBootstrap, stockAnalyticsForNerve, analyzeTankMovements: (rows: Array<{ type: string; quantityDelta: number; occurredAt: Date }>, bookStock: number) => ({ unusualMovement: false, unusualReasons: [], movementSample: { windowDays: 14, sellingDays: rows.filter(row => row.type === "SALE").length }, runoutEstimate: null, forecastWithheldReason: bookStock > 0 ? "At least 7 selling days within the last 14 days are required." : "Runout is not estimated when recorded stock is empty or below zero." }) }));
vi.mock("../src/modules/customers/service.js", () => ({ bootstrap: vi.fn() }));
vi.mock("../src/modules/purchases/service.js", () => ({ bootstrap: vi.fn(), receiptTimingAudit }));
vi.mock("../src/modules/reports/service.js", () => ({ buildReport }));

import { readForNerve } from "../src/modules/nerve/read-service.js";

const scope = { organizationId: "org-a", stationId: "station-a", asOf: "2026-09-08T10:00:00.000Z", startDate: "2026-09-01", endDate: "2026-09-07" };

describe("FuelNerve deterministic agent prioritization", () => {
  beforeEach(() => { vi.clearAllMocks(); receiptTimingAudit.mockResolvedValue({ candidates: [] }); openShiftsForNerve.mockResolvedValue([]); stockAnalyticsForNerve.mockResolvedValue(new Map()); });

  it("ranks the shift with the strongest application-calculated review signals first", async () => {
    reconciliationBootstrap.mockResolvedValue({ shifts: [shift(2, "2026-09-08T09:00:00.000Z"), shift(7, "2026-09-08T06:00:00.000Z", true)], customers: [] });
    const result = await readForNerve("reconciliation", scope);
    const item = (result.data.items as Array<Record<string, any>>)[0]!;
    expect(item.priority).toMatchObject({ shiftNumber: 7, priorityRank: 1, awaitingMinutes: 240, missingReadings: 2, missingCollections: 1 });
    expect(item.priority.priorityReasons).toContain("2 closing readings are missing");
    expect(item.priority.recordsToCompare).toContain("Payment-method totals");
    expect(item.shiftBriefings[0]).toMatchObject({ shiftId: "shift-7", shiftNumber: 7, stationName: "Station A", priorityRank: 1 });
    expect(item.shiftBriefings[0].issueTypes).toEqual(expect.arrayContaining(["RECONCILIATION_PENDING", "MISSING_READINGS", "MISSING_COLLECTIONS", "COLLECTION_DIFFERENCE", "HANDOVER_INCOMPLETE"]));
  });

  it("identifies the exact overdue open shift using the documented twelve-hour rule", async () => {
    reconciliationBootstrap.mockResolvedValue({ shifts: [], customers: [] });
    openShiftsForNerve.mockResolvedValue([{ shiftId: "shift-open", shiftNumber: 9, stationId: "station-a", stationName: "Station A", stationCode: "STA", managerName: "Manager", openedAt: new Date("2026-09-07T20:00:00.000Z"), openMinutes: 840, overdue: true, closingCashMissing: true, missingReadings: 0, missingCollections: 1 }]);
    const result = await readForNerve("reconciliation", scope);
    const item = (result.data.items as Array<Record<string, any>>)[0]!;
    expect(item.openShiftOverdue).toBe(true);
    expect(item.shiftBriefings[0]).toMatchObject({ shiftId: "shift-open", shiftNumber: 9, stationName: "Station A", priorityRank: 1, awaitingMinutes: 840 });
    expect(item.shiftBriefings[0].issueTypes).toEqual(["OPEN_OVERDUE", "MISSING_COLLECTIONS", "HANDOVER_INCOMPLETE"]);
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Shift 9 records", resolverPath: "/operations?shiftId=shift-open" })]));
  });

  it("resolves record-specific shift evidence within the authorized station", async () => {
    reconciliationBootstrap.mockResolvedValue({ shifts: [shift(7, "2026-09-08T06:00:00.000Z", true)], customers: [] });
    const review = await readForNerve("reconciliation", scope);
    const shiftEvidence = review.evidence.find(item => item.resourceId === "station-a:shift:shift-7")!;

    const resolved = await readForNerve("evidence", { ...scope, evidenceId: shiftEvidence.evidenceId });

    expect(resolved.data).toMatchObject({ organizationId: "org-a", stationId: "station-a", found: true, evidenceId: shiftEvidence.evidenceId });
    expect(resolved.evidence).toEqual([expect.objectContaining({ resourceId: "station-a:shift:shift-7", resolverPath: "/reconciliation?shiftId=shift-7" })]);
  });

  it("does not turn an ordinary in-progress shift into an owner alert", async () => {
    reconciliationBootstrap.mockResolvedValue({ shifts: [], customers: [] });
    openShiftsForNerve.mockResolvedValue([{ shiftId: "shift-current", shiftNumber: 10, stationId: "station-a", stationName: "Station A", stationCode: "STA", managerName: "Manager", openedAt: new Date("2026-09-08T08:00:00.000Z"), openMinutes: 120, overdue: false, closingCashMissing: true, missingReadings: 2, missingCollections: 1 }]);
    const result = await readForNerve("reconciliation", scope);
    const item = (result.data.items as Array<Record<string, any>>)[0]!;
    expect(item.openShifts).toBe(1);
    expect(item.openShiftOverdue).toBe(false);
    expect(item.shiftBriefings).toEqual([]);
    expect(result.evidence).not.toEqual(expect.arrayContaining([expect.objectContaining({ label: "Shift 10 records" })]));
  });

  it("ranks an empty tank ahead of lower-risk stock positions and carries receipt context", async () => {
    inventoryBootstrap.mockResolvedValue({ tanks: [tank("tank-low", "T-LOW", 100), tank("tank-empty", "T-EMPTY", 0)], receipts: [{ id: "receipt-1", supplierName: "Supplier", referenceNo: "R-1", receivedAt: new Date("2026-09-07T08:00:00.000Z"), lines: [{ tank: { code: "T-EMPTY" } }] }] });
    receiptTimingAudit.mockResolvedValue({ candidates: [{ id: "receipt-1", invoiceNumber: "INV-1", supplierName: "Supplier", reason: "Arrival time is ambiguous", receivedAt: new Date("2026-09-07T08:00:00.000Z"), enteredAt: new Date("2026-09-07T09:00:00.000Z"), affectedTanks: [{ tankId: "tank-empty" }] }] });
    const result = await readForNerve("inventory", scope);
    const items = result.data.items as Array<Record<string, any>>;
    expect(items[0]).toMatchObject({ tankId: "tank-empty", priorityRank: 1, stockStatus: "EMPTY" });
    expect(items[0]!.recentReceipts).toHaveLength(1);
    expect(items[0]!.ambiguousReceipts).toHaveLength(1);
    expect(items[0]!.unverified).toContain("Physical receipt arrival time");
  });

  it("uses FuelNerve period results to identify the leading financial movement", async () => {
    buildReport.mockImplementation(async (_organizationId: string, filter: { startDate: string }) => report(filter.startDate === "2026-09-01"));
    const result = await readForNerve("profit", scope);
    const item = (result.data.items as Array<Record<string, any>>)[0]!;
    expect(item).toMatchObject({ materialChange: true, leadingComponent: "Revenue", leadingComponentChange: 200, priorityRank: 1 });
    expect(item.componentMovements).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Revenue", current: 1000, previous: 800, change: 200 })]));
    expect(item.relatedPostedAccounts[0]).toMatchObject({ code: "4000", name: "Fuel sales" });
    expect(item.observedContributions).toMatchObject({ totalRecordedSalesRevenue: 1000, fuel: { amount: 700, percent: 70 }, nonFuel: { amount: 300, percent: 30 }, reconciliationDifference: 0 });
    expect(item.revenue - item.cogs - item.operatingExpenses).toBe(item.netProfit);
    expect(item.comparison).toMatchObject({ equivalentCalendarDays: true, reliableForInterpretation: true, current: { startDate: "2026-09-01", endDate: "2026-09-07" }, previous: { startDate: "2026-08-25", endDate: "2026-08-31" } });
    expect(buildReport).toHaveBeenCalledTimes(2);
  });

  it("flags an incomplete period and missing cost postings without inventing a cause", async () => {
    buildReport.mockImplementation(async (_organizationId: string, filter: { startDate: string }) => {
      const value = report(filter.startDate !== "2026-08-25");
      if (filter.startDate === "2026-09-01") {
        value.financial.cogs = 0; value.financial.netProfit = value.financial.revenue - value.financial.operatingExpenses;
        value.quality = { periodComplete: false, incompleteReason: "The selected period includes the current business day.", missingCostOfSales: true, missingCostReason: "Sales are recorded but no positive cost-of-sales posting is present for the selected period.", salesToPostedRevenueDifference: 0, netProfitReconciliationDifference: 0 };
      }
      return value;
    });
    const result = await readForNerve("profit", scope);
    const item = (result.data.items as Array<Record<string, any>>)[0]!;
    expect(item.reportQuality).toMatchObject({ periodComplete: false, missingCostOfSales: true });
    expect(item.comparison.reliableForInterpretation).toBe(false);
    expect(item.unverified).toEqual(expect.arrayContaining(["Full-period result", "Profit result until missing costs are posted", "Operational cause of each change"]));
    expect(item.possibleCauses).toEqual([]);
  });
});

function shift(shiftNumber: number, closedAt: string, incomplete = false) {
  return { id: `shift-${shiftNumber}`, station: { id: "station-a", name: "Station A" }, shiftNumber, status: "RECONCILIATION_REQUIRED", openedAt: new Date("2026-09-08T01:00:00.000Z"), closedAt: new Date(closedAt), closingCash: 100, manager: { name: "Manager" }, salesTotal: 1000, autoUnallocated: 0, collectionDifferences: { shortage: 0, excess: 0 }, totals: { variance: incomplete ? -50 : 0 }, reconciliation: null, tankReadings: [{ closingDip: incomplete ? null : 1 }], nozzleReadings: [{ closingMeter: incomplete ? null : 1 }], nozzleAssignments: [{ collectionAmount: incomplete ? null : 100 }] };
}

function tank(id: string, code: string, bookStock: number) {
  return { station: { id: "station-a" }, tank: { id, code }, product: { id: `product-${id}`, code: "HSD", name: "Diesel" }, opening: 1000, receipts: 200, sales: 400, adjustments: id === "tank-empty" ? -800 : 0, bookStock, physicalStock: bookStock === 0 ? 10 : 90, bookStockAtReading: bookStock, readAt: new Date("2026-09-08T08:00:00.000Z"), variance: bookStock === 0 ? 10 : -10, density: null, densityRecordedAt: null };
}

function report(current: boolean) {
  const revenue = current ? 1000 : 800, cogs = current ? 600 : 500, operatingExpenses = 100, netProfit = revenue - cogs - operatingExpenses;
  return { filter: { startDate: current ? "2026-09-01" : "2026-08-25", endDate: current ? "2026-09-07" : "2026-08-31" }, summary: { grossSales: revenue }, customers: [], payables: [], sales: { byProduct: [{ product: "Diesel", category: "FUEL", revenue: 700 }, { product: "Lubricants", category: "LUBRICANTS", revenue: revenue - 700 }], byStation: [{ key: "station-a", amount: revenue }] }, financial: { revenue, cogs, operatingExpenses, netProfit, accounts: [{ code: "4000", name: "Fuel sales", balance: revenue }, { code: "5000", name: "Cost of sales", balance: cogs }] }, quality: { periodComplete: true, incompleteReason: null, missingCostOfSales: false, missingCostReason: null, salesToPostedRevenueDifference: 0, netProfitReconciliationDifference: 0 } };
}
