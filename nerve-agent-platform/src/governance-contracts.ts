import type { AgentFinding, AgentProposal, ApprovalRequest, ExecutionContext, JsonObject } from "./contracts.ts";

export const proposalTypes = [
  "CUSTOMER_REMINDER_DRAFT",
  "INVENTORY_ADJUSTMENT_REQUEST",
  "INVOICE_CORRECTION_REVIEW",
  "SHIFT_VARIANCE_REVIEW",
  "SUPPLIER_FOLLOW_UP",
] as const;
export type ProposalType = typeof proposalTypes[number];

export type ApprovalPolicy = {
  policyId: string;
  policyVersion: string;
  proposalType: ProposalType;
  requiredRoleSets: string[][];
  expiresAfterMinutes: number;
};

export type GovernanceAuditEvent = {
  eventId: string;
  tenantId: string;
  findingId?: string;
  proposalId?: string;
  approvalId?: string;
  actorId?: string;
  type:
    | "FINDING_SAVED"
    | "PROPOSAL_CREATED"
    | "APPROVAL_REQUESTED"
    | "APPROVAL_GRANTED"
    | "APPROVAL_REJECTED"
    | "PROPOSAL_EXPIRED"
    | "PROPOSAL_MARKED_STALE"
    | "SOURCE_REVALIDATION_FAILED"
    | "EXECUTION_PREPARED"
    | "EXECUTION_STARTED"
    | "EXECUTION_COMPLETED"
    | "EXECUTION_REJECTED"
    | "EXECUTION_UNCERTAIN";
  occurredAt: string;
  detail: JsonObject;
};

export interface GovernanceStore {
  saveFindings(findings: AgentFinding[]): Promise<void>;
  listFindings(tenantId: string): Promise<AgentFinding[]>;
  getFinding(tenantId: string, findingId: string): Promise<AgentFinding | undefined>;
  saveProposal(proposal: AgentProposal): Promise<void>;
  updateProposal(proposal: AgentProposal): Promise<void>;
  getProposal(tenantId: string, proposalId: string): Promise<AgentProposal | undefined>;
  listProposals(tenantId: string): Promise<AgentProposal[]>;
  saveApproval(approval: ApprovalRequest): Promise<void>;
  updateApproval(approval: ApprovalRequest): Promise<void>;
  getApproval(tenantId: string, approvalId: string): Promise<ApprovalRequest | undefined>;
  listApprovals(tenantId: string): Promise<ApprovalRequest[]>;
  appendAudit(event: GovernanceAuditEvent): Promise<void>;
  auditHistory(tenantId: string, proposalId?: string): Promise<GovernanceAuditEvent[]>;
}

export type ProposalSnapshot = {
  factIds: string[];
  evidence: AgentFinding["evidence"];
};

export type ApprovedActionEnvelope = {
  approvalId: string;
  proposalId: string;
  tenantId: string;
  targetToolId: string;
  payload: JsonObject;
  payloadHash: string;
  factHash: string;
  evidenceHash: string;
  policyVersion: string;
  approvedBy: Array<{ actorId: string; actorRoles: string[]; decidedAt: string }>;
  preparedAt: string;
};

export type SourceRevalidator = (input: {
  context: ExecutionContext;
  proposal: AgentProposal;
  approval: ApprovalRequest;
  currentSnapshot: ProposalSnapshot;
}) => Promise<{ valid: boolean; reason?: string }>;
