import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ApprovalRequest, ExecutionContext } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import { evidenceHash, factHash, payloadHash } from "./governance-hashing.ts";
import type { ApprovedActionEnvelope, ApprovalPolicy, GovernanceAuditEvent, GovernanceStore, ProposalSnapshot, ProposalType, SourceRevalidator } from "./governance-contracts.ts";

export const defaultApprovalPolicies: ApprovalPolicy[] = [
  { policyId: "customer-reminder", policyVersion: "1", proposalType: "CUSTOMER_REMINDER_DRAFT", requiredRoleSets: [["OWNER", "MANAGER"]], expiresAfterMinutes: 1_440 },
  { policyId: "inventory-adjustment-dual", policyVersion: "1", proposalType: "INVENTORY_ADJUSTMENT_REQUEST", requiredRoleSets: [["OWNER"], ["ACCOUNTANT"]], expiresAfterMinutes: 240 },
  { policyId: "invoice-correction-dual", policyVersion: "1", proposalType: "INVOICE_CORRECTION_REVIEW", requiredRoleSets: [["OWNER"], ["ACCOUNTANT"]], expiresAfterMinutes: 240 },
  { policyId: "shift-variance", policyVersion: "1", proposalType: "SHIFT_VARIANCE_REVIEW", requiredRoleSets: [["OWNER", "MANAGER"]], expiresAfterMinutes: 720 },
  { policyId: "supplier-follow-up", policyVersion: "1", proposalType: "SUPPLIER_FOLLOW_UP", requiredRoleSets: [["OWNER", "MANAGER"]], expiresAfterMinutes: 1_440 },
];

export class ApprovalService {
  constructor(store: GovernanceStore, policies: ApprovalPolicy[] = defaultApprovalPolicies) { this.store = store; this.policies = policies; }
  private readonly store: GovernanceStore;
  private readonly policies: ApprovalPolicy[];

  async request(tenantId: string, proposalId: string): Promise<ApprovalRequest> {
    const proposal = await this.requireProposal(tenantId, proposalId);
    if (proposal.status !== "DRAFT") throw new AgentSdkError("INVALID_REQUEST", "Only a draft proposal can request approval.");
    if (new Date(proposal.expiresAt) <= new Date()) throw new AgentSdkError("INVALID_REQUEST", "Proposal has expired.");
    const policy = this.policies.find(row => row.proposalType === proposal.proposalType as ProposalType);
    if (!policy) throw new AgentSdkError("INVALID_REQUEST", "No approval policy exists for this proposal type.");
    const expiresAt = new Date(Math.min(new Date(proposal.expiresAt).getTime(), Date.now() + policy.expiresAfterMinutes * 60_000)).toISOString();
    const approval: ApprovalRequest = {
      approvalId: randomUUID(), proposalId, tenantId, payloadHash: proposal.payloadHash, factHash: proposal.factHash, evidenceHash: proposal.evidenceHash,
      policyVersion: `${policy.policyId}@${policy.policyVersion}`, requiredRoleSets: policy.requiredRoleSets, requiredApprovals: policy.requiredRoleSets.length,
      decisions: [], requestedAt: new Date().toISOString(), expiresAt, status: "PENDING",
    };
    proposal.status = "PENDING"; await this.store.updateProposal(proposal); await this.store.saveApproval(approval);
    await this.audit({ tenantId, findingId: proposal.findingId, proposalId, approvalId: approval.approvalId, type: "APPROVAL_REQUESTED", detail: { policyVersion: approval.policyVersion, requiredApprovals: approval.requiredApprovals } });
    return approval;
  }

