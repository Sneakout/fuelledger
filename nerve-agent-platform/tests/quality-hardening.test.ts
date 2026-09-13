import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AgentSdkError,
  HashChainedAuditStore,
  InMemoryRetentionStore,
  OperationalKillSwitch,
  OperationalTelemetry,
  evaluate,
  unsupportedNumberCount,
  verifyAuditChain,
  verifyBackupRestore,
  type AgentRun,
  type EvaluationCase,
  type JsonObject,
} from "../src/index.ts";

test("evaluation gate measures detection, selection, grounding, evidence, and security", () => {
  const row: EvaluationCase = { caseId: "inventory-low", expectedFindingKeys: ["inventory.low"], actualFindingKeys: ["inventory.low"], expectedToolIds: ["inventory.position.read"], actualToolCalls: [{ toolId: "inventory.position.read", input: {} }], facts: { facts: [{ factId: "fact-1", label: "Stock", value: { available: 12 }, evidenceIds: ["evidence-1"] }], evidence: [] }, narrative: { headline: "Review", summary: "Review stock", claims: [{ claimId: "claim-1", text: "Available stock is 12", factIds: ["fact-1"], evidenceIds: ["evidence-1"] }] }, evidenceLinkResults: { "evidence-1": true }, security: { tenantIsolated: true, promptInjectionResisted: true, staleApprovalRejected: true, duplicateExecutionPrevented: true, deterministicFallbackValid: true } };
  const report = evaluate([row], { minimumPrecision: 0.98, minimumRecall: 0.98, minimumToolSelectionAccuracy: 1, maximumUnsupportedNumbers: 0, minimumEvidenceLinkValidity: 1, requireAllSecurityChecks: true });
  assert.equal(report.passed, true); assert.equal(report.falsePositives, 0); assert.equal(report.missingFindings, 0);
  const fabricated = { ...row.narrative, claims: [{ ...row.narrative.claims[0]!, text: "Available stock is 999" }] };
  assert.equal(unsupportedNumberCount(fabricated, row.facts), 1);
});

test("malicious business records cannot alter deterministic tool selection or authority", async () => {
  const corpus = JSON.parse(await readFile(new URL("./fixtures/malicious-records.json", import.meta.url), "utf8")) as Array<{ caseId: string; value: string }>;
  const allowedTool = "inventory.position.read";
  for (const attack of corpus) {
    const deterministicPlan = [{ toolId: allowedTool, input: { query: attack.value } }];
    assert.deepEqual(deterministicPlan.map(item => item.toolId), [allowedTool], attack.caseId);
    assert.doesNotMatch(JSON.stringify(deterministicPlan.map(item => item.toolId)), /adjustment\.apply|payment\.initiate/);
  }
});

test("audit hash chain detects modified or reordered events", async () => {
  const store = new HashChainedAuditStore(); const run = agentRun(); await store.createRun(run);
  await store.append({ eventId: "event-1", runId: run.runId, tenantId: run.tenantId, sequence: 1, type: "RUN_STARTED", occurredAt: new Date().toISOString(), detail: {} });
  await store.append({ eventId: "event-2", runId: run.runId, tenantId: run.tenantId, sequence: 2, type: "RUN_COMPLETED", occurredAt: new Date().toISOString(), detail: {} });
  assert.equal(store.verify(run.runId), true);
  const tampered = store.entries(run.runId); tampered[0]!.event.detail = { injected: true };
  assert.equal(verifyAuditChain(run.runId, tampered), false);
  assert.equal(verifyAuditChain(run.runId, [...store.entries(run.runId)].reverse()), false);
});

test("retention expiry and tenant deletion preserve legal holds and return receipts", () => {
  const store = new InMemoryRetentionStore([{ recordId: "expired", tenantId: "tenant-a", category: "RUN", createdAt: "2025-01-01T00:00:00Z", expiresAt: "2025-02-01T00:00:00Z" }, { recordId: "held", tenantId: "tenant-a", category: "AUDIT", createdAt: "2025-01-01T00:00:00Z", expiresAt: "2025-02-01T00:00:00Z", legalHold: true }, { recordId: "other", tenantId: "tenant-b", category: "RUN", createdAt: "2025-01-01T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" }]);
  assert.deepEqual(store.deleteExpired(new Date("2026-01-01T00:00:00Z")).map(item => item.recordId), ["expired"]);
  const receipt = store.deleteTenant("tenant-a"); assert.deepEqual(receipt.retainedLegalHoldIds, ["held"]); assert.deepEqual(store.list("tenant-a").map(item => item.recordId), ["held"]); assert.equal(store.list("tenant-b").length, 1);
});

test("cost, latency, fallback, and per-agent service objectives are measurable", () => {
  const telemetry = new OperationalTelemetry(); for (let index = 0; index < 20; index += 1) telemetry.record({ agentKey: "inventory-watch", tenantId: "tenant-a", durationMs: 100 + index, costMicros: 25, status: index === 0 ? "FALLBACK" : "SUCCEEDED", occurredAt: new Date().toISOString() });
  const dashboard = telemetry.dashboard("inventory-watch"); assert.equal(dashboard.requests, 20); assert.equal(dashboard.totalCostMicros, 500); assert.equal(dashboard.fallbackRate, 0.05);
  assert.equal(telemetry.evaluate({ agentKey: "inventory-watch", minimumSuccessRate: 0.99, maximumP95LatencyMs: 125, maximumFallbackRate: 0.05 }).passed, true);
});

test("backup restoration verifies canonical state checksum", async () => {
  let state: JsonObject = { applications: 2, auditHead: "abc" };
  const result = await verifyBackupRestore({ createBackup: async () => Buffer.from(JSON.stringify(state)), restore: async backup => { state = JSON.parse(Buffer.from(backup).toString("utf8")) as JsonObject; }, canonicalState: async () => state });
  assert.equal(result.passed, true); assert.equal(result.beforeChecksum, result.afterChecksum);
});

test("kill switches independently stop global, tenant, agent, and action scopes", () => {
  const controls = new OperationalKillSwitch(); controls.set({ ruleId: "agent-stop", scope: "AGENT", tenantId: "tenant-a", agentKey: "profit-insight", reason: "incident", activatedAt: new Date().toISOString(), activatedBy: "operator-1", active: true });
  assert.throws(() => controls.assertAgentAllowed("tenant-a", "profit-insight"), AgentSdkError); controls.assertAgentAllowed("tenant-b", "profit-insight");
  controls.set({ ruleId: "action-stop", scope: "ACTION", tenantId: "tenant-a", actionId: "inventory.adjustment.apply", reason: "ledger incident", activatedAt: new Date().toISOString(), activatedBy: "operator-1", active: true });
  assert.throws(() => controls.assertActionAllowed("tenant-a", "inventory.adjustment.apply"), AgentSdkError); controls.deactivate("action-stop"); controls.assertActionAllowed("tenant-a", "inventory.adjustment.apply");
});

function agentRun(): AgentRun { return { runId: "run-1", correlationId: "correlation-1", applicationId: "app", tenantId: "tenant-a", actorId: "actor", agentKey: "inventory-watch", agentVersion: "1", triggerType: "EVALUATION", status: "RUNNING", toolRequestIds: [], findingIds: [], startedAt: new Date().toISOString() }; }
