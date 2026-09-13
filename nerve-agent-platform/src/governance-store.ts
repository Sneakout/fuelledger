import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentFinding, AgentProposal, ApprovalRequest } from "./contracts.ts";
import type { AgentResponse } from "./runtime-contracts.ts";
import type { GovernanceAuditEvent, GovernanceStore } from "./governance-contracts.ts";

type State = { findings: AgentFinding[]; proposals: AgentProposal[]; approvals: ApprovalRequest[]; audit: GovernanceAuditEvent[] };
const emptyState = (): State => ({ findings: [], proposals: [], approvals: [], audit: [] });

export class FileGovernanceStore implements GovernanceStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(filePath: string) { this.filePath = filePath; }
  private readonly filePath: string;

  async save(_response: AgentResponse, findings: AgentFinding[]) { return this.saveFindings(findings); }
  async list(tenantId: string) { return this.listFindings(tenantId); }

  async saveFindings(findings: AgentFinding[]) { await this.mutate(state => {
    for (const finding of findings) {
      if (!state.findings.some(row => row.tenantId === finding.tenantId && row.findingId === finding.findingId)) state.findings.push(structuredClone(finding));
    }
  }); }
  async listFindings(tenantId: string) { return (await this.read()).findings.filter(row => row.tenantId === tenantId); }
  async getFinding(tenantId: string, findingId: string) { return (await this.read()).findings.find(row => row.tenantId === tenantId && row.findingId === findingId); }
  async saveProposal(proposal: AgentProposal) { await this.mutate(state => {
    if (state.proposals.some(row => row.tenantId === proposal.tenantId && row.proposalId === proposal.proposalId)) throw new Error("Proposal already exists.");
    state.proposals.push(structuredClone(proposal));
  }); }
  async updateProposal(proposal: AgentProposal) { await this.mutate(state => replace(state.proposals, proposal, row => row.tenantId === proposal.tenantId && row.proposalId === proposal.proposalId)); }
  async getProposal(tenantId: string, proposalId: string) { return (await this.read()).proposals.find(row => row.tenantId === tenantId && row.proposalId === proposalId); }
  async listProposals(tenantId: string) { return (await this.read()).proposals.filter(row => row.tenantId === tenantId); }
  async saveApproval(approval: ApprovalRequest) { await this.mutate(state => {
    if (state.approvals.some(row => row.tenantId === approval.tenantId && row.approvalId === approval.approvalId)) throw new Error("Approval already exists.");
    state.approvals.push(structuredClone(approval));
  }); }
  async updateApproval(approval: ApprovalRequest) { await this.mutate(state => replace(state.approvals, approval, row => row.tenantId === approval.tenantId && row.approvalId === approval.approvalId)); }
  async getApproval(tenantId: string, approvalId: string) { return (await this.read()).approvals.find(row => row.tenantId === tenantId && row.approvalId === approvalId); }
  async listApprovals(tenantId: string) { return (await this.read()).approvals.filter(row => row.tenantId === tenantId); }
  async appendAudit(event: GovernanceAuditEvent) { await this.mutate(state => { state.audit.push(structuredClone(event)); }); }
  async auditHistory(tenantId: string, proposalId?: string) { return (await this.read()).audit.filter(row => row.tenantId === tenantId && (!proposalId || row.proposalId === proposalId)); }

  private async read(): Promise<State> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as State; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw error; }
  }
  private async mutate(change: (state: State) => void | Promise<void>): Promise<void> {
    const operation = this.queue.then(async () => {
      const state = await this.read(); await change(state); await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filePath);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

function replace<T>(rows: T[], value: T, matches: (row: T) => boolean) {
  const index = rows.findIndex(matches); if (index < 0) throw new Error("Record not found."); rows[index] = structuredClone(value);
}
