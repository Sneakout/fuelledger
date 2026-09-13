import type { ExecutionContext, JsonObject } from "../../contracts.ts";
import { AgentSdkError } from "../../errors.ts";
import type { ToolRegistry } from "../../registry.ts";
import { jsonObject, object, string, stringArray } from "../../validation.ts";
import { CONTRACT_VERSION } from "../../contracts.ts";
import { FUELNERVE_APPLICATION_ID, type FuelNerveReadClient, type FuelNerveScope, type FuelNerveSnapshot } from "./types.ts";

export const fuelNerveToolIds = [
  "fuelnerve.dashboard.read",
  "fuelnerve.reconciliation-status.read",
  "inventory.position.read",
  "receivables.ageing.read",
  "fuelnerve.supplier-payables.read",
  "purchases.price-history.read",
  "purchases.review.read",
  "fuelnerve.receipt-timing.read",
  "profit.summary.read",
  "evidence.record.resolve",
] as const;

type ReadMethod = Exclude<keyof FuelNerveReadClient, "resolveEvidence">;
const registrations: Array<{ toolId: typeof fuelNerveToolIds[number]; scope: string; method: ReadMethod; description: string }> = [
  { toolId: "fuelnerve.dashboard.read", scope: "dashboard:read", method: "dashboardFacts", description: "Read FuelNerve dashboard facts." },
  { toolId: "fuelnerve.reconciliation-status.read", scope: "reconciliation:read", method: "shiftAndReconciliationStatus", description: "Read shift and reconciliation status." },
  { toolId: "inventory.position.read", scope: "inventory:read", method: "inventoryPosition", description: "Read time-aware book and physical stock." },
  { toolId: "receivables.ageing.read", scope: "customers:read", method: "customerAgeing", description: "Read application-calculated customer ageing." },
  { toolId: "fuelnerve.supplier-payables.read", scope: "purchases:read", method: "supplierPayables", description: "Read supplier payables." },
  { toolId: "purchases.price-history.read", scope: "purchases:read", method: "purchasePriceHistory", description: "Read effective-dated purchase price history." },
  { toolId: "purchases.review.read", scope: "purchases:read", method: "purchaseReview", description: "Read verified invoice, receipt, rate, quantity, correction and payable exceptions." },
  { toolId: "fuelnerve.receipt-timing.read", scope: "purchases:read", method: "receiptTimingStatus", description: "Read side-effect-free receipt timing audit facts." },
  { toolId: "profit.summary.read", scope: "accounting:read", method: "journalProfit", description: "Read journal-derived profit." },
];

export function registerFuelNerveTools(registry: ToolRegistry, client: FuelNerveReadClient): void {
  for (const registration of registrations) {
    registry.register({
      definition: {
        toolId: registration.toolId, contractVersion: CONTRACT_VERSION, description: registration.description,
        actionClass: "OBSERVE", riskLevel: registration.scope === "accounting:read" || registration.scope === "customers:read" ? "R1" : "R0",
        requiredScopes: [registration.scope], requiresApproval: false, idempotent: false, timeoutMs: 10_000,
        inputSchemaId: "fuelnerve.read-scope@1", outputSchemaId: `fuelnerve.${registration.method}@1`,
      },
      validateInput: readScopeInput,
      validateOutput: jsonObject,
      handler: async (request, signal) => presentSnapshot(await client[registration.method](toScope(request.context, request.input), signal), request.context, request.input.locationIds as string[]),
    });
  }
  registry.register({
    definition: {
      toolId: "evidence.record.resolve", contractVersion: CONTRACT_VERSION, description: "Resolve FuelNerve evidence metadata after current authorization.",
      actionClass: "OBSERVE", riskLevel: "R1", requiredScopes: ["evidence:read"], requiresApproval: false, idempotent: false,
      timeoutMs: 5_000, inputSchemaId: "fuelnerve.evidence-query@1", outputSchemaId: "fuelnerve.evidence-record@1",
    },
    validateInput: evidenceInput,
    validateOutput: jsonObject,
    handler: async (request, signal) => presentSnapshot(await client.resolveEvidence(toScope(request.context, request.input), request.input.evidenceId as string, signal), request.context, request.input.locationIds as string[]),
  });
}

function readScopeInput(value: unknown, path = "input"): JsonObject {
  const v = object(value, path);
  const result: JsonObject = { locationIds: stringArray(v.locationIds, `${path}.locationIds`), asOf: validDate(v.asOf, `${path}.asOf`) };
  if (v.startDate !== undefined) result.startDate = validDate(v.startDate, `${path}.startDate`);
  if (v.endDate !== undefined) result.endDate = validDate(v.endDate, `${path}.endDate`);
  return result;
}

function evidenceInput(value: unknown, path = "input"): JsonObject {
  return { ...readScopeInput(value, path), evidenceId: string(object(value, path).evidenceId, `${path}.evidenceId`) };
}

function validDate(value: unknown, path: string): string {
  const result = string(value, path);
  if (!Number.isFinite(Date.parse(result))) throw new AgentSdkError("INPUT_INVALID", `${path} must be a valid date or date-time.`);
  return result;
}

function toScope(context: ExecutionContext, input: JsonObject): FuelNerveScope {
  if (context.applicationId !== FUELNERVE_APPLICATION_ID) throw new AgentSdkError("INVALID_CONTEXT", "FuelNerve adapter received another application's context.");
  const requested = input.locationIds as string[];
  const denied = requested.filter(id => !context.permittedLocationIds.includes(id));
  if (denied.length) throw new AgentSdkError("LOCATION_DENIED", "FuelNerve station access denied.", false, { deniedLocationIds: denied });
  return {
    organizationId: context.tenantId, stationIds: requested, asOf: input.asOf as string,
    ...(typeof input.startDate === "string" ? { startDate: input.startDate } : {}),
    ...(typeof input.endDate === "string" ? { endDate: input.endDate } : {}),
  };
}

function presentSnapshot(snapshot: FuelNerveSnapshot, context: ExecutionContext, stationIds: string[]) {
  assertScopedPayload(snapshot.data, context.tenantId, stationIds);
  return { output: snapshot.data, evidence: snapshot.evidence, calculatedAt: snapshot.calculatedAt };
}

function assertScopedPayload(value: unknown, tenantId: string, stationIds: string[], path = "output"): void {
  if (Array.isArray(value)) return value.forEach((item, index) => assertScopedPayload(item, tenantId, stationIds, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (["organizationId", "tenantId"].includes(key) && child !== tenantId) throw new AgentSdkError("TENANT_MISMATCH", `${path}.${key} is outside the requested organization.`);
    if (["stationId", "locationId"].includes(key) && typeof child === "string" && !stationIds.includes(child)) throw new AgentSdkError("LOCATION_DENIED", `${path}.${key} is outside the requested station scope.`);
    assertScopedPayload(child, tenantId, stationIds, `${path}.${key}`);
  }
}
