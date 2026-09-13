import type { EvidenceReference, ExecutionContext, JsonObject } from "../contracts.ts";
import { AgentSdkError } from "../errors.ts";
import type { ToolRegistry } from "../registry.ts";
import { jsonObject, object, string, stringArray } from "../validation.ts";
import type { IndustryTerminology } from "../industry-pack.ts";

export type GenericBusinessScope = { tenantId: string; locationIds: string[]; asOf: string; startDate?: string; endDate?: string; configuration?: JsonObject };
export type GenericBusinessSnapshot = { data: JsonObject; evidence: EvidenceReference[]; calculatedAt: string };
export interface GenericBusinessReadClient {
  inventoryPosition(scope: GenericBusinessScope, signal: AbortSignal): Promise<GenericBusinessSnapshot>;
  receivablesAgeing(scope: GenericBusinessScope, signal: AbortSignal): Promise<GenericBusinessSnapshot>;
  profitSummary(scope: GenericBusinessScope, signal: AbortSignal): Promise<GenericBusinessSnapshot>;
  resolveEvidence(scope: GenericBusinessScope, evidenceId: string, signal: AbortSignal): Promise<GenericBusinessSnapshot>;
}

const tools = [
  { toolId: "inventory.position.read", scope: "inventory:read", method: "inventoryPosition", riskLevel: "R0" },
  { toolId: "receivables.ageing.read", scope: "receivables:read", method: "receivablesAgeing", riskLevel: "R1" },
  { toolId: "profit.summary.read", scope: "profit:read", method: "profitSummary", riskLevel: "R1" },
] as const;

export function registerGenericBusinessTools(input: { registry: ToolRegistry; applicationId: string; client: GenericBusinessReadClient; terminology: IndustryTerminology; contractVersion?: string }) {
  const version = input.contractVersion ?? "1.0";
  for (const tool of tools) input.registry.register({
    definition: { toolId: tool.toolId, contractVersion: version, description: `Read application-calculated ${tool.method} using the ${input.terminology.packId} pack.`, actionClass: "OBSERVE", riskLevel: tool.riskLevel, requiredScopes: [tool.scope], requiresApproval: false, idempotent: false, timeoutMs: 10_000, inputSchemaId: "nerve.generic-scope@1", outputSchemaId: `nerve.${tool.toolId}@1` },
    validateInput: scopeSchema, validateOutput: jsonObject,
    handler: async (request, signal) => present(await input.client[tool.method](scope(request.context, request.input, input.applicationId), signal), request.context, request.input.locationIds as string[]),
  });
  input.registry.register({ definition: { toolId: "evidence.record.resolve", contractVersion: version, description: "Resolve an application-owned evidence reference.", actionClass: "OBSERVE", riskLevel: "R1", requiredScopes: ["evidence:read"], requiresApproval: false, idempotent: false, timeoutMs: 5_000, inputSchemaId: "nerve.evidence-query@1", outputSchemaId: "nerve.evidence-record@1" }, validateInput: evidenceSchema, validateOutput: jsonObject, handler: async (request, signal) => present(await input.client.resolveEvidence(scope(request.context, request.input, input.applicationId), request.input.evidenceId as string, signal), request.context, request.input.locationIds as string[]) });
}

function scopeSchema(value: unknown, path = "input") { const row = object(value, path); const asOf = string(row.asOf, `${path}.asOf`); if (!Number.isFinite(Date.parse(asOf))) throw new AgentSdkError("INPUT_INVALID", "asOf must be a date-time."); return { locationIds: stringArray(row.locationIds, `${path}.locationIds`), asOf, ...(typeof row.startDate === "string" ? { startDate: row.startDate } : {}), ...(typeof row.endDate === "string" ? { endDate: row.endDate } : {}), ...(row.configuration === undefined ? {} : { configuration: jsonObject(row.configuration, `${path}.configuration`) }) }; }
function evidenceSchema(value: unknown, path = "input") { return { ...scopeSchema(value, path), evidenceId: string(object(value, path).evidenceId, `${path}.evidenceId`) }; }
function scope(context: ExecutionContext, value: JsonObject, applicationId: string): GenericBusinessScope { if (context.applicationId !== applicationId) throw new AgentSdkError("INVALID_CONTEXT", "Adapter received another application's context."); const locationIds = value.locationIds as string[]; const denied = locationIds.filter(id => !context.permittedLocationIds.includes(id)); if (denied.length) throw new AgentSdkError("LOCATION_DENIED", "Location access denied."); return { tenantId: context.tenantId, locationIds, asOf: value.asOf as string, ...(typeof value.startDate === "string" ? { startDate: value.startDate } : {}), ...(typeof value.endDate === "string" ? { endDate: value.endDate } : {}), ...(value.configuration && typeof value.configuration === "object" && !Array.isArray(value.configuration) ? { configuration: value.configuration } : {}) }; }
function present(snapshot: GenericBusinessSnapshot, context: ExecutionContext, locationIds: string[]) { assertScoped(snapshot.data, context.tenantId, locationIds); return { output: snapshot.data, evidence: snapshot.evidence, calculatedAt: snapshot.calculatedAt }; }
function assertScoped(value: unknown, tenantId: string, locations: string[]): void { if (Array.isArray(value)) return value.forEach(item => assertScoped(item, tenantId, locations)); if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (key === "tenantId" && child !== tenantId) throw new AgentSdkError("TENANT_MISMATCH", "Adapter returned another tenant's data."); if (key === "locationId" && typeof child === "string" && !locations.includes(child)) throw new AgentSdkError("LOCATION_DENIED", "Adapter returned another location's data."); assertScoped(child, tenantId, locations); } }
