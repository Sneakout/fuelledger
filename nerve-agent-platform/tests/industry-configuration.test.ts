import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentConfigurationRegistry,
  IndustryPackRegistry,
  configuredApprovalPolicies,
  createConfiguredGenericAgents,
  defaultApprovalPolicies,
  fuelRetailIndustryPack,
  genericCommerceIndustryPack,
  type AgentConfigurationProfile,
  type ExecutionContext,
  type ToolResult,
} from "../src/index.ts";

test("fuel retail and generic commerce packs declare concepts without calculation formulas", () => {
  assert.deepEqual(fuelRetailIndustryPack.concepts.map(item => item.conceptKey), ["tank", "nozzle", "meter-reading", "density", "wet-stock-variance", "shift-reconciliation", "receipt-timing"]);
  assert.deepEqual(genericCommerceIndustryPack.concepts.map(item => item.conceptKey), ["product", "inventory-location", "invoice", "customer", "receivable", "expense", "profit"]);
  assert.ok([...fuelRetailIndustryPack.thresholdDefinitions, ...genericCommerceIndustryPack.thresholdDefinitions].every(item => item.applicationEvaluated));
  assert.doesNotMatch(JSON.stringify([fuelRetailIndustryPack, genericCommerceIndustryPack]), /formula|calculate|ledger account/i);
});

test("tenant configuration creates relevant agents without a custom fork", () => {
  const profile = configuration(); const agents = createConfiguredGenericAgents(genericCommerceIndustryPack, profile);
  assert.deepEqual(agents.map(agent => agent.agentKey), ["inventory-watch", "business-assistant"]);
  assert.equal(agents[0]?.displayName, "Branch Stock Sentinel");
  const planned = agents[0]!.plan({}, context());
  assert.deepEqual(planned[0]?.input.configuration, { configurationId: "config-commerce-a", configurationVersion: 1, enabledFindingKeys: ["inventory.low", "inventory.empty"], thresholds: { "inventory.lowPercent": 15 } });
  const assistant = agents[1]!;
  assert.equal(assistant.plan({ intent: "inventory" }, context()).length, 1);
  assert.equal(assistant.plan({ intent: "profit" }, context()).length, 0);
});

test("evidence aliases change presentation but preserve source identity", () => {
  const agent = createConfiguredGenericAgents(genericCommerceIndustryPack, configuration())[0]!;
  const result: ToolResult = { requestId: "request-1", toolId: "inventory.position.read", contractVersion: "1.1", status: "SUCCEEDED", output: { items: [{ tenantId: "commerce-a", locationId: "branch-1", status: "LOW", requiresReview: true, displayValue: 4 }] }, evidence: [{ evidenceId: "evidence-1", evidenceType: "INVENTORY_POSITION", applicationId: "commerce-lite", tenantId: "commerce-a", resourceId: "sku-1", label: "Original source label", resolverPath: "/evidence/sku-1?location=branch-1" }], calculatedAt: new Date().toISOString() };
  const packet = agent.buildFacts([result], context());
  assert.equal(packet.evidence[0]?.label, "Open branch stock record");
  assert.equal(packet.evidence[0]?.evidenceId, "evidence-1"); assert.equal(packet.evidence[0]?.resolverPath, "/evidence/sku-1?location=branch-1");
});

test("configuration versions are immutable and isolated by application, tenant, and environment", () => {
  const packs = new IndustryPackRegistry(); packs.register(genericCommerceIndustryPack); const registry = new AgentConfigurationRegistry(packs, defaultApprovalPolicies);
  registry.save(configuration());
  assert.throws(() => registry.save(configuration()));
  registry.save({ ...configuration(), configurationId: "config-commerce-b", tenantId: "commerce-b" });
  registry.save({ ...configuration(), configurationId: "config-commerce-a-v2", version: 2, enabledFindingKeys: ["inventory.low"] });
  assert.equal(registry.resolve("commerce-lite", "commerce-a", "production").version, 2);
  assert.equal(registry.resolve("commerce-lite", "commerce-b", "production").configurationId, "config-commerce-b");
});

test("thresholds must be declared and approval overrides cannot weaken baseline safety", () => {
  const packs = new IndustryPackRegistry(); packs.register(genericCommerceIndustryPack); const registry = new AgentConfigurationRegistry(packs, defaultApprovalPolicies);
  assert.throws(() => registry.save({ ...configuration(), thresholds: { "inventory.lowPercent": 101 } }));
  assert.throws(() => registry.save({ ...configuration(), approvalRequirements: [{ proposalType: "INVENTORY_ADJUSTMENT_REQUEST", requiredRoleSets: [["OWNER"]], expiresAfterMinutes: 240 }] }));
  const stronger = { ...configuration(), approvalRequirements: [{ proposalType: "INVENTORY_ADJUSTMENT_REQUEST" as const, requiredRoleSets: [["OWNER"], ["ACCOUNTANT"], ["AUDITOR"]], expiresAfterMinutes: 120 }] };
  registry.save(stronger);
  const policies = configuredApprovalPolicies(stronger, defaultApprovalPolicies); const inventory = policies.find(item => item.proposalType === "INVENTORY_ADJUSTMENT_REQUEST")!;
  assert.equal(inventory.requiredRoleSets.length, 3); assert.equal(inventory.expiresAfterMinutes, 120);
});

function configuration(): AgentConfigurationProfile { return { configurationId: "config-commerce-a", version: 1, applicationId: "commerce-lite", tenantId: "commerce-a", environment: "production", packId: "generic-commerce", packVersion: "1.0.0", enabledAgentKeys: ["inventory-watch", "business-assistant"], agentDisplayNames: { "inventory-watch": "Branch Stock Sentinel" }, enabledFindingKeys: ["inventory.low", "inventory.empty"], thresholds: { "inventory.lowPercent": 15 }, locationTerminology: "store", notificationPolicy: { enabledChannels: ["IN_APP", "EMAIL"], minimumSeverity: "ATTENTION", quietPeriods: [{ start: "22:00", end: "07:00" }] }, approvalRequirements: [], evidenceLabelAliases: { INVENTORY_POSITION: "Open branch stock record" }, supportedQuestionIntents: ["inventory"] }; }
function context(): ExecutionContext { const now = new Date(); return { contractVersion: "1.1", applicationId: "commerce-lite", environment: "production", tenantId: "commerce-a", actorId: "owner-1", roles: ["OWNER"], permittedLocationIds: ["branch-1"], grantedScopes: ["inventory:read"], correlationId: "correlation-1", issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() }; }
