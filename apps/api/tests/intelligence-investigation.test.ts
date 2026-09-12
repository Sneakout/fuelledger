import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, findUnique, readForNerve, nerveFindingSources } = vi.hoisted(() => ({ create: vi.fn(), findUnique: vi.fn(), readForNerve: vi.fn(), nerveFindingSources: vi.fn() }));
vi.mock("../src/lib/prisma.js", () => ({ prisma: { organization: { findUnique: vi.fn().mockResolvedValue({ intelligenceEnabledAt: new Date(), intelligenceExpiresAt: null }) }, intelligenceInvestigation: { findUnique, findUniqueOrThrow: vi.fn(), count: vi.fn().mockResolvedValue(0), create } } }));
vi.mock("../src/modules/nerve/read-service.js", () => ({ readForNerve, nerveReadCapabilities: ["inventory", "receipt-timing", "reconciliation"] }));
vi.mock("../src/modules/intelligence/nerve-findings.js", () => ({ nerveFindingSources }));

import { investigateFinding } from "../src/modules/intelligence/investigation.js";

const evidence = (capability: string, path: string) => [{ evidenceId: `evidence-${capability}`, evidenceType: capability.toUpperCase(), applicationId: "fuelnerve", tenantId: "org-a", resourceId: `station-a:${capability}`, label: `${capability} records`, observedAt: new Date().toISOString(), resolverPath: path }];
const inventoryFinding = { findingId: "11111111-1111-4111-8111-111111111111", type: "PHYSICAL_BOOK_VARIANCE", title: "Physical and book stock differ", summary: "{}", detectedAt: new Date().toISOString(), visibility: "SHADOW", proposalIds: [], actionIds: [], evidence: [{ label: "Inventory", resolverPath: "/inventory" }], agent: { agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock" }, detail: { findingType: "PHYSICAL_BOOK_VARIANCE", sourceKey: "tank-1" } };

describe("evidence-backed investigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(null);
    nerveFindingSources.mockResolvedValue([inventoryFinding]);
    create.mockImplementation(async ({ data }) => ({ id: "investigation-1", result: data.result }));
    readForNerve.mockImplementation(async (capability: string) => {
      if (capability === "inventory") return { data: { organizationId: "org-a", items: [{ stationId: "station-a", tankId: "tank-1", tankCode: "T-1", productCode: "HSD", openingStock: 1000, receipts: 500, sales: 400, adjustments: 0, bookStock: 1100, physicalStock: 1082, bookStockAtReading: 1100, physicalReadingAt: "2026-09-07T10:00:00.000Z", variance: -18, stockStatus: "HEALTHY" }] }, evidence: evidence("inventory", "/inventory"), calculatedAt: new Date().toISOString() };
      if (capability === "receipt-timing") return { data: { organizationId: "org-a", items: [{ stationId: "station-a", anomaly: false }] }, evidence: evidence("receipt-timing", "/purchases"), calculatedAt: new Date().toISOString() };
      return { data: { organizationId: "org-a", items: [{ stationId: "station-a", pendingReconciliations: 0, shifts: [] }] }, evidence: evidence("reconciliation", "/reconciliation"), calculatedAt: new Date().toISOString() };
    });
  });

  it("reloads allow-listed records and returns cited observations without actions", async () => {
    const result = await investigateFinding({ organizationId: "org-a", stationId: "station-a", userId: "user-a", requestId: "22222222-2222-4222-8222-222222222222", findingIds: ["11111111-1111-4111-8111-111111111111"], reportPath: "/safe/report.json" });
    expect(readForNerve.mock.calls.map(call => call[0])).toEqual(["inventory", "receipt-timing"]);
    expect(result.status).toBe("READ_ONLY");
    expect(result.agent).toEqual({ agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock" });
    expect(result.observations[0]).toMatchObject({ title: "HSD T-1", evidenceIds: ["evidence-inventory"] });
    expect(result.possibleExplanations[0]?.factIds.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("actions");
    expect(create).toHaveBeenCalledOnce();
  });

  it("fails closed when an adapter returns another tenant's records", async () => {
    readForNerve.mockResolvedValue({ data: { organizationId: "org-b", items: [{ stationId: "station-a" }] }, evidence: [{ ...evidence("inventory", "/inventory")[0], tenantId: "org-b" }], calculatedAt: new Date().toISOString() });
    await expect(investigateFinding({ organizationId: "org-a", stationId: "station-a", userId: "user-a", requestId: "33333333-3333-4333-8333-333333333333", findingIds: ["11111111-1111-4111-8111-111111111111"], reportPath: "/safe/report.json" })).rejects.toMatchObject({ code: "INVESTIGATION_SCOPE_INVALID" });
    expect(create).not.toHaveBeenCalled();
  });

  it("fails closed when an adapter returns another station's records", async () => {
    readForNerve.mockResolvedValue({ data: { organizationId: "org-a", items: [{ stationId: "station-b" }] }, evidence: evidence("inventory", "/inventory"), calculatedAt: new Date().toISOString() });
    await expect(investigateFinding({ organizationId: "org-a", stationId: "station-a", userId: "user-a", requestId: "44444444-4444-4444-8444-444444444444", findingIds: ["11111111-1111-4111-8111-111111111111"], reportPath: "/safe/report.json" })).rejects.toMatchObject({ code: "INVESTIGATION_SCOPE_INVALID" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key reused for a different station or finding set", async () => {
    findUnique.mockResolvedValue({ id: "existing", stationId: "station-b", userId: "user-a", findingIds: ["11111111-1111-4111-8111-111111111111"], result: { status: "READ_ONLY" } });
    await expect(investigateFinding({ organizationId: "org-a", stationId: "station-a", userId: "user-a", requestId: "55555555-5555-4555-8555-555555555555", findingIds: ["11111111-1111-4111-8111-111111111111"], reportPath: "/safe/report.json" })).rejects.toMatchObject({ code: "INVESTIGATION_IDEMPOTENCY_CONFLICT" });
    expect(readForNerve).not.toHaveBeenCalled();
  });

  it("reloads a profit finding for its saved report period instead of the click date", async () => {
    nerveFindingSources.mockResolvedValue([{ ...inventoryFinding, type: "PROFIT_CHANGE_MATERIAL", title: "Review revenue movement first", agent: { agentKey: "profit-insight", name: "Profit Agent", purpose: "Margin, costs and financial changes", icon: "profit" }, detail: { findingType: "PROFIT_CHANGE_MATERIAL", periodStart: "2026-09-01", periodEnd: "2026-09-07" } }]);
    readForNerve.mockResolvedValue({ data: { organizationId: "org-a", items: [{ stationId: "station-a", revenue: 340947.5, cogs: 308522, operatingExpenses: 2600, netProfit: 29825.5, priorRevenue: 1919968.75, priorCogs: 1742300, priorOperatingExpenses: 107000, priorNetProfit: 70668.75, materialChange: true, leadingComponent: "Revenue", leadingComponentChange: -1579021.25 }] }, evidence: evidence("profit", "/reports"), calculatedAt: new Date().toISOString() });

    const result = await investigateFinding({ organizationId: "org-a", stationId: "station-a", userId: "user-a", requestId: "66666666-6666-4666-8666-666666666666", findingIds: [inventoryFinding.findingId], reportPath: "/safe/report.json" });

    expect(readForNerve).toHaveBeenCalledOnce();
    expect(readForNerve).toHaveBeenCalledWith("profit", expect.objectContaining({ startDate: "2026-09-01", endDate: "2026-09-07" }));
    expect(result.observations[0]).toMatchObject({ title: "Selected period’s posted result", value: "Net result ₹29,826" });
    expect(result.observations[1]).toMatchObject({ title: "Review revenue first", value: "Movement -₹15,79,021" });
    expect(result.observations[2]?.detail).toContain("₹70,669");
  });

  it("keeps a receipt-timing investigation on its receipt evidence and Purchases page", async () => {
    nerveFindingSources.mockResolvedValue([{ ...inventoryFinding, type: "RECEIPT_TIMING_ANOMALY", title: "Receipt timing needs review", agent: { agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock" }, detail: { findingType: "RECEIPT_TIMING_ANOMALY", sourceKey: "receipt-1" } }]);
    readForNerve.mockResolvedValue({ data: { organizationId: "org-a", items: [{ stationId: "station-a", receiptId: "receipt-1", invoiceNumber: "INV-1", supplierName: "Supplier", anomaly: true, reason: "The receipt was entered later.", receivedAt: "2026-09-01T08:00:00.000Z", enteredAt: "2026-09-01T09:00:00.000Z", affectedTanks: [] }] }, evidence: evidence("receipt-timing", "/purchases"), calculatedAt: new Date().toISOString() });

    const result = await investigateFinding({ organizationId: "org-a", stationId: "station-a", userId: "user-a", requestId: "77777777-7777-4777-8777-777777777777", findingIds: [inventoryFinding.findingId], reportPath: "/safe/report.json" });

    expect(readForNerve.mock.calls.map(call => call[0])).toEqual(["receipt-timing"]);
    expect(result.nextChecks).toEqual([expect.objectContaining({ label: "Verify receipt documents", resolverPath: "/purchases" })]);
    expect(result.evidence).toEqual([expect.objectContaining({ label: "receipt-timing records", resolverPath: "/purchases" })]);
    expect(result.unknowns.map(item => item.title)).toEqual(["Actual delivery time"]);
    expect(result.possibleExplanations[0]?.text).toBe("The receipt has ambiguous timing. Confirming its physical arrival time may clarify which shift and stock position it belongs to.");
  });
});
