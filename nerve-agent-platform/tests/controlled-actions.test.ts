import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentSdkError,
  ApprovalService,
  CONTRACT_VERSION,
  ControlledActionService,
  FUELNERVE_APPLICATION_ID,
  FileGovernanceStore,
  FuelNerveControlledActionAdapter,
  InMemoryExecutionReceiptStore,
  ProposalService,
  snapshotFromFinding,
  type AgentFinding,
  type ApprovedActionEnvelope,
  type ControlledActionId,
  type ExecutionContext,
  type GovernanceStore,
  type JsonObject,
  type SourceActionExecutor,
  type SourceActionResult,
} from "../src/index.ts";

test("low-risk application action still requires trusted scope and source checks", async t => {
  const setup = await fixture(t);
  const receipt = await setup.actions.execute({ context: actor(["alert:acknowledge"]), actionId: "alerts.acknowledge.execute", payload: { alertId: "alert-1" }, idempotencyKey: "key-1" });
  assert.equal(receipt.status, "SUCCEEDED");
  assert.equal(setup.source.calls, 1);
  await assert.rejects(() => setup.actions.execute({ context: actor([]), actionId: "alerts.acknowledge.execute", payload: { alertId: "alert-2" }, idempotencyKey: "key-2" }), (error: unknown) => error instanceof AgentSdkError && error.code === "SCOPE_DENIED");
});

test("approved action executes once and identical retry replays its receipt", async t => {
  const setup = await fixture(t);
  const approved = await approvedEnvelope(setup, "CUSTOMER_REMINDER_DRAFT", { customerId: "customer-1", body: "Please review your balance." });
  const request = { context: actor(["reminder-draft:write"]), actionId: "communications.reminder-draft.save" as const, payload: approved.payload, idempotencyKey: "same-key", approvedAction: approved };
  const first = await setup.actions.execute(request);
  const replay = await setup.actions.execute(request);
  assert.equal(first.executionId, replay.executionId);
  assert.equal(setup.source.calls, 1);
  assert.equal((await setup.store.getApproval("org-a", approved.approvalId))?.status, "CONSUMED");
});

