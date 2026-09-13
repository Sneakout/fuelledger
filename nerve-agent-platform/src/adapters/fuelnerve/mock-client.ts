import type { EvidenceReference, JsonObject } from "../../contracts.ts";
import { FUELNERVE_APPLICATION_ID, type FuelNerveReadClient, type FuelNerveScope, type FuelNerveSnapshot } from "./types.ts";

type StationRow = { organizationId: string; stationId: string; bookStock: number; physicalStock: number; receivables: number; payables: number; profit: number };

export class MockFuelNerveReadClient implements FuelNerveReadClient {
  readonly calls: string[] = [];
  private readonly rows: StationRow[] = [
    { organizationId: "org-a", stationId: "station-a1", bookStock: 1_000, physicalStock: 990, receivables: 500, payables: 250, profit: 125 },
    { organizationId: "org-a", stationId: "station-a2", bookStock: 2_000, physicalStock: 2_000, receivables: 0, payables: 100, profit: 220 },
    { organizationId: "org-b", stationId: "station-b1", bookStock: 9_999, physicalStock: 1, receivables: 8_888, payables: 7_777, profit: -500 },
  ];

  dashboardFacts(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("dashboard", scope, row => ({ stationId: row.stationId, sales: row.profit * 10, topProduct: "MS", topProductContribution: 62, stationContribution: 100 })); }
  shiftAndReconciliationStatus(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("reconciliation", scope, row => ({ stationId: row.stationId, openShiftOverdue: false, openShifts: 0, pendingReconciliations: row.stationId === "station-a1" ? 1 : 0, missingReadings: row.stationId === "station-a1" ? 2 : 0, collectionVariance: row.stationId === "station-a1" ? -50 : 0, unusualHandover: false })); }
  inventoryPosition(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("inventory", scope, row => ({ stationId: row.stationId, bookStock: row.bookStock, physicalStock: row.physicalStock, variance: row.physicalStock - row.bookStock, stockStatus: row.bookStock <= 0 ? "EMPTY" : row.bookStock <= 1_000 ? "LOW" : "HEALTHY", varianceRequiresReview: Math.abs(row.physicalStock - row.bookStock) > 5, unusualMovement: false, densityMissing: row.stationId === "station-a1", asOf: scope.asOf })); }
  customerAgeing(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("receivables", scope, row => ({ stationId: row.stationId, customerId: "customer-1", customer: "Arun Transport", outstanding: row.receivables, ageing: { current: 0, days1to30: row.receivables, days31to60: 0, days61to90: 0, days90plus: 0 }, invoices: row.receivables > 0 ? [{ invoiceId: "ledger-1", invoiceNumber: "INV-1001", eventDate: "2026-08-01T00:00:00.000Z", dueDate: "2026-08-31T00:00:00.000Z", originalAmount: 800, amountPaid: 300, outstanding: row.receivables, status: "PARTIALLY_PAID_OVERDUE", daysOverdue: 11, creditLimit: 1_000, customerOutstanding: row.receivables, priorityRank: 1, priorityReason: "₹500 remains overdue for 11 days" }] : [] })); }
  supplierPayables(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("payables", scope, row => ({ stationId: row.stationId, outstanding: row.payables, overdue: false })); }
  purchasePriceHistory(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("purchase-price", scope, row => ({ stationId: row.stationId, productId: "product-1", effectivePrice: 90, history: [{ price: 89, effectiveFrom: "2026-08-01T00:00:00.000Z" }] })); }
  purchaseReview(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("purchase-review", scope, row => ({ stationId: row.stationId, type: "PURCHASE_RATE_DISCREPANCY", invoiceId: "invoice-1", receiptId: "receipt-1", title: "IndianOil's IO-100 rate needs review", explanation: "HSD was invoiced at ₹91 per L; the effective agreed rate for the same product, unit, tax and invoice date is ₹90.", severity: "ATTENTION", difference: 1 })); }
  receiptTimingStatus(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("receipt-timing", scope, row => ({ stationId: row.stationId, anomaly: false, candidateCount: 0 })); }
  journalProfit(scope: FuelNerveScope, _signal?: AbortSignal) { return this.snapshot("profit", scope, row => ({ stationId: row.stationId, netProfit: row.profit, revenue: row.profit * 10, cogs: row.profit * 8, operatingExpenses: row.profit, priorNetProfit: 150, netProfitChangePercent: -16.67, materialChange: row.stationId === "station-a1", topProduct: "MS", topProductContribution: 62, stationContribution: 100, reportPeriod: { ...(scope.startDate ? { startDate: scope.startDate } : {}), ...(scope.endDate ? { endDate: scope.endDate } : {}) } })); }

  async resolveEvidence(scope: FuelNerveScope, evidenceId: string): Promise<FuelNerveSnapshot> {
    this.calls.push("resolveEvidence");
    const prefix = `fn:${scope.organizationId}:`;
    const evidence = this.allEvidence(scope).find(item => item.evidenceId === evidenceId && evidenceId.startsWith(prefix));
    return { data: { found: Boolean(evidence), evidenceId }, evidence: evidence ? [evidence] : [], calculatedAt: scope.asOf };
  }

  private async snapshot(name: string, scope: FuelNerveScope, select: (row: StationRow) => JsonObject): Promise<FuelNerveSnapshot> {
    this.calls.push(name);
    const rows = this.scoped(scope);
    const evidence = rows.map(row => this.evidence(scope, name, row.stationId));
    return { data: { organizationId: scope.organizationId, asOf: scope.asOf, items: rows.map(select) }, evidence, calculatedAt: scope.asOf };
  }
  private scoped(scope: FuelNerveScope) { return this.rows.filter(row => row.organizationId === scope.organizationId && scope.stationIds.includes(row.stationId)); }
  private evidence(scope: FuelNerveScope, type: string, stationId: string): EvidenceReference {
    return { evidenceId: `fn:${scope.organizationId}:${stationId}:${type}`, evidenceType: type.toUpperCase(), applicationId: FUELNERVE_APPLICATION_ID, tenantId: scope.organizationId, resourceId: `${stationId}:${type}`, label: `${type} record`, observedAt: scope.asOf, resolverPath: `/evidence/${type}/${stationId}` };
  }
  private allEvidence(scope: FuelNerveScope) {
    return this.scoped(scope).flatMap(row => ["dashboard", "reconciliation", "inventory", "receivables", "payables", "purchase-price", "purchase-review", "receipt-timing", "profit"].map(type => this.evidence(scope, type, row.stationId)));
  }
}