  async decide(input: { context: ExecutionContext; approvalId: string; decision: "APPROVE" | "REJECT"; reason?: string; currentSnapshot: ProposalSnapshot }): Promise<ApprovalRequest> {
    this.requireScope(input.context, "proposal:approve");
    const approval = await this.requireApproval(input.context.tenantId, input.approvalId);
    const proposal = await this.requireProposal(input.context.tenantId, approval.proposalId);
    await this.assertCurrent(proposal, approval, input.currentSnapshot);
    if (approval.status !== "PENDING" || proposal.status !== "PENDING") throw new AgentSdkError("INVALID_REQUEST", "Approval is no longer pending.");
    if (new Date(approval.expiresAt) <= new Date() || new Date(proposal.expiresAt) <= new Date()) throw new AgentSdkError("INVALID_REQUEST", "Proposal approval has expired.");
    if (approval.decisions.some(row => row.actorId === input.context.actorId)) throw new AgentSdkError("INVALID_REQUEST", "An approver may decide only once.");
    const remainingRoleSet = approval.requiredRoleSets.find(roleSet => !approval.decisions.some(decision => decision.decision === "APPROVE" && decision.actorRoles.some(role => roleSet.includes(role))) && input.context.roles.some(role => roleSet.includes(role)));
    if (!remainingRoleSet) throw new AgentSdkError("SCOPE_DENIED", "Actor role is not eligible for the remaining approval step.");
    const decision: ApprovalDecision = { decisionId: randomUUID(), actorId: input.context.actorId, actorRoles: input.context.roles, decision: input.decision, decidedAt: new Date().toISOString(), ...(input.reason ? { reason: input.reason } : {}) };
    approval.decisions.push(decision);
    if (input.decision === "REJECT") { approval.status = "REJECTED"; proposal.status = "REJECTED"; }
    else if (approval.decisions.filter(row => row.decision === "APPROVE").length >= approval.requiredApprovals) { approval.status = "APPROVED"; proposal.status = "APPROVED"; approval.decidedByActorId = input.context.actorId; approval.decidedAt = decision.decidedAt; }
    await this.store.updateApproval(approval); await this.store.updateProposal(proposal);
    await this.audit({ tenantId: approval.tenantId, findingId: proposal.findingId, proposalId: proposal.proposalId, approvalId: approval.approvalId, actorId: input.context.actorId, type: input.decision === "APPROVE" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED", detail: { decisionId: decision.decisionId, approvalStatus: approval.status } });
    return approval;
  }

  async prepareExecution(input: { context: ExecutionContext; approvalId: string; currentSnapshot: ProposalSnapshot; sourceRevalidator: SourceRevalidator }): Promise<ApprovedActionEnvelope> {
    this.requireScope(input.context, "proposal:prepare-execution");
    const approval = await this.requireApproval(input.context.tenantId, input.approvalId);
    const proposal = await this.requireProposal(input.context.tenantId, approval.proposalId);
    await this.assertCurrent(proposal, approval, input.currentSnapshot);
    if (approval.status !== "APPROVED" || proposal.status !== "APPROVED") throw new AgentSdkError("APPROVAL_REQUIRED", "Proposal does not have complete approval.");
    if (new Date(approval.expiresAt) <= new Date() || new Date(proposal.expiresAt) <= new Date()) throw new AgentSdkError("INVALID_REQUEST", "Approved proposal has expired.");
    const revalidated = await input.sourceRevalidator({ context: input.context, proposal, approval, currentSnapshot: input.currentSnapshot });
    if (!revalidated.valid) {
      await this.audit({ tenantId: proposal.tenantId, findingId: proposal.findingId, proposalId: proposal.proposalId, approvalId: approval.approvalId, actorId: input.context.actorId, type: "SOURCE_REVALIDATION_FAILED", detail: { reason: revalidated.reason ?? "Source application rejected current state." } });
      throw new AgentSdkError("INVALID_REQUEST", "Source application revalidation failed.");
    }
    const envelope: ApprovedActionEnvelope = {
      approvalId: approval.approvalId, proposalId: proposal.proposalId, tenantId: proposal.tenantId, targetToolId: proposal.targetToolId,
      payload: structuredClone(proposal.payload), payloadHash: proposal.payloadHash, factHash: proposal.factHash, evidenceHash: proposal.evidenceHash,
      policyVersion: approval.policyVersion, approvedBy: approval.decisions.filter(row => row.decision === "APPROVE").map(row => ({ actorId: row.actorId, actorRoles: row.actorRoles, decidedAt: row.decidedAt })), preparedAt: new Date().toISOString(),
    };
    await this.audit({ tenantId: proposal.tenantId, findingId: proposal.findingId, proposalId: proposal.proposalId, approvalId: approval.approvalId, actorId: input.context.actorId, type: "EXECUTION_PREPARED", detail: { targetToolId: proposal.targetToolId, payloadHash: proposal.payloadHash, factHash: proposal.factHash, evidenceHash: proposal.evidenceHash } });
    return envelope;
  }

  private async assertCurrent(proposal: Awaited<ReturnType<ApprovalService["requireProposal"]>>, approval: ApprovalRequest, snapshot: ProposalSnapshot) {
    const valid = proposal.payloadHash === payloadHash(proposal.payload) && proposal.payloadHash === approval.payloadHash && proposal.factHash === factHash(snapshot) && proposal.factHash === approval.factHash && proposal.evidenceHash === evidenceHash(snapshot) && proposal.evidenceHash === approval.evidenceHash;
    if (!valid) {
      proposal.status = "STALE"; approval.status = "STALE";
      await this.store.updateProposal(proposal); await this.store.updateApproval(approval);
      await this.audit({ tenantId: proposal.tenantId, findingId: proposal.findingId, proposalId: proposal.proposalId, approvalId: approval.approvalId, type: "PROPOSAL_MARKED_STALE", detail: { payloadMatches: proposal.payloadHash === payloadHash(proposal.payload) && proposal.payloadHash === approval.payloadHash, factsMatch: proposal.factHash === factHash(snapshot) && proposal.factHash === approval.factHash, evidenceMatches: proposal.evidenceHash === evidenceHash(snapshot) && proposal.evidenceHash === approval.evidenceHash } });
      throw new AgentSdkError("INVALID_REQUEST", "Proposal payload, facts, or evidence changed after creation.");
    }
  }
  private async requireProposal(tenantId: string, proposalId: string) { const row = await this.store.getProposal(tenantId, proposalId); if (!row) throw new AgentSdkError("INVALID_REQUEST", "Proposal not found."); return row; }
  private async requireApproval(tenantId: string, approvalId: string) { const row = await this.store.getApproval(tenantId, approvalId); if (!row) throw new AgentSdkError("INVALID_REQUEST", "Approval not found."); return row; }
  private requireScope(context: ExecutionContext, scope: string) {
    if (!context.grantedScopes.includes(scope)) throw new AgentSdkError("SCOPE_DENIED", `Missing required scope: ${scope}.`);
  }
  private audit(input: Omit<GovernanceAuditEvent, "eventId" | "occurredAt">) { return this.store.appendAudit({ ...input, eventId: randomUUID(), occurredAt: new Date().toISOString() }); }
}
