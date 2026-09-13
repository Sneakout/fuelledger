import type { AgentFinding, EvidenceReference, FindingSeverity, JsonObject, SignedEnvelope } from "../../contracts.ts";
import { AgentSdkError } from "../../errors.ts";
import type { NerveRuntime } from "../../runtime.ts";
import type { AgentInvocation, AgentResponse } from "../../runtime-contracts.ts";

export type ReadOnlyFindingView = {
  findingId: string;
  agentKey: string;
  type: string;
  severity: FindingSeverity;
  title: string;
  whyItMatters: string;
  calculatedAt: string;
  stationId: string;
  period: { start: string; end: string };
  supportingRecords: Array<Pick<EvidenceReference, "evidenceId" | "evidenceType" | "label" | "resolverPath">>;
  explanationMode: "AI_EXPLAINED" | "DETERMINISTIC";
  recommendedNextStep: string;
  displayValue: unknown;
  priorityRank?: number;
  priorityReason?: string;
  recordsToCompare?: unknown[];
  relatedContext?: unknown;
  unverified?: unknown[];
  aiExplanation?: string;
};

export interface ReadOnlyFindingStore {
  save(response: AgentResponse, findings: AgentFinding[]): Promise<void>;
  list(tenantId: string): Promise<AgentFinding[]>;
}

export class InMemoryReadOnlyFindingStore implements ReadOnlyFindingStore {
  private rows: AgentFinding[] = [];
  async save(_response: AgentResponse, findings: AgentFinding[]) {
    for (const finding of structuredClone(findings)) {
      const existing = this.rows.findIndex(row => row.deduplicationKey === finding.deduplicationKey);
      if (existing >= 0) this.rows[existing] = finding; else this.rows.push(finding);
    }
  }
  async list(tenantId: string) { return structuredClone(this.rows.filter(row => row.tenantId === tenantId)); }
}

export class FuelNerveReadOnlyAgentService {
  constructor(runtime: NerveRuntime, store: ReadOnlyFindingStore) { this.runtime = runtime; this.store = store; }
  private readonly runtime: NerveRuntime;
  private readonly store: ReadOnlyFindingStore;

  async run(envelope: SignedEnvelope<AgentInvocation>, options: { signal?: AbortSignal } = {}): Promise<{ runId: string; findings: ReadOnlyFindingView[]; answer?: OwnerAssistantAnswer }> {
    const response = await this.runtime.execute(envelope, options);
    if (response.run.agentKey === "business-assistant") {
      const metadata = ownerAssistantMetadata(response);
      const presentation = ownerAssistantPresentation(response, metadata);
      return {
        runId: response.run.runId, findings: [],
        answer: {
          ...metadata,
          headline: presentation.headline, summary: appendDisclosures(presentation.summary, metadata), inconclusive: response.facts.length === 0,
          facts: response.facts.map(fact => ({
            label: fact.label, value: fact.value,
            supportingRecords: fact.evidenceIds.map(id => response.evidence.find(item => item.evidenceId === id)).filter((item): item is EvidenceReference => Boolean(item)).map(item => ({ evidenceId: item.evidenceId, evidenceType: item.evidenceType, label: item.label, ...(item.resolverPath ? { resolverPath: item.resolverPath } : {}) })),
          })),
        },
      };
    }
    const findings = response.facts.map((fact, index) => toFinding(response, fact.value as JsonObject, fact.factId, fact.evidenceIds, index));
    await this.store.save(response, findings.map(item => item.record));
    return {
      runId: response.run.runId,
      findings: findings.map(item => item.view),
    };
  }
}

export type OwnerAssistantAnswer = {
  headline: string;
  summary: string;
  inconclusive: boolean;
  stationId?: string;
  snapshotDate?: string;
  stale: boolean;
  inconsistentSnapshot: boolean;
  missingInformation: string[];
  followUp?: "GIVE_DETAILS" | "WHY_FIRST" | "SHOW_RECORDS";
  priorityExplanation?: string;
  supportedFollowUps: ["Give me details", "Why first?", "Show the records"];
  facts: Array<{ label: string; value: unknown; supportingRecords: ReadOnlyFindingView["supportingRecords"] }>;
};

function ownerAssistantMetadata(response: AgentResponse): Omit<OwnerAssistantAnswer, "headline" | "summary" | "inconclusive" | "facts"> {
  const snapshots = response.facts.map(fact => {
    const value = fact.value as JsonObject;
    return value.assistantSnapshot && typeof value.assistantSnapshot === "object" && !Array.isArray(value.assistantSnapshot) ? value.assistantSnapshot as JsonObject : undefined;
  }).filter((value): value is JsonObject => Boolean(value));
  const stationIds = [...new Set(snapshots.map(value => value.stationId).filter((value): value is string => typeof value === "string"))];
  const snapshotDates = [...new Set(snapshots.map(value => value.snapshotDate).filter((value): value is string => typeof value === "string"))];
  const missingInformation = [...new Set(snapshots.flatMap(value => Array.isArray(value.missingSpecialists) ? value.missingSpecialists.filter((item): item is string => typeof item === "string") : []))];
  const followUp = snapshots.map(value => value.followUp).find((value): value is "GIVE_DETAILS" | "WHY_FIRST" | "SHOW_RECORDS" => value === "GIVE_DETAILS" || value === "WHY_FIRST" || value === "SHOW_RECORDS");
  const first = response.facts[0]?.value as JsonObject | undefined;
  const priorityExplanation = first && typeof first.priorityReason === "string" ? first.priorityReason : first && typeof first.whyItMatters === "string" ? first.whyItMatters : undefined;
  const snapshotDate = snapshotDates.length === 1 ? snapshotDates[0] : undefined;
  const parsedSnapshot = snapshotDate ? Date.parse(snapshotDate) : Number.NaN;
  return {
    ...(stationIds.length === 1 ? { stationId: stationIds[0] } : {}),
    ...(snapshotDate ? { snapshotDate } : {}),
    stale: Number.isFinite(parsedSnapshot) && Date.now() - parsedSnapshot > 24 * 60 * 60 * 1000,
    inconsistentSnapshot: snapshots.some(value => value.inconsistentSnapshot === true) || snapshotDates.length > 1 || stationIds.length > 1,
    missingInformation,
    ...(followUp ? { followUp } : {}),
    ...(followUp === "WHY_FIRST" && priorityExplanation ? { priorityExplanation } : {}),
    supportedFollowUps: ["Give me details", "Why first?", "Show the records"],
  };
}

