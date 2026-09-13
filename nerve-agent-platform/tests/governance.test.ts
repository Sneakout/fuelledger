import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentSdkError,
  ApprovalService,
  CONTRACT_VERSION,
  FUELNERVE_APPLICATION_ID,
  FileGovernanceStore,
  ProposalService,
  evidenceHash,
  factHash,
  payloadHash,
  snapshotFromFinding,
  type AgentFinding,
  type ExecutionContext,
  type GovernanceStore,
  type JsonObject,
  type ProposalType,
} from "../src/index.ts";

test("persistent finding inbox and proposals survive store restart", async t => {
  const fixture = await setupStore(t);
  await fixture.proposals.saveFinding(finding());
  const proposal = await fixture.proposals.create(proposalInput("CUSTOMER_REMINDER_DRAFT"));
  const restarted = new FileGovernanceStore(fixture.file);
  assert.equal((await restarted.listFindings("org-a")).length, 1);
  assert.equal((await restarted.listProposals("org-a"))[0]?.proposalId, proposal.proposalId);
  assert.equal((await restarted.listFindings("org-b")).length, 0);
  const onDisk = JSON.parse(await readFile(fixture.file, "utf8")) as { findings: unknown[] };
  assert.equal(onDisk.findings.length, 1);
});

test("all five proposal types are non-operational and separate prose from hashed parameters", async t => {
  const fixture = await setupStore(t);
  await fixture.proposals.saveFinding(finding());
  const types: ProposalType[] = ["CUSTOMER_REMINDER_DRAFT", "INVENTORY_ADJUSTMENT_REQUEST", "INVOICE_CORRECTION_REVIEW", "SHIFT_VARIANCE_REVIEW", "SUPPLIER_FOLLOW_UP"];
  for (const type of types) {
    const proposal = await fixture.proposals.create(proposalInput(type, { recordId: "source-1", amount: 10 }, `AI explanation for ${type}`));
    assert.equal(proposal.status, "DRAFT");
    assert.equal(proposal.payloadHash, payloadHash({ recordId: "source-1", amount: 10 }));
    assert.doesNotMatch(proposal.payloadHash, /AI explanation/);
  }
  assert.equal((await fixture.store.listApprovals("org-a")).length, 0);
});

test("owner can approve a single-approval proposal and prepare only a source-revalidated envelope", async t => {
  const fixture = await approvedFixture(t, "SHIFT_VARIANCE_REVIEW");
  const approval = await fixture.approvals.decide({ context: actor("owner-1", ["OWNER"]), approvalId: fixture.approval.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot });
  assert.equal(approval.status, "APPROVED");
  let sourceChecks = 0;
  const envelope = await fixture.approvals.prepareExecution({
    context: actor("owner-1", ["OWNER"]), approvalId: approval.approvalId, currentSnapshot: fixture.snapshot,
    sourceRevalidator: async () => { sourceChecks += 1; return { valid: true }; },
  });
  assert.equal(sourceChecks, 1);
  assert.equal(envelope.payloadHash, fixture.proposal.payloadHash);
  assert.equal(envelope.evidenceHash, fixture.proposal.evidenceHash);
  assert.equal(envelope.targetToolId, "follow-ups.internal.create");
});

test("owner can reject an eligible proposal", async t => {
  const fixture = await approvedFixture(t, "SUPPLIER_FOLLOW_UP");
  const approval = await fixture.approvals.decide({ context: actor("owner-1", ["OWNER"]), approvalId: fixture.approval.approvalId, decision: "REJECT", reason: "Already handled", currentSnapshot: fixture.snapshot });
  assert.equal(approval.status, "REJECTED");
  assert.equal((await fixture.store.getProposal("org-a", fixture.proposal.proposalId))?.status, "REJECTED");
  await assert.rejects(() => fixture.approvals.prepareExecution({ context: actor("owner-1", ["OWNER"]), approvalId: approval.approvalId, currentSnapshot: fixture.snapshot, sourceRevalidator: async () => ({ valid: true }) }), (error: unknown) => error instanceof AgentSdkError && error.code === "APPROVAL_REQUIRED");
});

