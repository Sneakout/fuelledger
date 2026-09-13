import type { AgentRun } from "./contracts.ts";
import type { AuditEvent, AuditStore, RuntimeLogger } from "./runtime-contracts.ts";

export class InMemoryAuditStore implements AuditStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly eventLog = new Map<string, AuditEvent[]>();
  async createRun(run: AgentRun) {
    if (this.runs.has(run.runId)) throw new Error("Run already exists.");
    this.runs.set(run.runId, structuredClone(run));
  }
  async updateRun(run: AgentRun) { this.runs.set(run.runId, structuredClone(run)); }
  async append(event: AuditEvent) {
    const events = this.eventLog.get(event.runId) ?? [];
    events.push(structuredClone(event));
    this.eventLog.set(event.runId, events);
  }
  async getRun(runId: string) { const run = this.runs.get(runId); return run ? structuredClone(run) : undefined; }
  async events(runId: string) { return structuredClone(this.eventLog.get(runId) ?? []); }
}

export const silentLogger: RuntimeLogger = { info() {}, warn() {}, error() {} };
