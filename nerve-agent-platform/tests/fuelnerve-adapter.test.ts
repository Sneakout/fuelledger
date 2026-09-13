import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AgentRegistry,
  AgentSdkError,
  CONTRACT_VERSION,
  FUELNERVE_APPLICATION_ID,
  FuelNerveShadowRunner,
  InMemoryAuditStore,
  InMemoryNonceStore,
  InMemoryShadowStore,
  InMemoryUsageStore,
  MockFuelNerveReadClient,
  NerveRuntime,
  StaticModelProvider,
  TenantUsageLimiter,
  ToolRegistry,
  agentNarrativeSchema,
  fuelNerveToolIds,
  registerFuelNerveTools,
  signEnvelope,
  type AgentDefinition,
  type AgentInvocation,
  type AgentNarrative,
  type FactPacket,
  type FuelNerveScope,
  type JsonObject,
  type ToolResult,
} from "../src/index.ts";

const signingKey = { keyId: "fuelnerve-key-1", secret: "fuelnerve-test-secret-with-sufficient-length" };
const allScopes = ["dashboard:read", "reconciliation:read", "inventory:read", "customers:read", "purchases:read", "accounting:read", "evidence:read"];

test("FuelNerve adapter exposes read-only source-of-truth snapshots without cross-organization or station leakage", async () => {
  const { registry } = adapterFixture();
  const result = await registry.execute(toolRequest("inventory.position.read", ["station-a1"]));
  const serialized = JSON.stringify(result.output);
  const item = (result.output.items as JsonObject[])[0]!;
  assert.deepEqual({ bookStock: item.bookStock, physicalStock: item.physicalStock, variance: item.variance }, { bookStock: 1_000, physicalStock: 990, variance: -10 });
  assert.match(serialized, /station-a1/);
  assert.doesNotMatch(serialized, /station-a2|station-b1|9999|8888/);
  assert.ok(result.evidence.every(item => item.tenantId === "org-a"));
  await assert.rejects(() => registry.execute(toolRequest("inventory.position.read", ["station-b1"])), (error: unknown) => error instanceof AgentSdkError && error.code === "LOCATION_DENIED");
});

test("adapter rejects a source client that returns cross-tenant data", async () => {
  class LeakingClient extends MockFuelNerveReadClient {
    override async inventoryPosition(scope: FuelNerveScope) {
      return { data: { organizationId: "org-b", items: [{ stationId: "station-b1" }] }, evidence: [], calculatedAt: scope.asOf };
    }
  }
  const registry = new ToolRegistry({ applicationId: FUELNERVE_APPLICATION_ID });
  registerFuelNerveTools(registry, new LeakingClient());
  await assert.rejects(() => registry.execute(toolRequest("inventory.position.read", ["station-a1"])), (error: unknown) => error instanceof AgentSdkError && error.code === "TENANT_MISMATCH");
});

test("shadow mode stores hidden findings with resolvable FuelNerve evidence and no proposals or actions", async () => {
  const fixture = shadowFixture();
  const outcome = await fixture.shadow.run(signedInvocation());
  assert.equal(outcome.findingCount, 9);
  const findings = await fixture.shadowStore.findings(outcome.runId);
  assert.equal(findings.length, 9);
  assert.ok(findings.every(item => item.visibility === "SHADOW" && item.evidence.length === 1));
  assert.ok(findings.every(item => item.proposalIds.length === 0 && item.actionIds.length === 0));
  assert.ok(fixture.client.calls.includes("resolveEvidence"));
});

test("manual comparison records false positives and missing findings", async () => {
  const fixture = shadowFixture();
  const outcome = await fixture.shadow.run(signedInvocation());
  const findings = await fixture.shadowStore.findings(outcome.runId);
  const expected = [findings[0]!.deduplicationKey, "manually-expected-but-missing"];
  const comparison = await fixture.shadow.compare({ runId: outcome.runId, expectedDeduplicationKeys: expected, reviewedBy: "reviewer-1", notes: "Compared with the FuelNerve screens." });
  assert.equal(comparison.missingKeys[0], "manually-expected-but-missing");
  assert.equal(comparison.falsePositiveKeys.length, 8);
  assert.equal((await fixture.shadowStore.comparisons(outcome.runId)).length, 1);
});

test("shadow evidence resolution requires explicit evidence scope", async () => {
  const fixture = shadowFixture();
  const invocation: AgentInvocation = { agentKey: "fuelnerve-shadow-review", agentVersion: "1.0.0", context: { ...context(), grantedScopes: allScopes.filter(scope => scope !== "evidence:read") }, input: {}, triggerType: "EVALUATION" };
  await assert.rejects(() => fixture.shadow.run(signEnvelope(invocation, signingKey, { nonce: randomUUID() })), (error: unknown) => error instanceof AgentSdkError && error.code === "SCOPE_DENIED");
});