test("approval and execution preparation require explicit trusted scopes", async t => {
  const fixture = await approvedFixture(t, "SHIFT_VARIANCE_REVIEW");
  const unscoped = { ...actor("owner-1", ["OWNER"]), grantedScopes: [] };
  await assert.rejects(
    () => fixture.approvals.decide({ context: unscoped, approvalId: fixture.approval.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot }),
    (error: unknown) => error instanceof AgentSdkError && error.code === "SCOPE_DENIED",
  );
});

test("high-risk inventory and invoice proposals require distinct owner and accountant approvals", async t => {
  for (const proposalType of ["INVENTORY_ADJUSTMENT_REQUEST", "INVOICE_CORRECTION_REVIEW"] as const) {
    const fixture = await approvedFixture(t, proposalType, `finding-${proposalType}`);
    const first = await fixture.approvals.decide({ context: actor(`owner-${proposalType}`, ["OWNER"]), approvalId: fixture.approval.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot });
    assert.equal(first.status, "PENDING");
    await assert.rejects(() => fixture.approvals.prepareExecution({ context: actor(`owner-${proposalType}`, ["OWNER"]), approvalId: first.approvalId, currentSnapshot: fixture.snapshot, sourceRevalidator: async () => ({ valid: true }) }), (error: unknown) => error instanceof AgentSdkError && error.code === "APPROVAL_REQUIRED");
    const second = await fixture.approvals.decide({ context: actor(`accountant-${proposalType}`, ["ACCOUNTANT"]), approvalId: first.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot });
    assert.equal(second.status, "APPROVED");
    assert.equal(new Set(second.decisions.map(row => row.actorId)).size, 2);
  }
});

test("changed evidence marks proposal and approval stale before execution", async t => {
  const fixture = await approvedFixture(t, "SHIFT_VARIANCE_REVIEW");
  const approved = await fixture.approvals.decide({ context: actor("owner-1", ["OWNER"]), approvalId: fixture.approval.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot });
  const changed = { ...fixture.snapshot, evidence: fixture.snapshot.evidence.map(item => ({ ...item, version: "changed-version" })) };
  await assert.rejects(() => fixture.approvals.prepareExecution({ context: actor("owner-1", ["OWNER"]), approvalId: approved.approvalId, currentSnapshot: changed, sourceRevalidator: async () => ({ valid: true }) }), AgentSdkError);
  assert.equal((await fixture.store.getProposal("org-a", fixture.proposal.proposalId))?.status, "STALE");
  assert.equal((await fixture.store.getApproval("org-a", approved.approvalId))?.status, "STALE");
  assert.ok((await fixture.store.auditHistory("org-a", fixture.proposal.proposalId)).some(event => event.type === "PROPOSAL_MARKED_STALE"));
});

test("altered executable payload cannot prepare for execution", async t => {
  const fixture = await approvedFixture(t, "SHIFT_VARIANCE_REVIEW");
  const approved = await fixture.approvals.decide({ context: actor("owner-1", ["OWNER"]), approvalId: fixture.approval.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot });
  const stored = (await fixture.store.getProposal("org-a", fixture.proposal.proposalId))!;
  stored.payload = { ...stored.payload, amount: 999 };
  await fixture.store.updateProposal(stored);
  await assert.rejects(() => fixture.approvals.prepareExecution({ context: actor("owner-1", ["OWNER"]), approvalId: approved.approvalId, currentSnapshot: fixture.snapshot, sourceRevalidator: async () => ({ valid: true }) }), AgentSdkError);
  assert.equal((await fixture.store.getProposal("org-a", stored.proposalId))?.status, "STALE");
});

test("expired proposals and approvals cannot proceed", async t => {
  const fixture = await approvedFixture(t, "SHIFT_VARIANCE_REVIEW");
  const expired = await fixture.proposals.expire("org-a", new Date(Date.now() + 25 * 60 * 60_000));
  assert.equal(expired, 1);
  assert.equal((await fixture.store.getProposal("org-a", fixture.proposal.proposalId))?.status, "EXPIRED");
  assert.equal((await fixture.store.getApproval("org-a", fixture.approval.approvalId))?.status, "EXPIRED");
});

