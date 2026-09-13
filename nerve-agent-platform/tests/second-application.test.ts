import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentRegistry,
  AgentSdkError,
  COMMERCE_LITE_APPLICATION_ID,
  CommerceLiteReadClient,
  InMemoryAuditStore,
  InMemoryNonceStore,
  InMemoryUsageStore,
  NerveClient,
  NerveRuntime,
  TenantUsageLimiter,
  ToolRegistry,
  commerceLitePack,
  createGenericBusinessAssistantAgent,
  createGenericInventoryWatchAgent,
  createGenericProfitInsightAgent,
  createGenericReceivablesAgent,
  registerGenericBusinessTools,
  signEnvelope,
  verifyEnvelope,
  type AgentInvocation,
  type ExecutionContext,
  type ModelProvider,
  type SigningKey,
} from "../src/index.ts";

const key: SigningKey = { keyId: "commerce-lite-prod-v1", secret: "commerce-lite-independent-signing-secret" };

test("CommerceLite uses the TypeScript SDK, generic contracts, and its own evidence links at contract 1.1", async () => {
  const registry = commerceTools(); const nonces = new InMemoryNonceStore();
  const client = new NerveClient(key, async envelope => registry.execute(await verifyEnvelope(envelope, id => id === key.keyId ? key.secret : undefined, nonces)));
  const result = await client.call({ context: context("commerce-a", ["branch-1"], ["inventory:read"]), toolId: "inventory.position.read", payload: { locationIds: ["branch-1"], asOf: "2026-09-07T10:00:00.000Z" } });
  assert.equal(result.contractVersion, "1.1");
  assert.equal(result.evidence[0]?.applicationId, COMMERCE_LITE_APPLICATION_ID);
  assert.match(result.evidence[0]?.resolverPath ?? "", /^\/app\/evidence\//);
  assert.match(result.evidence[0]?.label ?? "", /branch/);
});

test("four reusable agents operate read-only against the second application without Nerve Core changes", async () => {
  const tools = commerceTools(); const agents = new AgentRegistry();
  agents.register(createGenericInventoryWatchAgent(commerceLitePack)); agents.register(createGenericReceivablesAgent(commerceLitePack)); agents.register(createGenericProfitInsightAgent(commerceLitePack)); agents.register(createGenericBusinessAssistantAgent(commerceLitePack));
  assert.equal(agents.list().length, 4); assert.ok(agents.list().every(agent => !/FuelNerve|tank|nozzle|shift/i.test(`${agent.description} ${agent.instructions}`)));
  const nonces = new InMemoryNonceStore(); const runtime = new NerveRuntime({ agents, tools, model: unavailableModel, audit: new InMemoryAuditStore(), usage: new TenantUsageLimiter(new InMemoryUsageStore(), { maxRuns: 20, maxToolCalls: 20, maxInputTokens: 1000, maxOutputTokens: 10000 }), resolveApplicationKey: id => id === key.keyId ? key.secret : undefined, nonceStore: nonces, safetyIdentifierSalt: "second-app-test-salt" });
  const inventory = await run(runtime, "inventory-watch", ["inventory:read"], "nonce-inventory");
  const receivables = await run(runtime, "receivables-watch", ["receivables:read"], "nonce-receivables");
  const profit = await run(runtime, "profit-insight", ["profit:read"], "nonce-profit");
  const assistant = await run(runtime, "business-assistant", ["receivables:read"], "nonce-assistant", { intent: "receivables" });
  assert.equal(inventory.narrativeMode, "DETERMINISTIC_FALLBACK"); assert.match(inventory.facts[0]?.label ?? "", /SKU/);
  assert.match(receivables.facts[0]?.label ?? "", /account/); assert.match(profit.facts[0]?.label ?? "", /management P&L/); assert.ok(assistant.facts.length > 0);
  assert.ok([inventory, receivables, profit, assistant].flatMap(row => row.evidence).every(item => item.applicationId === COMMERCE_LITE_APPLICATION_ID && item.tenantId === "commerce-a"));
});

test("application and tenant policies remain isolated", async () => {
  const registry = commerceTools();
  await assert.rejects(() => registry.execute({ requestId: "request-1", toolId: "inventory.position.read", contractVersion: "1.1", context: { ...context("commerce-a", ["branch-1"], ["inventory:read"]), applicationId: "fuelnerve" }, input: { locationIds: ["branch-1"], asOf: new Date().toISOString() } }), (error: unknown) => error instanceof AgentSdkError && error.code === "INVALID_CONTEXT");
  await assert.rejects(() => registry.execute({ requestId: "request-2", toolId: "inventory.position.read", contractVersion: "1.1", context: context("commerce-b", ["branch-1"], ["inventory:read"]), input: { locationIds: ["branch-1"], asOf: new Date().toISOString() } }), (error: unknown) => error instanceof AgentSdkError && error.code === "TENANT_MISMATCH");
  await assert.rejects(() => registry.execute({ requestId: "request-3", toolId: "inventory.position.read", contractVersion: "1.1", context: context("commerce-a", ["branch-2"], ["inventory:read"]), input: { locationIds: ["branch-2"], asOf: new Date().toISOString() } }), (error: unknown) => error instanceof AgentSdkError && error.code === "LOCATION_DENIED");
});

function commerceTools() { const registry = new ToolRegistry({ applicationId: COMMERCE_LITE_APPLICATION_ID, supportedVersions: ["1.1"] }); registerGenericBusinessTools({ registry, applicationId: COMMERCE_LITE_APPLICATION_ID, client: new CommerceLiteReadClient([{ tenantId: "commerce-a", locations: ["branch-1"] }]), terminology: commerceLitePack, contractVersion: "1.1" }); return registry; }
function context(tenantId: string, locations: string[], scopes: string[]): ExecutionContext { const now = new Date(); return { contractVersion: "1.1", applicationId: COMMERCE_LITE_APPLICATION_ID, environment: "production", tenantId, actorId: "commerce-owner", roles: ["OWNER"], permittedLocationIds: locations, grantedScopes: scopes, correlationId: `commerce-${tenantId}`, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() }; }
async function run(runtime: NerveRuntime, agentKey: string, scopes: string[], nonce: string, input = {}) { const invocation: AgentInvocation = { agentKey, triggerType: "USER", input, context: context("commerce-a", ["branch-1"], scopes) }; return runtime.execute(signEnvelope(invocation, key, { nonce })); }
const unavailableModel: ModelProvider = { async generate() { throw new Error("provider unavailable"); } };