function ownerAssistantPresentation(response: AgentResponse, metadata: ReturnType<typeof ownerAssistantMetadata>) {
  if (!metadata.followUp || !response.facts.length) return { headline: response.narrative.headline, summary: response.narrative.summary };
  if (metadata.followUp === "WHY_FIRST") return { headline: response.facts[0]!.label, summary: metadata.priorityExplanation ? `This is first because ${lowercaseFirst(metadata.priorityExplanation)}` : "This is the highest-priority supported item in the current station snapshot." };
  if (metadata.followUp === "SHOW_RECORDS") return { headline: "Supporting records", summary: `${new Set(response.facts.flatMap(fact => fact.evidenceIds)).size} exact supporting record${new Set(response.facts.flatMap(fact => fact.evidenceIds)).size === 1 ? " is" : "s are"} attached below.` };
  return { headline: "Details from the five specialists", summary: `${response.facts.length} verified item${response.facts.length === 1 ? "" : "s"} are available for this station snapshot.` };
}

function appendDisclosures(summary: string, metadata: ReturnType<typeof ownerAssistantMetadata>) {
  const disclosures: string[] = [];
  if (metadata.stale && metadata.snapshotDate) disclosures.push(`The records are stale; this snapshot is from ${metadata.snapshotDate}.`);
  if (metadata.inconsistentSnapshot) disclosures.push("The specialist snapshot dates do not agree, so no combined conclusion should be relied on.");
  if (metadata.missingInformation.length) disclosures.push(`Information is missing from: ${metadata.missingInformation.join(", ")}.`);
  return [summary, ...disclosures].join(" ");
}

function lowercaseFirst(value: string) { return value ? `${value[0]!.toLowerCase()}${value.slice(1)}` : value; }

function toFinding(response: AgentResponse, value: JsonObject, factId: string, evidenceIds: string[], index: number) {
  const required = ["findingType", "severity", "title", "whyItMatters", "calculatedAt", "stationId", "periodStart", "periodEnd", "recommendedNextStep"];
  if (required.some(key => typeof value[key] !== "string")) throw new AgentSdkError("OUTPUT_INVALID", "FuelNerve finding presentation fields are incomplete.");
  const evidence = evidenceIds.map(id => response.evidence.find(item => item.evidenceId === id)).filter((item): item is EvidenceReference => Boolean(item));
  if (!evidence.length) throw new AgentSdkError("EVIDENCE_INVALID", "A visible FuelNerve finding has no supporting record.");
  const findingId = `${response.run.runId}:${index + 1}`;
  const aiClaim = response.narrativeMode === "MODEL" ? response.narrative.claims.find(claim => claim.factIds.includes(factId)) : undefined;
  const record: AgentFinding = {
    findingId, runId: response.run.runId, agentKey: response.run.agentKey, agentVersion: response.run.agentVersion, tenantId: response.run.tenantId,
    locationIds: [value.stationId as string], type: value.findingType as string, severity: value.severity as FindingSeverity,
    title: value.title as string, summary: value.whyItMatters as string, factIds: [factId], evidence,
    detectedAt: value.calculatedAt as string, deduplicationKey: `${response.run.agentKey}:${response.run.tenantId}:${value.stationId}:${value.findingType}:${typeof value.sourceKey === "string" ? value.sourceKey : "scope"}`,
  };
  const view: ReadOnlyFindingView = {
    findingId, agentKey: record.agentKey, type: record.type, severity: record.severity, title: record.title,
    whyItMatters: record.summary, calculatedAt: record.detectedAt, stationId: value.stationId as string,
    period: { start: value.periodStart as string, end: value.periodEnd as string },
    supportingRecords: evidence.map(item => ({ evidenceId: item.evidenceId, evidenceType: item.evidenceType, label: item.label, ...(item.resolverPath ? { resolverPath: item.resolverPath } : {}) })),
    explanationMode: response.narrativeMode === "MODEL" ? "AI_EXPLAINED" : "DETERMINISTIC",
    recommendedNextStep: value.recommendedNextStep as string, displayValue: value.displayValue,
    ...(typeof value.priorityRank === "number" ? { priorityRank: value.priorityRank } : {}),
    ...(typeof value.priorityReason === "string" ? { priorityReason: value.priorityReason } : {}),
    ...(Array.isArray(value.recordsToCompare) ? { recordsToCompare: value.recordsToCompare } : {}),
    ...(value.relatedContext !== undefined ? { relatedContext: value.relatedContext } : {}),
    ...(Array.isArray(value.unverified) ? { unverified: value.unverified } : {}),
    ...(aiClaim ? { aiExplanation: aiClaim.text } : {}),
  };
  return { record, view };
}
