import { randomUUID } from "node:crypto";
import type { AgentFinding, EvidenceReference, SignedEnvelope } from "../../contracts.ts";
import { AgentSdkError } from "../../errors.ts";
import type { NerveRuntime } from "../../runtime.ts";
import type { AgentInvocation, AgentResponse } from "../../runtime-contracts.ts";
import type { FuelNerveReadClient, FuelNerveScope } from "./types.ts";

export type ShadowFinding = AgentFinding & { visibility: "SHADOW"; proposalIds: []; actionIds: [] };
export type ShadowComparison = {
  comparisonId: string;
  runId: string;
  reviewedBy: string;
  reviewedAt: string;
  expectedDeduplicationKeys: string[];
  actualDeduplicationKeys: string[];
  falsePositiveKeys: string[];
  missingKeys: string[];
  notes?: string;
};

export interface ShadowStore {
  saveRun(response: AgentResponse, findings: ShadowFinding[]): Promise<void>;
  saveComparison(comparison: ShadowComparison): Promise<void>;
  findings(runId: string): Promise<ShadowFinding[]>;
  comparisons(runId: string): Promise<ShadowComparison[]>;
}

export class InMemoryShadowStore implements ShadowStore {
  private readonly findingRows = new Map<string, ShadowFinding[]>();
  private readonly comparisonRows = new Map<string, ShadowComparison[]>();
  async saveRun(response: AgentResponse, findings: ShadowFinding[]) { this.findingRows.set(response.run.runId, structuredClone(findings)); }
  async saveComparison(comparison: ShadowComparison) { const rows = this.comparisonRows.get(comparison.runId) ?? []; rows.push(structuredClone(comparison)); this.comparisonRows.set(comparison.runId, rows); }
  async findings(runId: string) { return structuredClone(this.findingRows.get(runId) ?? []); }
  async comparisons(runId: string) { return structuredClone(this.comparisonRows.get(runId) ?? []); }
}

export class FuelNerveShadowRunner {
  constructor(runtime: NerveRuntime, client: FuelNerveReadClient, store: ShadowStore) { this.runtime = runtime; this.client = client; this.store = store; }
  private readonly runtime: NerveRuntime;
  private readonly client: FuelNerveReadClient;
  private readonly store: ShadowStore;

  async run(envelope: SignedEnvelope<AgentInvocation>, options: { signal?: AbortSignal } = {}): Promise<{ runId: string; findingCount: number; response: AgentResponse }> {
    const response = await this.runtime.execute(envelope, options);
    const context = envelope.payload.context;
    if (!context.grantedScopes.includes("evidence:read")) throw new AgentSdkError("SCOPE_DENIED", "Shadow findings require evidence lookup permission.");
    const scope: FuelNerveScope = { organizationId: context.tenantId, stationIds: context.permittedLocationIds, asOf: new Date().toISOString() };
    const verified = new Map<string, EvidenceReference>();
    for (const evidence of response.evidence) {
      const resolved = await this.client.resolveEvidence(scope, evidence.evidenceId, options.signal ?? new AbortController().signal);
      const match = resolved.evidence.find(item => item.evidenceId === evidence.evidenceId && item.tenantId === context.tenantId && item.applicationId === context.applicationId);
      if (!match) throw new AgentSdkError("EVIDENCE_INVALID", `FuelNerve could not resolve evidence ${evidence.evidenceId}.`);
      verified.set(match.evidenceId, match);
    }
    const findings: ShadowFinding[] = response.facts.map(fact => ({
      findingId: randomUUID(), runId: response.run.runId, agentKey: response.run.agentKey, agentVersion: response.run.agentVersion,
      tenantId: response.run.tenantId, locationIds: context.permittedLocationIds, type: fact.factId.toUpperCase().replaceAll("-", "_"),
      severity: "INFORMATION", title: fact.label, summary: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value), factIds: [fact.factId],
      evidence: fact.evidenceIds.map(id => verified.get(id)!).filter(Boolean), detectedAt: new Date().toISOString(),
      deduplicationKey: `${response.run.agentKey}:${context.tenantId}:${context.permittedLocationIds.join(",")}:${fact.factId}`,
      visibility: "SHADOW", proposalIds: [], actionIds: [],
    }));
    if (findings.some(finding => !finding.evidence.length)) throw new AgentSdkError("EVIDENCE_INVALID", "Every shadow finding must contain resolvable FuelNerve evidence.");
    await this.store.saveRun(response, findings);
    return { runId: response.run.runId, findingCount: findings.length, response };
  }

  async compare(input: { runId: string; expectedDeduplicationKeys: string[]; reviewedBy: string; notes?: string }): Promise<ShadowComparison> {
    const findings = await this.store.findings(input.runId);
    const actual = findings.map(item => item.deduplicationKey);
    const expected = [...new Set(input.expectedDeduplicationKeys)];
    const comparison: ShadowComparison = {
      comparisonId: randomUUID(), runId: input.runId, reviewedBy: input.reviewedBy, reviewedAt: new Date().toISOString(),
      expectedDeduplicationKeys: expected, actualDeduplicationKeys: actual,
      falsePositiveKeys: actual.filter(key => !expected.includes(key)), missingKeys: expected.filter(key => !actual.includes(key)),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    await this.store.saveComparison(comparison);
    return comparison;
  }
}
