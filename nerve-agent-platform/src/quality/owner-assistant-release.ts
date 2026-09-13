import { createHash } from "node:crypto";

export type OwnerAssistantReleaseStage = "OFF" | "LOCAL" | "STAGING" | "PRODUCTION";
export type OwnerAssistantEnvironment = "development" | "staging" | "production";

export type OwnerAssistantReleaseConfig = {
  stage: OwnerAssistantReleaseStage;
  rolloutPercent: number;
  rollback: boolean;
};

export type OwnerAssistantRoute = "SPECIALIST_COORDINATOR" | "LEGACY_ASSISTANT";

export function releaseRoute(config: OwnerAssistantReleaseConfig, environment: OwnerAssistantEnvironment, tenantId: string, actorId: string): OwnerAssistantRoute {
  validateConfig(config);
  if (config.rollback || config.stage === "OFF") return "LEGACY_ASSISTANT";
  if (!stageAllows(config.stage, environment)) return "LEGACY_ASSISTANT";
  const bucket = createHash("sha256").update(`${tenantId}:${actorId}`).digest().readUInt32BE(0) % 100;
  return bucket < config.rolloutPercent ? "SPECIALIST_COORDINATOR" : "LEGACY_ASSISTANT";
}

export type OwnerAssistantRunMeasurement = {
  completed: boolean;
  fallbackUsed: boolean;
  scopeDenied: boolean;
  unsupported: boolean;
  evidenceValid: boolean;
  snapshotConsistent: boolean;
  durationMs: number;
};

export type OwnerAssistantReleaseHealth = {
  runs: number;
  completionRate: number;
  fallbackRate: number;
  evidenceFailureRate: number;
  inconsistentSnapshotRate: number;
  p95DurationMs: number;
  rollbackRecommended: boolean;
};

export class OwnerAssistantReleaseMonitor {
  private readonly measurements: OwnerAssistantRunMeasurement[] = [];

  record(measurement: OwnerAssistantRunMeasurement) {
    if (!Number.isFinite(measurement.durationMs) || measurement.durationMs < 0) throw new Error("Owner Assistant duration must be a non-negative number.");
    this.measurements.push(structuredClone(measurement));
  }

  health(): OwnerAssistantReleaseHealth {
    const runs = this.measurements.length;
    if (!runs) return { runs: 0, completionRate: 1, fallbackRate: 0, evidenceFailureRate: 0, inconsistentSnapshotRate: 0, p95DurationMs: 0, rollbackRecommended: false };
    const rate = (predicate: (row: OwnerAssistantRunMeasurement) => boolean) => this.measurements.filter(predicate).length / runs;
    const durations = this.measurements.map(row => row.durationMs).sort((a, b) => a - b);
    const completionRate = rate(row => row.completed);
    const fallbackRate = rate(row => row.fallbackUsed);
    const evidenceFailureRate = rate(row => !row.evidenceValid);
    const inconsistentSnapshotRate = rate(row => !row.snapshotConsistent);
    const p95DurationMs = durations[Math.max(0, Math.ceil(runs * 0.95) - 1)]!;
    return {
      runs, completionRate, fallbackRate, evidenceFailureRate, inconsistentSnapshotRate, p95DurationMs,
      rollbackRecommended: evidenceFailureRate > 0 || inconsistentSnapshotRate > 0 || completionRate < 0.98 || fallbackRate > 0.1 || p95DurationMs > 20_000,
    };
  }
}

function stageAllows(stage: OwnerAssistantReleaseStage, environment: OwnerAssistantEnvironment) {
  if (environment === "development") return stage === "LOCAL" || stage === "STAGING" || stage === "PRODUCTION";
  if (environment === "staging") return stage === "STAGING" || stage === "PRODUCTION";
  return stage === "PRODUCTION";
}

function validateConfig(config: OwnerAssistantReleaseConfig) {
  if (!Number.isInteger(config.rolloutPercent) || config.rolloutPercent < 0 || config.rolloutPercent > 100) throw new Error("Owner Assistant rollout percent must be an integer from 0 to 100.");
}
