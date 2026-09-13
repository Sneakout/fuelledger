import type { AgentFact, AgentNarrative, FactPacket } from "../../runtime-contracts.ts";
import type { EvidenceReference, FindingSeverity, JsonObject, JsonValue, ToolResult } from "../../contracts.ts";
import { agentNarrativeSchema } from "../../narrative-validation.ts";

export type FuelNerveFindingValue = JsonObject & {
  findingType: string;
  severity: FindingSeverity;
  title: string;
  whyItMatters: string;
  stationId: string;
  periodStart: string;
  periodEnd: string;
  calculatedAt: string;
  recommendedNextStep: string;
  displayValue: JsonValue;
  sourceKey?: string;
  priorityRank?: number;
  priorityReason?: string;
  recordsToCompare?: JsonValue[];
  relatedContext?: JsonValue;
  unverified?: JsonValue[];
};

export const findingFact = (input: Omit<FuelNerveFindingValue, keyof JsonObject> & FuelNerveFindingValue, evidenceIds: string[]): AgentFact => ({
  factId: `${input.findingType.toLowerCase().replaceAll("_", "-")}:${input.stationId}:${input.sourceKey ?? "scope"}:${evidenceIds.join("+")}`,
  label: input.title,
  value: input,
  evidenceIds,
});

export function resultItems(result: ToolResult): JsonObject[] {
  return Array.isArray(result.output.items) ? result.output.items.filter(item => item && typeof item === "object" && !Array.isArray(item)) as JsonObject[] : [];
}

export function evidenceForStation(result: ToolResult, stationId: string): EvidenceReference[] {
  return result.evidence.filter(item => item.resourceId.startsWith(`${stationId}:`));
}

export function factPacket(facts: AgentFact[], results: ToolResult[]): FactPacket {
  const used = new Set(facts.flatMap(fact => fact.evidenceIds));
  return { facts, evidence: results.flatMap(result => result.evidence).filter(item => used.has(item.evidenceId)) };
}

export function deterministicNarrative(title: string, facts: FactPacket, emptySummary: string): AgentNarrative {
  if (!facts.facts.length) return { headline: title, summary: emptySummary, claims: [] };
  return {
    headline: title,
    summary: `${facts.facts.length} evidence-backed item${facts.facts.length === 1 ? "" : "s"} require review.`,
    claims: facts.facts.map((fact, index) => ({ claimId: `deterministic-${index + 1}`, text: fact.label, factIds: [fact.factId], evidenceIds: fact.evidenceIds })),
  };
}

export const validateNarrative = agentNarrativeSchema;
export const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
export const booleanValue = (value: unknown) => value === true;
export const textValue = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
export const objectValue = (value: unknown): JsonObject | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
export const arrayObjects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as JsonObject[] : [];
export const stringValues = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
