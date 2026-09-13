import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AgentRegistry,
  AgentSdkError,
  CONTRACT_VERSION,
  InMemoryAuditStore,
  InMemoryNonceStore,
  InMemoryUsageStore,
  NerveRuntime,
  StaticModelProvider,
  TenantUsageLimiter,
  ToolRegistry,
  agentNarrativeSchema,
  createMockApplication,
  createMockContext,
  hashedSafetyIdentifier,
  jsonObject,
  mockSigningKey,
  signEnvelope,
  type AgentDefinition,
  type AgentInvocation,
  type AgentNarrative,
  type FactPacket,
  type JsonObject,
  type ModelProvider,
  type SignedEnvelope,
  type ToolResult,
} from "../src/index.ts";

const validNarrative: AgentNarrative = {
  headline: "Inventory is healthy",
  summary: "The application-reported position has supporting evidence.",
  claims: [{ claimId: "claim-1", text: "The inventory position is healthy.", factIds: ["inventory-position"], evidenceIds: ["evidence-stock-1"] }],
};

test("runtime executes a read-only agent with strict tools, grounded structured output, and full audit", async () => {
  const fixture = runtimeFixture(new StaticModelProvider(() => validNarrative));
  const response = await fixture.runtime.execute(signedInvocation());
  assert.equal(response.narrativeMode, "MODEL");
  assert.equal(response.run.status, "COMPLETED");
  assert.equal(response.facts[0]?.factId, "inventory-position");
  assert.equal(response.evidence[0]?.evidenceId, "evidence-stock-1");
  assert.equal(response.model?.model, "static-model");
  const stored = await fixture.audit.getRun(response.run.runId);
  assert.equal(stored?.status, "COMPLETED");
  assert.deepEqual((await fixture.audit.events(response.run.runId)).map(event => event.type), ["RUN_STARTED", "TOOL_STARTED", "TOOL_COMPLETED", "MODEL_STARTED", "MODEL_COMPLETED", "RUN_COMPLETED"]);
  assert.deepEqual(await fixture.usage.current("tenant-alpha"), { runs: 1, toolCalls: 1, inputTokens: 10, outputTokens: 10 });
});

test("runtime falls back deterministically when model output is not grounded", async () => {
  const ungrounded = { ...validNarrative, claims: [{ ...validNarrative.claims[0]!, evidenceIds: ["invented-evidence"] }] };
  const fixture = runtimeFixture(new StaticModelProvider(() => ungrounded));
  const response = await fixture.runtime.execute(signedInvocation());
  assert.equal(response.narrativeMode, "DETERMINISTIC_FALLBACK");
  assert.equal(response.model, undefined);
  assert.ok((await fixture.audit.events(response.run.runId)).some(event => event.type === "FALLBACK_USED"));
  assert.equal(response.measurement?.fallbackUsed, true);
  assert.equal(response.measurement?.fallbackReason, "Error");
  assert.equal(response.facts[0]?.factId, "inventory-position");
});

test("runtime times out the model and preserves deterministic findings with run measurements", async () => {
  const slowModel: ModelProvider = { generate: request => new Promise((resolve, reject) => { request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }); setTimeout(() => resolve({ output: validNarrative, provider: "slow", model: "slow", usage: { inputTokens: 1, outputTokens: 1 } }), 100); }) };
  const fixture = runtimeFixture(slowModel, { modelTimeoutMs: 5 });
  const response = await fixture.runtime.execute(signedInvocation());
  assert.equal(response.narrativeMode, "DETERMINISTIC_FALLBACK");
  assert.equal(response.facts[0]?.factId, "inventory-position");
  assert.equal(response.measurement?.fallbackUsed, true);
  assert.ok((response.measurement?.modelDurationMs ?? 0) >= 1);
  assert.ok((response.measurement?.durationMs ?? 0) >= (response.measurement?.modelDurationMs ?? 0));
});

test("runtime denies a tool outside the agent allow-list and audits failure", async () => {
  const fixture = runtimeFixture(new StaticModelProvider(() => validNarrative), { plannedToolId: "profit.summary.read" });
  await assert.rejects(() => fixture.runtime.execute(signedInvocation()), (error: unknown) => error instanceof AgentSdkError && error.code === "TOOL_NOT_REGISTERED");
  const failed = fixture.audit.latestRun();
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.error?.code, "TOOL_NOT_REGISTERED");
});

test("runtime enforces per-tenant run limits", async () => {
  const fixture = runtimeFixture(new StaticModelProvider(() => validNarrative), { maxRuns: 1 });
  await fixture.runtime.execute(signedInvocation());
  await assert.rejects(() => fixture.runtime.execute(signedInvocation()), (error: unknown) => error instanceof AgentSdkError && error.code === "USAGE_LIMIT_EXCEEDED");
});

test("runtime records cancellation as a failed audited run", async () => {
  const fixture = runtimeFixture(new StaticModelProvider(() => validNarrative));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => fixture.runtime.execute(signedInvocation(), { signal: controller.signal }), (error: unknown) => error instanceof AgentSdkError && error.code === "EXECUTION_CANCELLED");
  assert.equal(fixture.audit.latestRun()?.error?.code, "EXECUTION_CANCELLED");
});

