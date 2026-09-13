import { randomUUID } from "node:crypto";
import type { AgentFinding, AgentProposal, JsonObject, RiskLevel } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import { evidenceHash, factHash, payloadHash, snapshotFromFinding } from "./governance-hashing.ts";
import type { GovernanceAuditEvent, GovernanceStore, ProposalType } from "./governance-contracts.ts";
import { proposalTypes } from "./governance-contracts.ts";

const proposalConfig: Record<ProposalType, { targetToolId: string; riskLevel: RiskLevel; roles: string[] }> = {
  CUSTOMER_REMINDER_DRAFT: { targetToolId: "communications.reminder-draft.save", riskLevel: "R1", roles: ["OWNER", "MANAGER"] },
  INVENTORY_ADJUSTMENT_REQUEST: { targetToolId: "inventory.adjustment.submit", riskLevel: "R3", roles: ["OWNER", "ACCOUNTANT"] },
  INVOICE_CORRECTION_REVIEW: { targetToolId: "purchases.invoice-correction.submit", riskLevel: "R3", roles: ["OWNER", "ACCOUNTANT"] },
  SHIFT_VARIANCE_REVIEW: { targetToolId: "follow-ups.internal.create", riskLevel: "R2", roles: ["OWNER", "MANAGER"] },
  SUPPLIER_FOLLOW_UP: { targetToolId: "follow-ups.internal.create", riskLevel: "R1", roles: ["OWNER", "MANAGER"] },
};

export class ProposalService {
  constructor(store: GovernanceStore) { this.store = store; }
  private readonly store: GovernanceStore;

  async saveFinding(finding: AgentFinding): Promise<void> {
    await this.store.saveFindings([finding]);
    await this.audit({ tenantId: finding.tenantId, findingId: finding.findingId, type: "FINDING_SAVED", detail: { findingType: finding.type } });
  }

  async create(input: { tenantId: string; findingId: string; proposalType: ProposalType; executablePayload: JsonObject; explanation: string; expiresAt: string }): Promise<AgentProposal> {
    if (!proposalTypes.includes(input.proposalType)) throw new AgentSdkError("INVALID_REQUEST", "Unsupported proposal type.");
    const finding = await this.store.getFinding(input.tenantId, input.findingId);
    if (!finding) throw new AgentSdkError("INVALID_REQUEST", "Finding was not found in this tenant.");
    if (!Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt) <= new Date()) throw new AgentSdkError("INVALID_REQUEST", "Proposal expiry must be in the future.");
    const config = proposalConfig[input.proposalType];
    const snapshot = snapshotFromFinding(finding);
    const proposal: AgentProposal = {
      proposalId: randomUUID(), findingId: finding.findingId, tenantId: finding.tenantId, proposalType: input.proposalType,
      targetToolId: config.targetToolId, payload: structuredClone(input.executablePayload), explanation: input.explanation,
      payloadHash: payloadHash(input.executablePayload), factHash: factHash(snapshot), evidenceHash: evidenceHash(snapshot), riskLevel: config.riskLevel,
      requiredApproverRoles: config.roles, status: "DRAFT", createdAt: new Date().toISOString(), expiresAt: input.expiresAt,
    };
    await this.store.saveProposal(proposal);
    await this.audit({ tenantId: proposal.tenantId, findingId: proposal.findingId, proposalId: proposal.proposalId, type: "PROPOSAL_CREATED", detail: { proposalType: proposal.proposalType, targetToolId: proposal.targetToolId, payloadHash: proposal.payloadHash, factHash: proposal.factHash, evidenceHash: proposal.evidenceHash } });
    return proposal;
  }

  async expire(tenantId: string, now = new Date()): Promise<number> {
    let count = 0;
    for (const proposal of await this.store.listProposals(tenantId)) {
      if (["DRAFT", "PENDING", "APPROVED"].includes(proposal.status) && new Date(proposal.expiresAt) <= now) {
        proposal.status = "EXPIRED"; await this.store.updateProposal(proposal); count += 1;
        await this.audit({ tenantId, findingId: proposal.findingId, proposalId: proposal.proposalId, type: "PROPOSAL_EXPIRED", detail: {} });
        for (const approval of (await this.store.listApprovals(tenantId)).filter(row => row.proposalId === proposal.proposalId && ["PENDING", "APPROVED"].includes(row.status))) { approval.status = "EXPIRED"; await this.store.updateApproval(approval); }
      }
    }
    return count;
  }

  private audit(input: Omit<GovernanceAuditEvent, "eventId" | "occurredAt">) { return this.store.appendAudit({ ...input, eventId: randomUUID(), occurredAt: new Date().toISOString() }); }
}
