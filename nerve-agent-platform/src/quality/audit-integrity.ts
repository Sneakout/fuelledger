import { createHash } from "node:crypto";
import type { AgentRun } from "../contracts.ts";
import type { AuditEvent, AuditStore } from "../runtime-contracts.ts";
import { governanceHash } from "../governance-hashing.ts";

export type ChainedAuditEntry = { event: AuditEvent; previousHash: string; entryHash: string };
export class HashChainedAuditStore implements AuditStore {
  private readonly runs = new Map<string, AgentRun>(); private readonly chains = new Map<string, ChainedAuditEntry[]>();
  async createRun(run: AgentRun) { if (this.runs.has(run.runId)) throw new Error("Run already exists."); this.runs.set(run.runId, structuredClone(run)); }
  async updateRun(run: AgentRun) { this.runs.set(run.runId, structuredClone(run)); }
  async append(event: AuditEvent) { const chain = this.chains.get(event.runId) ?? []; const previousHash = chain.at(-1)?.entryHash ?? genesis(event.runId); const entryHash = governanceHash({ previousHash, event }); chain.push({ event: structuredClone(event), previousHash, entryHash }); this.chains.set(event.runId, chain); }
  async getRun(runId: string) { const run = this.runs.get(runId); return run ? structuredClone(run) : undefined; }
  async events(runId: string) { return structuredClone((this.chains.get(runId) ?? []).map(item => item.event)); }
  entries(runId: string) { return structuredClone(this.chains.get(runId) ?? []); }
  verify(runId: string) { return verifyAuditChain(runId, this.chains.get(runId) ?? []); }
}
export function verifyAuditChain(runId: string, entries: ChainedAuditEntry[]) { let previous = genesis(runId); for (const entry of entries) { if (entry.previousHash !== previous || entry.entryHash !== governanceHash({ previousHash: previous, event: entry.event })) return false; previous = entry.entryHash; } return true; }
const genesis = (runId: string) => createHash("sha256").update(`nerve-audit:${runId}`).digest("hex");
