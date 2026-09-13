import type { AgentDefinition, AgentFact } from "../../runtime-contracts.ts";
import type { JsonObject } from "../../contracts.ts";
import { AgentSdkError } from "../../errors.ts";
import { deterministicNarrative, factPacket, validateNarrative } from "./shared.ts";
import { createShiftReviewAgent } from "./shift-review.ts";
import { createStockWatchAgent } from "./stock-watch.ts";
import { createProfitInsightAgent } from "./profit-insight.ts";
import { createCreditAgent } from "./credit-watch.ts";
import { createPurchaseAgent } from "./purchase-check.ts";

export const ownerAssistantIntents = ["TODAY_OVERVIEW", "STOCK_POSITION", "OPEN_SHIFTS", "COLLECTIONS", "PROFIT", "CUSTOMER_DUES", "SUPPLIER_DUES", "PURCHASE_REVIEW"] as const;
export const ownerAssistantFollowUps = ["GIVE_DETAILS", "WHY_FIRST", "SHOW_RECORDS"] as const;
export type OwnerAssistantIntent = typeof ownerAssistantIntents[number];
export type OwnerAssistantFollowUp = typeof ownerAssistantFollowUps[number];

export function matchOwnerAssistantIntent(question: string): OwnerAssistantIntent | null {
  const value = question.toLowerCase();
  if (/duplicate invoice|purchase|delivery|received quantity|supplier rate/.test(value)) return "PURCHASE_REVIEW";
  if (/stock|tank|inventory|litre|fuel level/.test(value)) return "STOCK_POSITION";
  if (/open shift|shift.*open|close.*shift|handover/.test(value)) return "OPEN_SHIFTS";
  if (/collection|cash|upi|card|payment mode|collected/.test(value)) return "COLLECTIONS";
  if (/profit|margin|earning|cost of sale/.test(value)) return "PROFIT";
  if (/customer|receivable|credit|fleet|owe us|owes us|due from/.test(value)) return "CUSTOMER_DUES";
  if (/supplier|vendor|payable|invoice due|we owe/.test(value)) return "SUPPLIER_DUES";
  if (/today|overview|how.*doing|performance|business|attention/.test(value)) return "TODAY_OVERVIEW";
  return null;
}

export function matchOwnerAssistantFollowUp(question: string): OwnerAssistantFollowUp | null {
  const value = question.trim().toLowerCase();
  if (/^(give me )?(more )?details[?.!]*$/.test(value)) return "GIVE_DETAILS";
  if (/^why (is this )?first[?.!]*$/.test(value)) return "WHY_FIRST";
  if (/^(show|open)( me)? (the )?(records|evidence)[?.!]*$/.test(value)) return "SHOW_RECORDS";
  return null;
}

const specialistTools = ["fuelnerve.reconciliation-status.read", "inventory.position.read", "fuelnerve.receipt-timing.read", "profit.summary.read", "receivables.ageing.read", "purchases.review.read"] as const;
const specialistGroups = [createShiftReviewAgent(), createStockWatchAgent(), createProfitInsightAgent(), createCreditAgent(), createPurchaseAgent()];
const intentTools: Record<OwnerAssistantIntent, readonly string[]> = {
  TODAY_OVERVIEW: specialistTools, STOCK_POSITION: ["inventory.position.read", "fuelnerve.receipt-timing.read"], OPEN_SHIFTS: ["fuelnerve.reconciliation-status.read"], COLLECTIONS: ["fuelnerve.reconciliation-status.read"],
  PROFIT: ["profit.summary.read"], CUSTOMER_DUES: ["receivables.ageing.read"], SUPPLIER_DUES: ["purchases.review.read"], PURCHASE_REVIEW: ["purchases.review.read"],
};

