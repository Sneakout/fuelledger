import { createHmac, randomUUID } from "node:crypto";
import type { EvidenceReference, JsonObject } from "../../contracts.ts";
import { AgentSdkError } from "../../errors.ts";
import { FUELNERVE_APPLICATION_ID, type FuelNerveReadClient, type FuelNerveScope, type FuelNerveSnapshot } from "./types.ts";

type Fetch = typeof globalThis.fetch;
type Capability = "dashboard" | "reconciliation" | "inventory" | "receivables" | "payables" | "purchase-price" | "purchase-review" | "receipt-timing" | "profit" | "evidence";

export type FuelNerveHttpClientOptions = { baseUrl: string; keyId: string; sharedSecret: string; fetch?: Fetch };

/** Local HTTP anti-corruption client. It has no database dependency and exposes read methods only. */
export class FuelNerveHttpReadClient implements FuelNerveReadClient {
  private readonly baseUrl: string;
  private readonly keyId: string;
  private readonly sharedSecret: string;
  private readonly fetch: Fetch;

  constructor(options: FuelNerveHttpClientOptions) {
    if (!options.baseUrl.startsWith("http://localhost:") && !options.baseUrl.startsWith("http://127.0.0.1:")) throw new AgentSdkError("INVALID_REQUEST", "Local shadow mode only accepts a localhost FuelNerve URL.");
    if (options.sharedSecret.length < 32) throw new AgentSdkError("INVALID_REQUEST", "The local FuelNerve shared secret must contain at least 32 characters.");
    this.baseUrl = options.baseUrl.replace(/\/$/, ""); this.keyId = options.keyId; this.sharedSecret = options.sharedSecret; this.fetch = options.fetch ?? globalThis.fetch;
  }

  dashboardFacts(scope: FuelNerveScope, signal: AbortSignal) { return this.read("dashboard", scope, signal); }
  shiftAndReconciliationStatus(scope: FuelNerveScope, signal: AbortSignal) { return this.read("reconciliation", scope, signal); }
  inventoryPosition(scope: FuelNerveScope, signal: AbortSignal) { return this.read("inventory", scope, signal); }
  customerAgeing(scope: FuelNerveScope, signal: AbortSignal) { return this.read("receivables", scope, signal); }
  supplierPayables(scope: FuelNerveScope, signal: AbortSignal) { return this.read("payables", scope, signal); }
  purchasePriceHistory(scope: FuelNerveScope, signal: AbortSignal) { return this.read("purchase-price", scope, signal); }
  purchaseReview(scope: FuelNerveScope, signal: AbortSignal) { return this.read("purchase-review", scope, signal); }
  receiptTimingStatus(scope: FuelNerveScope, signal: AbortSignal) { return this.read("receipt-timing", scope, signal); }
  journalProfit(scope: FuelNerveScope, signal: AbortSignal) { return this.read("profit", scope, signal); }
  resolveEvidence(scope: FuelNerveScope, evidenceId: string, signal: AbortSignal) { return this.read("evidence", { ...scope, evidenceId } as FuelNerveScope & { evidenceId: string }, signal); }

  private async read(capability: Capability, scope: FuelNerveScope & { evidenceId?: string }, signal: AbortSignal): Promise<FuelNerveSnapshot> {
    const body: JsonObject = { capability, organizationId: scope.organizationId, stationIds: scope.stationIds, asOf: scope.asOf, ...(scope.startDate ? { startDate: scope.startDate } : {}), ...(scope.endDate ? { endDate: scope.endDate } : {}), ...(scope.evidenceId ? { evidenceId: scope.evidenceId } : {}) };
    const timestamp = new Date().toISOString(), nonce = randomUUID(), signature = createHmac("sha256", this.sharedSecret).update(`${timestamp}.${nonce}.${canonicalJson(body)}`).digest("hex");
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/nerve/v1/read`, { method: "POST", headers: { "content-type": "application/json", "x-nerve-key-id": this.keyId, "x-nerve-timestamp": timestamp, "x-nerve-nonce": nonce, "x-nerve-signature": signature }, body: JSON.stringify(body), signal });
    } catch (error) {
      throw new AgentSdkError("TOOL_FAILED", "FuelNerve is unavailable; shadow mode made no application changes.", true, { cause: error instanceof Error ? error.name : "NETWORK_ERROR" });
    }
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new AgentSdkError(response.status === 403 ? "LOCATION_DENIED" : "TOOL_FAILED", "FuelNerve rejected the local shadow read.", response.status >= 500, { status: response.status });
    return snapshot(payload);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function snapshot(value: unknown): FuelNerveSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentSdkError("OUTPUT_INVALID", "FuelNerve returned an invalid snapshot.");
  const row = value as Record<string, unknown>;
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data) || !Array.isArray(row.evidence) || typeof row.calculatedAt !== "string") throw new AgentSdkError("OUTPUT_INVALID", "FuelNerve returned an invalid snapshot.");
  return { data: row.data as JsonObject, evidence: row.evidence as EvidenceReference[], calculatedAt: row.calculatedAt };
}