test("Nerve failure does not mutate or prevent FuelNerve reads", async () => {
  const fixture = shadowFixture({ agentTool: "unregistered.write" });
  await assert.rejects(() => fixture.shadow.run(signedInvocation()), AgentSdkError);
  const direct = await fixture.client.inventoryPosition({ organizationId: "org-a", stationIds: ["station-a1"], asOf: new Date().toISOString() }, new AbortController().signal);
  assert.equal((direct.data.items as JsonObject[])[0]?.stationId, "station-a1");
  assert.ok(fixture.client.calls.every(call => ["inventory", "resolveEvidence", "dashboard", "reconciliation", "receivables", "payables", "purchase-price", "purchase-review", "profit"].includes(call)));
});

function adapterFixture() {
  const client = new MockFuelNerveReadClient();
  const registry = new ToolRegistry({ applicationId: FUELNERVE_APPLICATION_ID, supportedVersions: [CONTRACT_VERSION] });
  registerFuelNerveTools(registry, client);
  return { client, registry };
}

function shadowFixture(options: { agentTool?: string } = {}) {
  const { client, registry } = adapterFixture();
  const agents = new AgentRegistry(); agents.register(shadowAgent(options.agentTool));
  const audit = new InMemoryAuditStore();
  const runtime = new NerveRuntime({
    agents, tools: registry, model: new StaticModelProvider(modelNarrative), audit,
    usage: new TenantUsageLimiter(new InMemoryUsageStore(), { maxRuns: 100, maxToolCalls: 1000, maxInputTokens: 100_000, maxOutputTokens: 100_000 }),
    resolveApplicationKey: keyId => keyId === signingKey.keyId ? signingKey.secret : undefined,
    nonceStore: new InMemoryNonceStore(), safetyIdentifierSalt: "fuelnerve-shadow-test-salt",
  });
  const shadowStore = new InMemoryShadowStore();
  return { client, registry, runtime, shadowStore, shadow: new FuelNerveShadowRunner(runtime, client, shadowStore) };
}

function shadowAgent(overrideTool?: string): AgentDefinition {
  const planned = overrideTool ? [overrideTool] : fuelNerveToolIds.filter(id => id !== "evidence.record.resolve");
  return {
    agentKey: "fuelnerve-shadow-review", agentVersion: "1.0.0", promptVersion: "fuelnerve-shadow.prompt@1",
    description: "Shadow-only review across FuelNerve read models.", instructions: "Explain only supplied FuelNerve facts.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: fuelNerveToolIds.filter(id => id !== "evidence.record.resolve"),
    maxToolCalls: fuelNerveToolIds.length - 1, maxOutputTokens: 500,
    plan: (_input, context) => planned.map(toolId => ({ toolId, input: { locationIds: context.permittedLocationIds, asOf: new Date().toISOString(), startDate: "2026-09-01", endDate: "2026-09-07" } })),
    buildFacts(results: ToolResult[]): FactPacket {
      const facts = results.map((result, index) => {
        const items = result.output.items as JsonObject[];
        const first = items[0] ?? {};
        const stationId = String(first.stationId ?? "all");
        const evidence = result.evidence.find(item => item.resourceId.startsWith(`${stationId}:`)) ?? result.evidence[0]!;
        return { factId: `fact-${index + 1}`, label: result.toolId, value: first, evidenceIds: [evidence.evidenceId] };
      });
      return { facts, evidence: results.flatMap(result => result.evidence) };
    },
    validateOutput: agentNarrativeSchema,
    deterministicFallback: facts => ({ headline: "FuelNerve shadow review", summary: "Application-calculated facts are available for manual review.", claims: facts.facts.map((fact, index) => ({ claimId: `fallback-${index + 1}`, text: fact.label, factIds: [fact.factId], evidenceIds: fact.evidenceIds })) }),
  };
}

function modelNarrative(request: Parameters<StaticModelProvider["generate"]>[0]): AgentNarrative {
  const facts = request.input.facts as Array<{ factId: string; label: string; evidenceIds: string[] }>;
  return { headline: "FuelNerve shadow review", summary: "All statements use application-calculated facts.", claims: facts.map((fact, index) => ({ claimId: `claim-${index + 1}`, text: fact.label, factIds: [fact.factId], evidenceIds: fact.evidenceIds })) };
}

function context() {
  const now = new Date();
  return {
    contractVersion: CONTRACT_VERSION, applicationId: FUELNERVE_APPLICATION_ID, environment: "development" as const,
    tenantId: "org-a", actorId: "owner-a", roles: ["OWNER"], permittedLocationIds: ["station-a1"], grantedScopes: allScopes,
    correlationId: randomUUID(), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString(),
  };
}

function toolRequest(toolId: string, locationIds: string[]) {
  return { requestId: randomUUID(), toolId, contractVersion: CONTRACT_VERSION, context: context(), input: { locationIds, asOf: new Date().toISOString() } };
}

function signedInvocation() {
  const invocation: AgentInvocation = { agentKey: "fuelnerve-shadow-review", agentVersion: "1.0.0", context: context(), input: {}, triggerType: "EVALUATION" };
  return signEnvelope(invocation, signingKey, { nonce: randomUUID() });
}