export function createOwnerAssistantAgent(): AgentDefinition {
  return {
    agentKey: "business-assistant", agentVersion: "2.0.0", promptVersion: "business-assistant.prompt@2",
    description: "Coordinates read-only answers across the five FuelNerve specialists for one station and snapshot.",
    instructions: "Answer only from supplied specialist facts. Honor assistantSnapshot.followUp: give concise verified detail, explain why the first ranked fact is first, or identify its exact supporting records. Combine related facts, disclose stale or missing data, and cite exact evidence. Never alter records, infer unsupported causes, or cross station scope.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: [...specialistTools], maxToolCalls: 6, maxOutputTokens: 500,
    plan(input, context) {
      if (context.permittedLocationIds.length !== 1) throw new AgentSdkError("LOCATION_DENIED", "Owner Assistant requires exactly one permitted station for each answer.");
      const question = typeof input.question === "string" ? input.question : "", intent = matchOwnerAssistantIntent(question), followUp = matchOwnerAssistantFollowUp(question);
      if (!intent && !followUp) return [];
      const asOf = typeof input.asOf === "string" ? input.asOf : new Date().toISOString(), tools = followUp ? specialistTools : intentTools[intent!];
      return tools.map(toolId => ({ toolId, input: { locationIds: [context.permittedLocationIds[0]!], asOf, ...(typeof input.startDate === "string" ? { startDate: input.startDate } : {}), ...(typeof input.endDate === "string" ? { endDate: input.endDate } : {}) } }));
    },
    buildFacts(results, context, input) {
      if (!results.length) return { facts: [], evidence: [] };
      const snapshotDates = new Set(results.map(row => typeof row.output.asOf === "string" ? row.output.asOf : row.calculatedAt));
      const inconsistentSnapshot = snapshotDates.size !== 1;
      const returned = new Set(results.map(row => row.toolId));
      const expectedAll = results.length > 1;
      const missingSpecialists = expectedAll ? specialistGroups.filter(agent => !agent.allowedToolIds.every(tool => returned.has(tool))).map(agent => agent.agentKey) : [];
      const question = typeof input?.question === "string" ? input.question : "";
      const followUp = matchOwnerAssistantFollowUp(question);
      const facts = prioritize(deduplicate(specialistGroups.flatMap(specialist => {
        const specialistResults = results.filter(result => specialist.allowedToolIds.includes(result.toolId));
        if (!specialistResults.length || specialistResults.length !== specialist.allowedToolIds.length) return [];
        return specialist.buildFacts(specialistResults, context, input).facts.map(fact => assistantFact(fact, context.permittedLocationIds[0]!, [...snapshotDates][0]!, inconsistentSnapshot, missingSpecialists, followUp));
      })));
      return factPacket(facts, results);
    },
    validateOutput: validateNarrative,
    deterministicFallback: facts => ownerFallback(facts),
  };
}

function ownerFallback(facts: Parameters<typeof deterministicNarrative>[1]) {
  if (!facts.facts.length) return deterministicNarrative("Nerve Assistant", facts, "I can’t answer that from the five supported specialist workflows. Ask about shifts, stock, profit, customer credit, supplier purchases, or request details, priority, or records.");
  const firstValue = facts.facts[0]!.value as JsonObject;
  const snapshot = firstValue.assistantSnapshot as JsonObject | undefined;
  if (snapshot?.followUp === "WHY_FIRST") return deterministicNarrative(facts.facts[0]!.label, { facts: [facts.facts[0]!], evidence: facts.evidence.filter(item => facts.facts[0]!.evidenceIds.includes(item.evidenceId)) }, "No ranked item is available.");
  if (snapshot?.followUp === "SHOW_RECORDS") return deterministicNarrative("Supporting records", facts, "No supporting records are available.");
  if (snapshot?.followUp === "GIVE_DETAILS") return deterministicNarrative("Details from the five specialists", facts, "No verified details are available.");
  return deterministicNarrative("Nerve Assistant", facts, "No verified facts are available.");
}

function assistantFact(fact: AgentFact, stationId: string, snapshotDate: string, inconsistentSnapshot: boolean, missingSpecialists: readonly string[], followUp: OwnerAssistantFollowUp | null): AgentFact {
  const item = fact.value && typeof fact.value === "object" && !Array.isArray(fact.value) ? fact.value as JsonObject : { displayValue: fact.value };
  return { factId: `owner-answer:${fact.factId}`, label: fact.label, value: { ...item, assistantSnapshot: { stationId, snapshotDate, calculatedAt: item.calculatedAt ?? snapshotDate, inconsistentSnapshot, missingSpecialists: [...missingSpecialists], ...(followUp ? { followUp } : {}) } }, evidenceIds: fact.evidenceIds };
}

function deduplicate(facts: AgentFact[]) {
  const seen = new Set<string>();
  return facts.filter(fact => { const value = fact.value as JsonObject; const key = [value.stationId, value.findingType, value.type, value.sourceKey, value.shiftId, value.tankId, value.customerId, value.invoiceId, value.receiptId, value.lineId].filter(Boolean).join(":") || fact.factId; if (seen.has(key)) return false; seen.add(key); return true; });
}

function prioritize(facts: AgentFact[]) {
  const severity = (value: JsonObject) => value.severity === "CRITICAL" ? 0 : value.severity === "ATTENTION" ? 1 : 2;
  return facts.map((fact, index) => ({ fact, index })).sort((left, right) => {
    const a = left.fact.value as JsonObject, b = right.fact.value as JsonObject;
    const aRank = typeof a.priorityRank === "number" ? a.priorityRank : Number.MAX_SAFE_INTEGER;
    const bRank = typeof b.priorityRank === "number" ? b.priorityRank : Number.MAX_SAFE_INTEGER;
    return aRank - bRank || severity(a) - severity(b) || left.index - right.index;
  }).map(row => row.fact);
}
