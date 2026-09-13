import { createHash, randomUUID } from "node:crypto";
import type { ExecutionReceipt, JsonObject } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import type { ControlledActionDependencies, ControlledActionId, ControlledActionPolicy, ControlledActionRequest, SourceActionResult } from "./execution-contracts.ts";
import { controlledActionIds, prohibitedActionIds } from "./execution-contracts.ts";
import { governanceHash, payloadHash } from "./governance-hashing.ts";

export const controlledActionPolicies: ControlledActionPolicy[] = [
  { actionId: "findings.review.execute", riskLevel: "R1", requiredScope: "finding:review", requiresNerveApproval: false, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED"] },
  { actionId: "alerts.acknowledge.execute", riskLevel: "R1", requiredScope: "alert:acknowledge", requiresNerveApproval: false, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED"] },
  { actionId: "communications.reminder-draft.save", riskLevel: "R1", requiredScope: "reminder-draft:write", requiresNerveApproval: true, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED"] },
  { actionId: "follow-ups.internal.create", riskLevel: "R1", requiredScope: "follow-up:write", requiresNerveApproval: true, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED"] },
  { actionId: "communications.customer-reminder.send", riskLevel: "R3", requiredScope: "customer-reminder:send", requiresNerveApproval: true, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED", "EXPLICIT_MESSAGE_POLICY"] },
  { actionId: "inventory.adjustment.submit", riskLevel: "R2", requiredScope: "inventory-adjustment:submit", requiresNerveApproval: true, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED", "LEDGER_INVARIANTS"] },
  { actionId: "inventory.adjustment.apply", riskLevel: "R3", requiredScope: "inventory-adjustment:apply", requiresNerveApproval: true, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED", "LEDGER_INVARIANTS", "JOURNAL_INVARIANTS"] },
  { actionId: "purchases.invoice-correction.submit", riskLevel: "R2", requiredScope: "invoice-correction:submit", requiresNerveApproval: true, sourceChecks: ["FINAL_AUTHORIZATION", "FACTS_RELOADED", "JOURNAL_INVARIANTS"] },
];

export class ControlledActionService {
  private readonly dependencies: ControlledActionDependencies;
  private readonly policies: ControlledActionPolicy[];
  constructor(dependencies: ControlledActionDependencies, policies = controlledActionPolicies) { this.dependencies = dependencies; this.policies = policies; }

  async execute(request: ControlledActionRequest, options: { signal?: AbortSignal } = {}): Promise<ExecutionReceipt> {
    if ((prohibitedActionIds as readonly string[]).includes(request.actionId)) throw new AgentSdkError("TOOL_PROHIBITED", "This action is prohibited by the platform charter.");
    if (!(controlledActionIds as readonly string[]).includes(request.actionId)) throw new AgentSdkError("TOOL_NOT_REGISTERED", "Controlled action is not registered.");
    const policy = this.policies.find(item => item.actionId === request.actionId);
    if (!policy) throw new AgentSdkError("TOOL_NOT_REGISTERED", "Controlled action policy is missing.");
    this.validateContext(request, policy);
    this.dependencies.killSwitch?.assertActionAllowed(request.context.tenantId, request.actionId);

    const idempotencyKeyHash = sha256(request.idempotencyKey);
    const requestHash = governanceHash({ actionId: request.actionId, tenantId: request.context.tenantId, payload: request.payload, approvalId: request.approvedAction?.approvalId ?? null });
    const claim = await this.dependencies.receipts.claim(request.context.tenantId, request.actionId, idempotencyKeyHash, requestHash);
    if (claim.status === "REPLAY") return claim.receipt;
    if (claim.status === "CONFLICT") throw new AgentSdkError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different action payload.");
    if (claim.status === "IN_PROGRESS") throw new AgentSdkError("IDEMPOTENCY_CONFLICT", "This action is already in progress. Review its outcome before retrying.");
    await this.validateApproval(request, policy);

    await this.audit(request, "EXECUTION_STARTED", { actionId: request.actionId, idempotencyKeyHash });
    let sourceResult: SourceActionResult;
    try {
      sourceResult = await this.dependencies.source.execute({
        context: request.context, actionId: request.actionId, payload: structuredClone(request.payload), idempotencyKey: request.idempotencyKey,
        payloadHash: payloadHash(request.payload), ...(request.approvedAction ? { approvalId: request.approvedAction.approvalId, evidenceHash: request.approvedAction.evidenceHash } : {}),
      }, options.signal);
    } catch (error) {
      sourceResult = { status: "UNKNOWN", checks: { finalAuthorization: false, factsReloaded: false }, error: { code: "TOOL_FAILED", message: "The source application outcome is uncertain.", retryable: false, details: { reviewRequired: true } } };
    }
    const missingCheck = sourceResult.status === "SUCCEEDED" ? requiredCheckMissing(policy, sourceResult) : undefined;
    if (missingCheck) sourceResult = { status: "REJECTED", checks: sourceResult.checks, error: { code: "TOOL_FAILED", message: `Source application did not attest required check: ${missingCheck}.`, retryable: false } };
    const receipt: ExecutionReceipt = {
      executionId: randomUUID(), approvalId: request.approvedAction?.approvalId ?? "DIRECT_LOW_RISK_ACTION", applicationId: this.dependencies.source.applicationId,
      tenantId: request.context.tenantId, toolId: request.actionId, idempotencyKeyHash, status: sourceResult.status,
      ...(sourceResult.sourceCommandId ? { sourceCommandId: sourceResult.sourceCommandId } : {}), executedAt: new Date().toISOString(),
      ...(sourceResult.result ? { result: sourceResult.result } : {}), ...(sourceResult.error ? { error: sourceResult.error } : {}),
    };
    await this.dependencies.receipts.complete(request.context.tenantId, request.actionId, idempotencyKeyHash, receipt);
    if (request.approvedAction) {
      const approval = await this.dependencies.governance.getApproval(request.context.tenantId, request.approvedAction.approvalId);
      if (approval) { approval.status = "CONSUMED"; await this.dependencies.governance.updateApproval(approval); }
    }
    await this.audit(request, receipt.status === "UNKNOWN" ? "EXECUTION_UNCERTAIN" : receipt.status === "REJECTED" ? "EXECUTION_REJECTED" : "EXECUTION_COMPLETED", { actionId: request.actionId, executionId: receipt.executionId, status: receipt.status, sourceCommandId: receipt.sourceCommandId ?? null });
    return receipt;
  }

  private validateContext(request: ControlledActionRequest, policy: ControlledActionPolicy) {
    const { context } = request;
    if (context.applicationId !== this.dependencies.source.applicationId || new Date(context.expiresAt) <= new Date()) throw new AgentSdkError("INVALID_CONTEXT", "Trusted execution context is invalid or expired.");
    if (!context.grantedScopes.includes(policy.requiredScope)) throw new AgentSdkError("SCOPE_DENIED", `Missing required scope: ${policy.requiredScope}.`);
    if (!request.idempotencyKey.trim()) throw new AgentSdkError("IDEMPOTENCY_REQUIRED", "A non-empty idempotency key is mandatory.");
  }

  private async validateApproval(request: ControlledActionRequest, policy: ControlledActionPolicy) {
    if (!policy.requiresNerveApproval) return;
    const envelope = request.approvedAction;
    if (!envelope) throw new AgentSdkError("APPROVAL_REQUIRED", "This action requires an approved action envelope.");
    if (envelope.tenantId !== request.context.tenantId || envelope.targetToolId !== request.actionId || envelope.payloadHash !== payloadHash(request.payload) || envelope.payloadHash !== payloadHash(envelope.payload)) throw new AgentSdkError("APPROVAL_REQUIRED", "Approval does not bind to this tenant, action, or payload.");
    const [approval, proposal] = await Promise.all([
      this.dependencies.governance.getApproval(request.context.tenantId, envelope.approvalId),
      this.dependencies.governance.getProposal(request.context.tenantId, envelope.proposalId),
    ]);
    if (!approval || !proposal || approval.status !== "APPROVED" || proposal.status !== "APPROVED") throw new AgentSdkError("APPROVAL_REQUIRED", "Approval is missing, incomplete, stale, expired, or already consumed.");
    if (new Date(approval.expiresAt) <= new Date() || new Date(proposal.expiresAt) <= new Date()) throw new AgentSdkError("APPROVAL_REQUIRED", "Approval has expired.");
    if (approval.proposalId !== proposal.proposalId || proposal.targetToolId !== request.actionId || proposal.payloadHash !== envelope.payloadHash || approval.payloadHash !== envelope.payloadHash || proposal.factHash !== envelope.factHash || approval.factHash !== envelope.factHash || proposal.evidenceHash !== envelope.evidenceHash || approval.evidenceHash !== envelope.evidenceHash) throw new AgentSdkError("APPROVAL_REQUIRED", "Approval binding no longer matches the governed proposal.");
  }

  private audit(request: ControlledActionRequest, type: "EXECUTION_STARTED" | "EXECUTION_COMPLETED" | "EXECUTION_REJECTED" | "EXECUTION_UNCERTAIN", detail: JsonObject) {
    return this.dependencies.governance.appendAudit({ eventId: randomUUID(), tenantId: request.context.tenantId, ...(request.approvedAction ? { proposalId: request.approvedAction.proposalId, approvalId: request.approvedAction.approvalId } : {}), actorId: request.context.actorId, type, occurredAt: new Date().toISOString(), detail });
  }
}

function requiredCheckMissing(policy: ControlledActionPolicy, result: SourceActionResult): string | undefined {
  const values = { FINAL_AUTHORIZATION: result.checks.finalAuthorization, FACTS_RELOADED: result.checks.factsReloaded, LEDGER_INVARIANTS: result.checks.ledgerInvariants, JOURNAL_INVARIANTS: result.checks.journalInvariants, EXPLICIT_MESSAGE_POLICY: result.checks.explicitMessagePolicy };
  return policy.sourceChecks.find(check => values[check] !== true);
}
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
