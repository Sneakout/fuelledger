import { createHash } from "node:crypto";
import type { AgentFinding, JsonObject } from "./contracts.ts";
import type { ProposalSnapshot } from "./governance-contracts.ts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export const governanceHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const payloadHash = (payload: JsonObject) => governanceHash(payload);
export const factHash = (snapshot: ProposalSnapshot) => governanceHash([...snapshot.factIds].sort());
export const evidenceHash = (snapshot: ProposalSnapshot) => governanceHash(snapshot.evidence.map(item => ({ applicationId: item.applicationId, tenantId: item.tenantId, evidenceId: item.evidenceId, resourceId: item.resourceId, version: item.version ?? null, observedAt: item.observedAt ?? null, periodStart: item.periodStart ?? null, periodEnd: item.periodEnd ?? null })).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
export const snapshotFromFinding = (finding: AgentFinding): ProposalSnapshot => ({ factIds: finding.factIds, evidence: finding.evidence });