test("tool registry enforces execution timeout and propagates cancellation signal", async () => {
  const registry = new ToolRegistry({ applicationId: "mock-business-app" });
  registry.register({
    definition: { toolId: "slow.read", contractVersion: CONTRACT_VERSION, description: "Slow read.", actionClass: "OBSERVE", riskLevel: "R0", requiredScopes: [], requiresApproval: false, idempotent: false, timeoutMs: 5, inputSchemaId: "object", outputSchemaId: "object" },
    validateInput: jsonObject, validateOutput: jsonObject,
    handler: async () => new Promise<{ output: JsonObject; evidence: [] }>(resolve => setTimeout(() => resolve({ output: {}, evidence: [] }), 100)),
  });
  await assert.rejects(() => registry.execute({ requestId: "slow-1", toolId: "slow.read", contractVersion: CONTRACT_VERSION, context: createMockContext({ grantedScopes: [] }), input: {} }), (error: unknown) => error instanceof AgentSdkError && error.code === "EXECUTION_TIMEOUT");
});

test("tenant output-token budget is checked before tools or model execute", async () => {
  const app = createMockApplication();
  const agents = new AgentRegistry(); agents.register(inventoryAgent());
  const audit = new InspectableAuditStore();
  const usage = new TenantUsageLimiter(new InMemoryUsageStore(), { maxRuns: 10, maxToolCalls: 10, maxInputTokens: 1000, maxOutputTokens: 50 });
  const runtime = new NerveRuntime({ agents, tools: app.registry, model: new StaticModelProvider(() => validNarrative), audit, usage, nonceStore: new InMemoryNonceStore(), resolveApplicationKey: () => mockSigningKey.secret, safetyIdentifierSalt: "runtime-test-safety-salt" });
  await assert.rejects(() => runtime.execute(signedInvocation()), (error: unknown) => error instanceof AgentSdkError && error.code === "USAGE_LIMIT_EXCEEDED");
  assert.equal(audit.latestRun()?.toolRequestIds.length, 0);
});

test("hashed safety identifiers are stable, scoped, and contain no source identifier", () => {
  const context = createMockContext();
  const first = hashedSafetyIdentifier(context, "a-production-salt-value");
  const second = hashedSafetyIdentifier(context, "a-production-salt-value");
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.equal(first.includes(context.actorId), false);
  assert.notEqual(first, hashedSafetyIdentifier({ ...context, tenantId: "tenant-beta" }, "a-production-salt-value"));
});

class InspectableAuditStore extends InMemoryAuditStore {
  private lastRunId?: string;
  override async createRun(run: Parameters<InMemoryAuditStore["createRun"]>[0]) { this.lastRunId = run.runId; await super.createRun(run); }
  latestRun() { return this.lastRunId ? this.getRunSync(this.lastRunId) : undefined; }
  private getRunSync(runId: string) {
    // Tests need synchronous inspection only after awaited runtime completion/failure.
    return this.snapshot.get(runId);
  }
  private readonly snapshot = new Map<string, Parameters<InMemoryAuditStore["createRun"]>[0]>();
  override async updateRun(run: Parameters<InMemoryAuditStore["updateRun"]>[0]) { this.snapshot.set(run.runId, structuredClone(run)); await super.updateRun(run); }
}

function runtimeFixture(model: ModelProvider, options: { plannedToolId?: string; maxRuns?: number; modelTimeoutMs?: number } = {}) {
  const app = createMockApplication();
  const agents = new AgentRegistry();
  agents.register(inventoryAgent(options.plannedToolId));
  const audit = new InspectableAuditStore();
  const usage = new TenantUsageLimiter(new InMemoryUsageStore(), { maxRuns: options.maxRuns ?? 10, maxToolCalls: 10, maxInputTokens: 1000, maxOutputTokens: 1000 });
  const runtime = new NerveRuntime({
    agents, tools: app.registry, model, audit, usage, nonceStore: new InMemoryNonceStore(),
    resolveApplicationKey: keyId => keyId === mockSigningKey.keyId ? mockSigningKey.secret : undefined,
    safetyIdentifierSalt: "runtime-test-safety-salt", modelTimeoutMs: options.modelTimeoutMs,
  });
  return { runtime, audit, usage };
}

function inventoryAgent(plannedToolId = "inventory.position.read"): AgentDefinition {
  const fallback = validNarrative;
  return {
    agentKey: "inventory-watch", agentVersion: "1.0.0", promptVersion: "inventory-watch.prompt@1",
    description: "Explains application-calculated inventory facts.", instructions: "Use only supplied facts and evidence.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: ["inventory.position.read"], maxToolCalls: 1, maxOutputTokens: 100,
    plan: (_input, context) => [{ toolId: plannedToolId, input: { locationIds: context.permittedLocationIds, asOf: new Date().toISOString() } }],
    buildFacts: (results: ToolResult[]): FactPacket => {
      const first = results[0]!;
      const output = first.output as { items: Array<{ status: string }> };
      return { facts: [{ factId: "inventory-position", label: "Inventory position", value: output.items[0]?.status ?? "UNKNOWN", evidenceIds: first.evidence.map(item => item.evidenceId) }], evidence: first.evidence };
    },
    validateOutput: agentNarrativeSchema,
    deterministicFallback: () => fallback,
  };
}

function signedInvocation(): SignedEnvelope<AgentInvocation> {
  return signEnvelope({ agentKey: "inventory-watch", agentVersion: "1.0.0", context: createMockContext({ correlationId: randomUUID() }), input: {}, triggerType: "USER" }, mockSigningKey, { nonce: randomUUID() });
}
