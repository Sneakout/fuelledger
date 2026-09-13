import { createHash } from "node:crypto";
import type { JsonObject } from "../contracts.ts";
import type { AgentResponse } from "../runtime-contracts.ts";

export type OperationalSample = { agentKey: string; tenantId: string; durationMs: number; costMicros: number; status: "SUCCEEDED" | "FAILED" | "FALLBACK"; occurredAt: string };
export type AgentServiceObjective = { agentKey: string; minimumSuccessRate: number; maximumP95LatencyMs: number; maximumFallbackRate: number };
export class OperationalTelemetry {
  private readonly samples: OperationalSample[] = [];
  record(sample: OperationalSample) { this.samples.push(structuredClone(sample)); }
  recordResponse(response: AgentResponse, costMicros = 0) { const measurement = response.measurement; if (!measurement) return; this.record({ agentKey: response.run.agentKey, tenantId: response.run.tenantId, durationMs: measurement.durationMs, costMicros, status: response.run.status === "FAILED" ? "FAILED" : measurement.fallbackUsed ? "FALLBACK" : "SUCCEEDED", occurredAt: response.run.completedAt ?? new Date().toISOString() }); }
  dashboard(agentKey?: string) { const rows = this.samples.filter(item => !agentKey || item.agentKey === agentKey); const durations = rows.map(item => item.durationMs).sort((a, b) => a - b); return { requests: rows.length, successRate: ratio(rows.filter(item => item.status !== "FAILED").length, rows.length), fallbackRate: ratio(rows.filter(item => item.status === "FALLBACK").length, rows.length), p95LatencyMs: durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)]! : 0, totalCostMicros: rows.reduce((sum, item) => sum + item.costMicros, 0) }; }
  evaluate(objective: AgentServiceObjective) { const metrics = this.dashboard(objective.agentKey); return { agentKey: objective.agentKey, metrics, passed: metrics.successRate >= objective.minimumSuccessRate && metrics.p95LatencyMs <= objective.maximumP95LatencyMs && metrics.fallbackRate <= objective.maximumFallbackRate }; }
}

export interface BackupAdapter { createBackup(): Promise<Uint8Array>; restore(backup: Uint8Array): Promise<void>; canonicalState(): Promise<JsonObject>; }
export async function verifyBackupRestore(adapter: BackupAdapter) { const before = checksum(await adapter.canonicalState()); const backup = await adapter.createBackup(); await adapter.restore(backup); const after = checksum(await adapter.canonicalState()); return { beforeChecksum: before, afterChecksum: after, passed: before === after }; }
const checksum = (value: JsonObject) => createHash("sha256").update(JSON.stringify(value, Object.keys(value).sort())).digest("hex");
const ratio = (part: number, total: number) => total === 0 ? 1 : part / total;
