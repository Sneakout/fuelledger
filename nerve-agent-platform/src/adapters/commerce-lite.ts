import type { GenericBusinessReadClient, GenericBusinessScope, GenericBusinessSnapshot } from "./generic-business.ts";
import type { IndustryTerminology } from "../industry-pack.ts";
import { AgentSdkError } from "../errors.ts";
import type { JsonObject } from "../contracts.ts";

export const COMMERCE_LITE_APPLICATION_ID = "commerce-lite" as const;
export const commerceLitePack: IndustryTerminology = { packId: "generic-commerce", version: "1.0.0", location: "branch", inventoryUnit: "SKU", product: "item", customer: "account", receivable: "outstanding balance", profitReport: "management P&L" };
type CommerceTenant = { tenantId: string; locations: string[] };

/** A second application's read-only adapter. Its in-memory data simulates its own API, not Nerve storage. */
export class CommerceLiteReadClient implements GenericBusinessReadClient {
  constructor(privateTenants: CommerceTenant[]) { this.tenants = privateTenants; }
  private readonly tenants: CommerceTenant[];
  async inventoryPosition(scope: GenericBusinessScope) { this.authorize(scope); return snapshot(scope, "INVENTORY_POSITION", scope.locationIds.map((locationId, index) => ({ tenantId: scope.tenantId, locationId, sku: `SKU-${index + 1}`, status: index === 0 ? "LOW" : "OK", requiresReview: index === 0, displayValue: index === 0 ? 4 : 35 }))); }
  async receivablesAgeing(scope: GenericBusinessScope) { this.authorize(scope); return snapshot(scope, "RECEIVABLES_AGEING", scope.locationIds.map((locationId, index) => ({ tenantId: scope.tenantId, locationId, accountId: `account-${index + 1}`, amount: index === 0 ? 1250 : 0, ageBucket: index === 0 ? "31_60_DAYS" : "CURRENT", requiresReview: index === 0 }))); }
  async profitSummary(scope: GenericBusinessScope) { this.authorize(scope); return snapshot(scope, "PROFIT_SUMMARY", scope.locationIds.map(locationId => ({ tenantId: scope.tenantId, locationId, revenue: 10000, cogs: 6000, expenses: 2000, netResult: 2000, materialChange: false }))); }
  async resolveEvidence(scope: GenericBusinessScope, evidenceId: string) { this.authorize(scope); return snapshot(scope, "SUPPORTING_RECORD", [{ tenantId: scope.tenantId, locationId: scope.locationIds[0]!, label: "CommerceLite supporting record", value: evidenceId }]); }
  private authorize(scope: GenericBusinessScope) { const tenant = this.tenants.find(item => item.tenantId === scope.tenantId); if (!tenant) throw new AgentSdkError("TENANT_MISMATCH", "CommerceLite authentication denied this tenant."); const denied = scope.locationIds.filter(id => !tenant.locations.includes(id)); if (denied.length) throw new AgentSdkError("LOCATION_DENIED", "CommerceLite authorization denied one or more branches."); }
}
function snapshot(scope: GenericBusinessScope, type: string, items: JsonObject[]): GenericBusinessSnapshot { return { data: { items }, calculatedAt: scope.asOf, evidence: scope.locationIds.map(locationId => ({ evidenceId: `${type.toLowerCase()}:${scope.tenantId}:${locationId}:${scope.asOf}`, evidenceType: type, applicationId: COMMERCE_LITE_APPLICATION_ID, tenantId: scope.tenantId, resourceId: `${locationId}:${type.toLowerCase()}`, label: `${commerceLitePack.location} ${locationId} ${type.toLowerCase().replaceAll("_", " ")}`, observedAt: scope.asOf, version: "commerce-lite-v1", resolverPath: `/app/evidence/${encodeURIComponent(type)}/${encodeURIComponent(locationId)}?location=${encodeURIComponent(locationId)}` })) }; }
