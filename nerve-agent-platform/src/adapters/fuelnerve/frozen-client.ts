import type { FuelNerveReadClient, FuelNerveScope, FuelNerveSnapshot } from "./types.ts";

/**
 * Captures each read once and replays an immutable copy for the rest of a pilot.
 * This keeps deterministic and model-assisted runs on exactly the same records.
 */
export class FrozenFuelNerveReadClient implements FuelNerveReadClient {
  constructor(source: FuelNerveReadClient) { this.source = source; }
  private readonly source: FuelNerveReadClient;
  private readonly snapshots = new Map<string, Promise<FuelNerveSnapshot>>();

  dashboardFacts(scope: FuelNerveScope, signal: AbortSignal) { return this.read("dashboardFacts", scope, signal); }
  shiftAndReconciliationStatus(scope: FuelNerveScope, signal: AbortSignal) { return this.read("shiftAndReconciliationStatus", scope, signal); }
  inventoryPosition(scope: FuelNerveScope, signal: AbortSignal) { return this.read("inventoryPosition", scope, signal); }
  customerAgeing(scope: FuelNerveScope, signal: AbortSignal) { return this.read("customerAgeing", scope, signal); }
  supplierPayables(scope: FuelNerveScope, signal: AbortSignal) { return this.read("supplierPayables", scope, signal); }
  purchasePriceHistory(scope: FuelNerveScope, signal: AbortSignal) { return this.read("purchasePriceHistory", scope, signal); }
  purchaseReview(scope: FuelNerveScope, signal: AbortSignal) { return this.read("purchaseReview", scope, signal); }
  receiptTimingStatus(scope: FuelNerveScope, signal: AbortSignal) { return this.read("receiptTimingStatus", scope, signal); }
  journalProfit(scope: FuelNerveScope, signal: AbortSignal) { return this.read("journalProfit", scope, signal); }
  resolveEvidence(scope: FuelNerveScope, evidenceId: string, signal: AbortSignal) { return this.read("resolveEvidence", scope, signal, evidenceId); }

  private async read(method: keyof FuelNerveReadClient, scope: FuelNerveScope, signal: AbortSignal, evidenceId?: string) {
    const cacheKey = JSON.stringify([method, scope, evidenceId]);
    let snapshot = this.snapshots.get(cacheKey);
    if (!snapshot) {
      snapshot = method === "resolveEvidence"
        ? this.source.resolveEvidence(scope, evidenceId!, signal)
        : this.source[method](scope, signal);
      this.snapshots.set(cacheKey, snapshot);
    }
    try { return structuredClone(await snapshot); }
    catch (error) { this.snapshots.delete(cacheKey); throw error; }
  }
}
