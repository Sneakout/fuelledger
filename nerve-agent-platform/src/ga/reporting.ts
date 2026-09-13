import type { ApprovalRequest, AgentProposal } from "../contracts.ts";
import type { GovernanceAuditEvent, GovernanceStore } from "../governance-contracts.ts";
import type { PlatformHealth, PlatformStore } from "../service/contracts.ts";
import type { HealthMonitor } from "../service/health.ts";

export class GaReportingService {
  constructor(input: { platform: PlatformStore; governance: GovernanceStore; health: HealthMonitor }) { this.input = input; }
  private readonly input: { platform: PlatformStore; governance: GovernanceStore; health: HealthMonitor };
  async usage(applicationId: string, tenantId: string) { const rows = await this.input.platform.meterEvents(applicationId, tenantId); return { applicationId, tenantId, totals: rows.reduce<Record<string, number>>((out, row) => ({ ...out, [row.kind]: (out[row.kind] ?? 0) + row.quantity }), {}), events: rows }; }
  async approvals(tenantId: string): Promise<{ pending: Array<{ approval: ApprovalRequest; proposal?: AgentProposal }>; totals: Record<string, number> }> { const [approvals, proposals] = await Promise.all([this.input.governance.listApprovals(tenantId), this.input.governance.listProposals(tenantId)]); return { pending: approvals.filter(item => item.status === "PENDING").map(approval => ({ approval, proposal: proposals.find(item => item.proposalId === approval.proposalId) })), totals: approvals.reduce<Record<string, number>>((out, item) => ({ ...out, [item.status]: (out[item.status] ?? 0) + 1 }), {}) }; }
  async exportAudit(tenantId: string, proposalId?: string): Promise<string> { const rows = await this.input.governance.auditHistory(tenantId, proposalId); return rows.map(item => JSON.stringify(safeAudit(item))).join("\n"); }
  status(): Promise<PlatformHealth> { return this.input.health.check(); }
}
function safeAudit(event: GovernanceAuditEvent) { return { ...event, detail: { ...event.detail } }; }