test("source-application rejection prevents preparation and is audited", async t => {
  const fixture = await approvedFixture(t, "SHIFT_VARIANCE_REVIEW");
  const approved = await fixture.approvals.decide({ context: actor("owner-1", ["OWNER"]), approvalId: fixture.approval.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot });
  await assert.rejects(() => fixture.approvals.prepareExecution({ context: actor("owner-1", ["OWNER"]), approvalId: approved.approvalId, currentSnapshot: fixture.snapshot, sourceRevalidator: async () => ({ valid: false, reason: "Shift already changed." }) }), AgentSdkError);
  assert.ok((await fixture.store.auditHistory("org-a", fixture.proposal.proposalId)).some(event => event.type === "SOURCE_REVALIDATION_FAILED"));
});

test("approval audit history records the complete successful lifecycle", async t => {
  const fixture = await approvedFixture(t, "SHIFT_VARIANCE_REVIEW");
  const approved = await fixture.approvals.decide({ context: actor("owner-1", ["OWNER"]), approvalId: fixture.approval.approvalId, decision: "APPROVE", currentSnapshot: fixture.snapshot });
  await fixture.approvals.prepareExecution({ context: actor("owner-1", ["OWNER"]), approvalId: approved.approvalId, currentSnapshot: fixture.snapshot, sourceRevalidator: async () => ({ valid: true }) });
  assert.deepEqual((await fixture.store.auditHistory("org-a", fixture.proposal.proposalId)).map(event => event.type), ["PROPOSAL_CREATED", "APPROVAL_REQUESTED", "APPROVAL_GRANTED", "EXECUTION_PREPARED"]);
});

async function approvedFixture(t: TestContext, proposalType: ProposalType, findingId = "finding-1") {
  const base = await setupStore(t);
  const row = finding(findingId); await base.proposals.saveFinding(row);
  const proposal = await base.proposals.create(proposalInput(proposalType, { recordId: "source-1", amount: 10 }, "Review this application-owned record.", findingId));
  const approval = await base.approvals.request("org-a", proposal.proposalId);
  return { ...base, proposal, approval, snapshot: snapshotFromFinding(row) };
}

async function setupStore(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "nerve-governance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "governance.json");
  const store: GovernanceStore = new FileGovernanceStore(file);
  return { file, store, proposals: new ProposalService(store), approvals: new ApprovalService(store) };
}

function finding(findingId = "finding-1"): AgentFinding {
  return {
    findingId, runId: "run-1", agentKey: "inventory-watch", agentVersion: "1.0.0", tenantId: "org-a", locationIds: ["station-a1"],
    type: "PHYSICAL_BOOK_VARIANCE", severity: "ATTENTION", title: "Stock differs", summary: "Review the recorded variance.", factIds: ["fact-1"],
    evidence: [{ evidenceId: `evidence-${findingId}`, evidenceType: "INVENTORY_SNAPSHOT", applicationId: FUELNERVE_APPLICATION_ID, tenantId: "org-a", resourceId: "tank-1", label: "Tank timeline", version: "v1", observedAt: "2026-09-07T10:00:00.000Z" }],
    detectedAt: "2026-09-07T10:00:00.000Z", deduplicationKey: `inventory-watch:org-a:${findingId}`,
  };
}

function proposalInput(proposalType: ProposalType, executablePayload: JsonObject = { recordId: "source-1" }, explanation = "Review this record.", findingId = "finding-1") {
  return { tenantId: "org-a", findingId, proposalType, executablePayload, explanation, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() };
}

function actor(actorId: string, roles: string[]): ExecutionContext {
  const now = new Date();
  return { contractVersion: CONTRACT_VERSION, applicationId: FUELNERVE_APPLICATION_ID, environment: "development", tenantId: "org-a", actorId, roles, permittedLocationIds: ["station-a1"], grantedScopes: ["proposal:approve", "proposal:prepare-execution"], correlationId: `correlation-${actorId}`, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() };
}