test("same idempotency key cannot execute a changed payload", async t => {
  const setup = await fixture(t);
  await setup.actions.execute({ context: actor(["alert:acknowledge"]), actionId: "alerts.acknowledge.execute", payload: { alertId: "alert-1" }, idempotencyKey: "same-key" });
  await assert.rejects(() => setup.actions.execute({ context: actor(["alert:acknowledge"]), actionId: "alerts.acknowledge.execute", payload: { alertId: "alert-2" }, idempotencyKey: "same-key" }), (error: unknown) => error instanceof AgentSdkError && error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(setup.source.calls, 1);
});

test("tampered approved payload is rejected before the source application", async t => {
  const setup = await fixture(t);
  const approved = await approvedEnvelope(setup, "INVENTORY_ADJUSTMENT_REQUEST", { stationId: "station-a1", productId: "product-1", quantityDelta: 10 });
  await assert.rejects(() => setup.actions.execute({ context: actor(["inventory-adjustment:submit"]), actionId: "inventory.adjustment.submit", payload: { ...approved.payload, quantityDelta: 999 }, idempotencyKey: "key-1", approvedAction: approved }), (error: unknown) => error instanceof AgentSdkError && error.code === "APPROVAL_REQUIRED");
  assert.equal(setup.source.calls, 0);
});

test("missing source invariant attestation rejects action and is visible in audit", async t => {
  const setup = await fixture(t, { status: "SUCCEEDED", sourceCommandId: "should-not-count", checks: { finalAuthorization: true, factsReloaded: true, ledgerInvariants: true, journalInvariants: false } });
  const approved = await approvedEnvelope(setup, "INVENTORY_ADJUSTMENT_REQUEST", { stationId: "station-a1", productId: "product-1", quantityDelta: 10 });
  approved.targetToolId = "inventory.adjustment.apply";
  const proposal = (await setup.store.getProposal("org-a", approved.proposalId))!; proposal.targetToolId = approved.targetToolId; await setup.store.updateProposal(proposal);
  const receipt = await setup.actions.execute({ context: actor(["inventory-adjustment:apply"]), actionId: "inventory.adjustment.apply", payload: approved.payload, idempotencyKey: "key-1", approvedAction: approved });
  assert.equal(receipt.status, "REJECTED");
  assert.match(receipt.error?.message ?? "", /JOURNAL_INVARIANTS/);
  assert.ok((await setup.store.auditHistory("org-a", approved.proposalId)).some(event => event.type === "EXECUTION_REJECTED"));
});

test("uncertain source outcome is persisted and never automatically retried", async t => {
  const setup = await fixture(t, new Error("connection dropped after dispatch"));
  const receipt = await setup.actions.execute({ context: actor(["finding:review"]), actionId: "findings.review.execute", payload: { findingId: "finding-1" }, idempotencyKey: "key-unknown" });
  assert.equal(receipt.status, "UNKNOWN");
  assert.equal(receipt.result, undefined);
  const replay = await setup.actions.execute({ context: actor(["finding:review"]), actionId: "findings.review.execute", payload: { findingId: "finding-1" }, idempotencyKey: "key-unknown" });
  assert.equal(replay.executionId, receipt.executionId);
  assert.equal(setup.source.calls, 1);
});

test("charter-prohibited actions cannot reach an application handler", async t => {
  const setup = await fixture(t);
  await assert.rejects(() => setup.actions.execute({ context: actor(["anything"]), actionId: "accounting.journal-lines.modify" as ControlledActionId, payload: {}, idempotencyKey: "key-1" }), (error: unknown) => error instanceof AgentSdkError && error.code === "TOOL_PROHIBITED");
  assert.equal(setup.source.calls, 0);
});

test("FuelNerve adapter authorizes, reloads, validates, then calls its domain handler", async () => {
  const order: string[] = [];
  const adapter = new FuelNerveControlledActionAdapter({
    authorize: async () => { order.push("authorize"); return true; },
    reloadFacts: async () => { order.push("reload"); return { currentStock: 100 }; },
    validateLedger: async () => { order.push("ledger"); return true; },
    validateJournal: async () => { order.push("journal"); return true; },
    validateMessagePolicy: async () => true,
    handlers: { "inventory.adjustment.apply": async () => { order.push("domain-handler"); return { sourceCommandId: "ledger-entry-1" }; } },
  });
  const result = await adapter.execute(sourceRequest("inventory.adjustment.apply"));
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(order, ["authorize", "reload", "ledger", "journal", "domain-handler"]);
});

test("FuelNerve adapter fails closed when authorization or a domain handler is absent", async () => {
  let reloaded = false;
  const denied = new FuelNerveControlledActionAdapter({ authorize: async () => false, reloadFacts: async () => { reloaded = true; return {}; }, validateLedger: async () => true, validateJournal: async () => true, validateMessagePolicy: async () => true, handlers: {} });
  assert.equal((await denied.execute(sourceRequest("alerts.acknowledge.execute"))).status, "REJECTED");
  assert.equal(reloaded, false);
  const unavailable = new FuelNerveControlledActionAdapter({ authorize: async () => true, reloadFacts: async () => ({}), validateLedger: async () => true, validateJournal: async () => true, validateMessagePolicy: async () => true, handlers: {} });
  assert.equal((await unavailable.execute(sourceRequest("alerts.acknowledge.execute"))).status, "REJECTED");
});

class FakeSource implements SourceActionExecutor {
  applicationId = FUELNERVE_APPLICATION_ID;
  calls = 0;
  private readonly response: SourceActionResult | Error;
  constructor(response: SourceActionResult | Error = { status: "SUCCEEDED", sourceCommandId: "source-command-1", result: { saved: true }, checks: { finalAuthorization: true, factsReloaded: true, ledgerInvariants: true, journalInvariants: true, explicitMessagePolicy: true } }) { this.response = response; }
  async execute() { this.calls += 1; if (this.response instanceof Error) throw this.response; return this.response; }
}

async function fixture(t: TestContext, response?: SourceActionResult | Error) {
  const directory = await mkdtemp(join(tmpdir(), "nerve-actions-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const store: GovernanceStore = new FileGovernanceStore(join(directory, "governance.json"));
  const source = new FakeSource(response);
  return { store, source, proposals: new ProposalService(store), approvals: new ApprovalService(store), actions: new ControlledActionService({ governance: store, receipts: new InMemoryExecutionReceiptStore(), source }) };
}

async function approvedEnvelope(setup: Awaited<ReturnType<typeof fixture>>, proposalType: "CUSTOMER_REMINDER_DRAFT" | "INVENTORY_ADJUSTMENT_REQUEST", payload: JsonObject): Promise<ApprovedActionEnvelope> {
  const row = finding(); await setup.proposals.saveFinding(row);
  const proposal = await setup.proposals.create({ tenantId: "org-a", findingId: row.findingId, proposalType, executablePayload: payload, explanation: "Review this action.", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const request = await setup.approvals.request("org-a", proposal.proposalId);
  let approval = await setup.approvals.decide({ context: actor(["proposal:approve", "proposal:prepare-execution"], "owner-1", ["OWNER"]), approvalId: request.approvalId, decision: "APPROVE", currentSnapshot: snapshotFromFinding(row) });
  if (approval.status === "PENDING") approval = await setup.approvals.decide({ context: actor(["proposal:approve", "proposal:prepare-execution"], "accountant-1", ["ACCOUNTANT"]), approvalId: request.approvalId, decision: "APPROVE", currentSnapshot: snapshotFromFinding(row) });
  return setup.approvals.prepareExecution({ context: actor(["proposal:approve", "proposal:prepare-execution"]), approvalId: approval.approvalId, currentSnapshot: snapshotFromFinding(row), sourceRevalidator: async () => ({ valid: true }) });
}

function finding(): AgentFinding {
  return { findingId: "finding-1", runId: "run-1", agentKey: "stock-watch", agentVersion: "1", tenantId: "org-a", locationIds: ["station-a1"], type: "VARIANCE", severity: "ATTENTION", title: "Review", summary: "Review", factIds: ["fact-1"], evidence: [{ evidenceId: "evidence-1", evidenceType: "INVENTORY", applicationId: FUELNERVE_APPLICATION_ID, tenantId: "org-a", resourceId: "tank-1", label: "Tank", version: "v1" }], detectedAt: new Date().toISOString(), deduplicationKey: "finding-1" };
}

function actor(scopes: string[], actorId = "owner-1", roles = ["OWNER"]): ExecutionContext {
  const now = new Date(); return { contractVersion: CONTRACT_VERSION, applicationId: FUELNERVE_APPLICATION_ID, environment: "development", tenantId: "org-a", actorId, roles, permittedLocationIds: ["station-a1"], grantedScopes: scopes, correlationId: `correlation-${actorId}`, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() };
}

function sourceRequest(actionId: ControlledActionId) {
  return { context: actor(["test"]), actionId, payload: {}, idempotencyKey: "source-key", payloadHash: "payload-hash" };
}
