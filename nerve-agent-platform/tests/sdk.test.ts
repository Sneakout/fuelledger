import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AgentSdkError,
  CONTRACT_VERSION,
  InMemoryNonceStore,
  NerveClient,
  ToolRegistry,
  createMockApplication,
  createMockContext,
  jsonObject,
  mockSigningKey,
  signEnvelope,
  verifyEnvelope,
  type SignedEnvelope,
  type ToolRequest,
} from "../src/index.ts";

test("mock application registers a versioned tool and returns validated evidence", async () => {
  const app = createMockApplication();
  assert.equal(app.registry.definitions()[0]?.toolId, "inventory.position.read");
  const client = new NerveClient(mockSigningKey, app.receive);
  const result = await client.call({ context: createMockContext(), toolId: "inventory.position.read", payload: { locationIds: ["location-1"], asOf: new Date().toISOString() } });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.evidence[0]?.tenantId, "tenant-alpha");
  assert.equal(result.evidence[0]?.evidenceId, "evidence-stock-1");
});

test("signed request verification rejects tampering", async () => {
  const request = requestFixture();
  const envelope = signEnvelope(request, mockSigningKey, { nonce: randomUUID() });
  const tampered = { ...envelope, payload: { ...envelope.payload, toolId: "profit.summary.read" } };
  await assert.rejects(() => verifyEnvelope(tampered, () => mockSigningKey.secret, new InMemoryNonceStore()), (error: unknown) => error instanceof AgentSdkError && error.code === "SIGNATURE_INVALID");
});

test("signed request nonce cannot be replayed", async () => {
  const store = new InMemoryNonceStore();
  const envelope = signEnvelope(requestFixture(), mockSigningKey, { nonce: "one-use-nonce" });
  await verifyEnvelope(envelope, () => mockSigningKey.secret, store);
  await assert.rejects(() => verifyEnvelope(envelope, () => mockSigningKey.secret, store), (error: unknown) => error instanceof AgentSdkError && error.code === "REPLAY_DETECTED");
});

test("registry rejects missing scope and denied location", async () => {
  const app = createMockApplication();
  const missingScope = requestFixture({ context: createMockContext({ grantedScopes: [] }) });
  await assert.rejects(() => app.registry.execute(missingScope), (error: unknown) => error instanceof AgentSdkError && error.code === "SCOPE_DENIED");
  const deniedLocation = requestFixture({ input: { locationIds: ["location-2"], asOf: new Date().toISOString() } });
  await assert.rejects(() => app.registry.execute(deniedLocation), (error: unknown) => error instanceof AgentSdkError && error.code === "LOCATION_DENIED");
});

test("registry rejects expired context and unsupported major contract", async () => {
  const app = createMockApplication();
  const expired = requestFixture({ context: createMockContext({ expiresAt: new Date(Date.now() - 1_000).toISOString() }) });
  await assert.rejects(() => app.registry.execute(expired), (error: unknown) => error instanceof AgentSdkError && error.code === "CONTEXT_EXPIRED");
  const unsupported = requestFixture({ contractVersion: "2.0" });
  await assert.rejects(() => app.registry.execute(unsupported), (error: unknown) => error instanceof AgentSdkError && error.code === "CONTRACT_VERSION_UNSUPPORTED");
});

test("registry rejects evidence from another tenant", async () => {
  const registry = new ToolRegistry({ applicationId: "mock-business-app" });
  registry.register({
    definition: { toolId: "bad.evidence.read", contractVersion: CONTRACT_VERSION, description: "Test invalid evidence.", actionClass: "OBSERVE", riskLevel: "R0", requiredScopes: [], requiresApproval: false, idempotent: false, timeoutMs: 1000, inputSchemaId: "object", outputSchemaId: "object" },
    validateInput: jsonObject,
    validateOutput: jsonObject,
    handler: async request => ({ output: {}, evidence: [{ evidenceId: "bad", evidenceType: "TEST", applicationId: request.context.applicationId, tenantId: "tenant-beta", resourceId: "resource", label: "Bad evidence" }] }),
  });
  await assert.rejects(() => registry.execute(requestFixture({ toolId: "bad.evidence.read", input: {} })), (error: unknown) => error instanceof AgentSdkError && error.code === "EVIDENCE_INVALID");
});

test("idempotent execution replays identical result and rejects changed payload", async () => {
  let calls = 0;
  const registry = new ToolRegistry({ applicationId: "mock-business-app" });
  registry.register({
    definition: { toolId: "proposal.create", contractVersion: CONTRACT_VERSION, description: "Create a proposal.", actionClass: "PROPOSE", riskLevel: "R2", requiredScopes: ["proposal:create"], requiresApproval: false, idempotent: true, timeoutMs: 1000, inputSchemaId: "object", outputSchemaId: "object" },
    validateInput: jsonObject, validateOutput: jsonObject,
    handler: async request => { calls += 1; return { output: { proposalId: `proposal-${calls}`, title: request.input.title ?? null }, evidence: [] }; },
  });
  const context = createMockContext({ grantedScopes: ["proposal:create"] });
  const base = requestFixture({ toolId: "proposal.create", context, input: { title: "Review" }, idempotencyKey: "1234567890abcdef" });
  const first = await registry.execute(base);
  const replay = await registry.execute({ ...base, requestId: "request-retry" });
  assert.deepEqual(replay.output, first.output);
  assert.equal(calls, 1);
  await assert.rejects(() => registry.execute({ ...base, input: { title: "Changed" } }), (error: unknown) => error instanceof AgentSdkError && error.code === "IDEMPOTENCY_CONFLICT");
});

test("prohibited tools cannot be registered", () => {
  const registry = new ToolRegistry({ applicationId: "mock-business-app" });
  assert.throws(() => registry.register({
    definition: { toolId: "database.sql.execute", contractVersion: CONTRACT_VERSION, description: "Forbidden.", actionClass: "PROHIBITED", riskLevel: "R4", requiredScopes: [], requiresApproval: true, idempotent: true, timeoutMs: 1000, inputSchemaId: "object", outputSchemaId: "object" },
    validateInput: jsonObject, validateOutput: jsonObject, handler: async () => ({ output: {}, evidence: [] }),
  }), (error: unknown) => error instanceof AgentSdkError && error.code === "TOOL_PROHIBITED");
});

function requestFixture(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    requestId: "request-1", toolId: "inventory.position.read", contractVersion: CONTRACT_VERSION,
    context: createMockContext(), input: { locationIds: ["location-1"], asOf: new Date().toISOString() }, ...overrides,
  };
}
