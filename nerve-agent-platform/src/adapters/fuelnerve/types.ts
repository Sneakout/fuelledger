import type { EvidenceReference, JsonObject } from "../../contracts.ts";

export const FUELNERVE_APPLICATION_ID = "fuelnerve" as const;

export type FuelNerveScope = {
  organizationId: string;
  stationIds: string[];
  asOf: string;
  startDate?: string;
  endDate?: string;
};

export type FuelNerveSnapshot = {
  data: JsonObject;
  evidence: EvidenceReference[];
  calculatedAt: string;
};

/** Read-only anti-corruption boundary. Implementations wrap FuelNerve domain services, never Prisma. */
export interface FuelNerveReadClient {
  dashboardFacts(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  shiftAndReconciliationStatus(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  inventoryPosition(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  customerAgeing(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  supplierPayables(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  purchasePriceHistory(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  purchaseReview(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  receiptTimingStatus(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  journalProfit(scope: FuelNerveScope, signal: AbortSignal): Promise<FuelNerveSnapshot>;
  resolveEvidence(scope: FuelNerveScope, evidenceId: string, signal: AbortSignal): Promise<FuelNerveSnapshot>;
}
