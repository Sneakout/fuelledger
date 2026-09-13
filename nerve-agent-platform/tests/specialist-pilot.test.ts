import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSpecialistPilot, type PilotFinding, type SpecialistPilotCase } from "../src/index.ts";

const finding = (type: string, ai = false): PilotFinding => ({ type, stationId: "station-a", severity: "ATTENTION", title: `${type} needs review`, whyItMatters: "The frozen record crossed its deterministic review rule.", recommendedNextStep: "Open and compare the supporting record.", displayValue: { amount: 100 }, supportingRecords: [{ resolverPath: "/evidence/record-a" }], priorityRank: 1, priorityReason: "Highest verified impact", ...(ai ? { aiExplanation: "The supplied record needs attention first." } : {}) });

test("three-specialist pilot gate compares assisted and deterministic briefings over identical findings", () => {
  const cases: SpecialistPilotCase[] = ["reconciliation-review", "inventory-watch", "profit-insight"].map((agentKey, index) => {
    const deterministic = [finding(["SHIFT_REVIEW_BRIEFING", "INVENTORY_REVIEW_PRIORITY", "PROFIT_CHANGE_MATERIAL"][index]!)];
    return { caseId: `case-${index + 1}`, agentKey, deterministic, assisted: deterministic.map(row => ({ ...row, aiExplanation: "The same verified issue is explained clearly." })), modelFailureFallback: structuredClone(deterministic), modelDurationMs: 100 + index, fallbackUsed: false };
  });
  const report = evaluateSpecialistPilot(cases, { minimumIssueIdentification: 1, minimumPriorityClarity: 1, minimumEvidenceOpenability: 1, minimumFindingPreservationOnModelFailure: 1, maximumFallbackRate: .05, maximumP95ModelLatencyMs: 7000 });
  assert.equal(report.passed, true); assert.equal(report.sameFrozenFindings, true); assert.equal(report.findingPreservationOnModelFailure, 1); assert.equal(report.evidenceOpenability, 1);
});

test("pilot gate fails when the model path loses a finding or evidence", () => {
  const base = finding("INVENTORY_LOW");
  const report = evaluateSpecialistPilot([{ caseId: "loss", agentKey: "inventory-watch", deterministic: [base], assisted: [{ ...base, supportingRecords: [] }], modelFailureFallback: [], modelDurationMs: 10, fallbackUsed: true }], { minimumIssueIdentification: 1, minimumPriorityClarity: 1, minimumEvidenceOpenability: 1, minimumFindingPreservationOnModelFailure: 1, maximumFallbackRate: .05, maximumP95ModelLatencyMs: 7000 });
  assert.equal(report.passed, false); assert.equal(report.evidenceOpenability, 0); assert.equal(report.findingPreservationOnModelFailure, 0);
});
