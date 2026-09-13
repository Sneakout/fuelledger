export type PilotFinding = { type: string; stationId: string; severity: string; title: string; whyItMatters: string; recommendedNextStep: string; displayValue: unknown; supportingRecords: Array<{ resolverPath?: string }>; priorityRank?: number; priorityReason?: string; aiExplanation?: string };
export type SpecialistPilotCase = { caseId: string; agentKey: string; deterministic: PilotFinding[]; assisted: PilotFinding[]; modelFailureFallback: PilotFinding[]; modelDurationMs: number; fallbackUsed: boolean };
export type SpecialistPilotThresholds = { minimumIssueIdentification: number; minimumPriorityClarity: number; minimumEvidenceOpenability: number; minimumFindingPreservationOnModelFailure: number; maximumFallbackRate: number; maximumP95ModelLatencyMs: number };

export function evaluateSpecialistPilot(cases: SpecialistPilotCase[], thresholds: SpecialistPilotThresholds) {
  const findings = cases.flatMap(row => row.assisted), deterministic = cases.flatMap(row => row.deterministic), failed = cases.flatMap(row => row.modelFailureFallback);
  const issueIdentification = ratio(findings.filter(row => row.title.trim() && row.whyItMatters.trim()).length, findings.length);
  const priorityClarity = ratio(findings.filter(row => row.severity && (row.priorityRank === undefined || Boolean(row.priorityReason?.trim()))).length, findings.length);
  const evidenceOpenability = ratio(findings.filter(row => row.supportingRecords.length > 0 && row.supportingRecords.every(record => record.resolverPath?.startsWith("/"))).length, findings.length);
  const deterministicKeys = new Set(deterministic.map(key)), failedKeys = new Set(failed.map(key));
  const findingPreservationOnModelFailure = ratio([...deterministicKeys].filter(value => failedKeys.has(value)).length, deterministicKeys.size);
  const fallbackRate = ratio(cases.filter(row => row.fallbackUsed).length, cases.length);
  const durations = cases.map(row => row.modelDurationMs).sort((left, right) => left - right);
  const p95ModelLatencyMs = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * .95) - 1)]! : 0;
  const sameFrozenFindings = cases.every(row => equalKeys(row.deterministic, row.assisted));
  return { cases: cases.length, findingCount: findings.length, issueIdentification, priorityClarity, evidenceOpenability, findingPreservationOnModelFailure, fallbackRate, p95ModelLatencyMs, sameFrozenFindings, passed: sameFrozenFindings && issueIdentification >= thresholds.minimumIssueIdentification && priorityClarity >= thresholds.minimumPriorityClarity && evidenceOpenability >= thresholds.minimumEvidenceOpenability && findingPreservationOnModelFailure >= thresholds.minimumFindingPreservationOnModelFailure && fallbackRate <= thresholds.maximumFallbackRate && p95ModelLatencyMs <= thresholds.maximumP95ModelLatencyMs };
}

const key = (row: PilotFinding) => `${row.stationId}:${row.type}`;
const equalKeys = (left: PilotFinding[], right: PilotFinding[]) => JSON.stringify(left.map(key).sort()) === JSON.stringify(right.map(key).sort());
const ratio = (part: number, total: number) => total === 0 ? 1 : part / total;
