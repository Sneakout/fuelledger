import type { AgentDefinition } from "../../runtime-contracts.ts";
import type { JsonObject, ToolResult } from "../../contracts.ts";
import { booleanValue, deterministicNarrative, evidenceForStation, factPacket, findingFact, numberValue, objectValue, resultItems, stringValues, validateNarrative } from "./shared.ts";

export function createShiftReviewAgent(): AgentDefinition {
  return {
    agentKey: "reconciliation-review", agentVersion: "1.0.0", promptVersion: "reconciliation-review.prompt@1",
    description: "Reviews FuelNerve shifts, readings, handovers, collections, and reconciliation state.",
    instructions: "Explain only supplied shift facts. Do not infer causes, recalculate values, or propose changes. Every claim must cite supplied fact and evidence IDs.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: ["fuelnerve.reconciliation-status.read"], maxToolCalls: 1, maxOutputTokens: 350,
    plan: (input, context) => [{ toolId: "fuelnerve.reconciliation-status.read", input: scopeInput(input, context.permittedLocationIds) }],
    buildFacts(results) {
      const result = results[0]!;
      const facts = resultItems(result).flatMap(item => shiftFacts(item, result));
      return factPacket(facts, results);
    },
    validateOutput: validateNarrative,
    deterministicFallback: facts => deterministicNarrative("Shift review", facts, "No shift exceptions were reported for this scope."),
  };
}

function shiftFacts(item: JsonObject, result: ToolResult) {
  const stationId = String(item.stationId ?? "unknown");
  const evidenceIds = evidenceForStation(result, stationId).map(row => row.evidenceId);
  const common = { stationId, periodStart: result.calculatedAt, periodEnd: result.calculatedAt, calculatedAt: result.calculatedAt };
  const facts = [];
  const briefings = Array.isArray(item.shiftBriefings) ? item.shiftBriefings.filter(value => value && typeof value === "object" && !Array.isArray(value)) as JsonObject[] : [];
  if (briefings.length) return briefings.map(shift => groupedShiftFact(shift, result));
  const priority = objectValue(item.priority);
  if (priority && priority.status === "RECONCILIATION_REQUIRED") {
    const shiftNumber = numberValue(priority.shiftNumber), reasons = stringValues(priority.priorityReasons), recordsToCompare = stringValues(priority.recordsToCompare);
    facts.push(findingFact({ ...common, sourceKey: String(priority.shiftId ?? "priority"), findingType: "SHIFT_REVIEW_PRIORITY", severity: numberValue(priority.collectionDifference) > 0 || numberValue(priority.missingReadings) > 0 ? "URGENT" : "ATTENTION", title: `Review Shift ${shiftNumber} first`, whyItMatters: reasons.length ? `FuelNerve ranked this shift first because ${reasons.join("; ").toLowerCase()}.` : "FuelNerve ranked this as the first unreconciled shift to review.", recommendedNextStep: `Compare ${recordsToCompare.length ? recordsToCompare.join(", ").toLowerCase() : "the closing readings, collections, and handover"} before reconciliation.`, displayValue: { shiftNumber, awaitingMinutes: priority.awaitingMinutes ?? 0, absoluteCollectionDifference: priority.collectionDifference ?? 0, missingReadings: priority.missingReadings ?? 0, missingCollections: priority.missingCollections ?? 0, lockState: priority.locked === true ? "LOCKED" : "UNLOCKED" }, priorityRank: 1, priorityReason: reasons.join("; "), recordsToCompare, relatedContext: priority }, evidenceIds));
  }
  if (numberValue(item.openShifts) > 0) {
    const overdue = booleanValue(item.openShiftOverdue);
    facts.push(findingFact({ ...common, findingType: overdue ? "SHIFT_OPEN_OVERDUE" : "SHIFT_OPEN", severity: overdue ? "ATTENTION" : "INFORMATION", title: overdue ? "A shift is overdue for closing" : "A shift remains open", whyItMatters: overdue ? "An overdue open shift delays handover and reconciliation." : "The shift is still operational and has not reached final reconciliation.", recommendedNextStep: "Open the shift record and verify its current status.", displayValue: item.openShifts }, evidenceIds));
  }
  if (numberValue(item.missingReadings) > 0) facts.push(findingFact({ ...common, findingType: "SHIFT_READINGS_MISSING", severity: "ATTENTION", title: "Shift readings are missing", whyItMatters: "Closing and stock review need complete recorded readings.", recommendedNextStep: "Review the shift reading checklist.", displayValue: item.missingReadings ?? 0 }, evidenceIds));
  if (numberValue(item.collectionVariance) !== 0) facts.push(findingFact({ ...common, findingType: "COLLECTION_VARIANCE_DETECTED", severity: "URGENT", title: "Collections differ from expected", whyItMatters: "The application-reported collection variance requires human review.", recommendedNextStep: "Open reconciliation and compare each payment method.", displayValue: item.collectionVariance ?? 0 }, evidenceIds));
  if (numberValue(item.pendingReconciliations) > 0) facts.push(findingFact({ ...common, findingType: "SHIFT_RECONCILIATION_PENDING", severity: "ATTENTION", title: "A shift awaits reconciliation", whyItMatters: "The shift is not fully reviewed and locked.", recommendedNextStep: "Open the pending reconciliation record.", displayValue: item.pendingReconciliations ?? 0 }, evidenceIds));
  if (booleanValue(item.unusualHandover)) facts.push(findingFact({ ...common, findingType: "SHIFT_HANDOVER_UNUSUAL", severity: "ATTENTION", title: "Handover pattern needs review", whyItMatters: "FuelNerve marked this handover outside its configured operating pattern.", recommendedNextStep: "Inspect the opening and closing timestamps and assigned staff.", displayValue: "REVIEW" }, evidenceIds));
  return facts;
}

function groupedShiftFact(shift: JsonObject, result: ToolResult) {
  const stationId = String(shift.stationId ?? "unknown"), shiftId = String(shift.shiftId ?? "unknown"), shiftNumber = numberValue(shift.shiftNumber);
  const issueTypes = stringValues(shift.issueTypes), reasons = stringValues(shift.priorityReasons), recordsToCompare = stringValues(shift.recordsToCompare);
  const evidenceId = typeof shift.evidenceId === "string" ? shift.evidenceId : "";
  const evidenceIds = result.evidence.some(row => row.evidenceId === evidenceId) ? [evidenceId] : evidenceForStation(result, stationId).map(row => row.evidenceId);
  const difference = numberValue(shift.collectionDifference), waiting = numberValue(shift.awaitingMinutes), readings = numberValue(shift.missingReadings), collections = numberValue(shift.missingCollections);
  const details = [`Shift ${shiftNumber} at ${String(shift.stationName ?? stationId)}`, `${waiting} minutes waiting`, ...(difference ? [`collection difference ${money(difference)}`] : []), ...(readings ? [`${readings} missing closing reading${readings === 1 ? "" : "s"}`] : []), ...(collections ? [`${collections} missing collection detail${collections === 1 ? "" : "s"}`] : []), ...(issueTypes.includes("HANDOVER_INCOMPLETE") ? ["handover incomplete"] : [])];
  return findingFact({
    stationId, sourceKey: shiftId, findingType: issueTypes.includes("OPEN_OVERDUE") ? "SHIFT_OPEN_OVERDUE" : "SHIFT_REVIEW_BRIEFING",
    severity: difference > 0 || readings > 0 || issueTypes.includes("OPEN_OVERDUE") ? "URGENT" : "ATTENTION",
    title: issueTypes.includes("OPEN_OVERDUE") ? `Shift ${shiftNumber} is overdue for closing` : `Review Shift ${shiftNumber}`,
    whyItMatters: `${details.join(" · ")}. ${reasons.length ? `Priority: ${reasons.join("; ").toLowerCase()}.` : ""}`.trim(),
    calculatedAt: result.calculatedAt, periodStart: String(shift.openedAt ?? result.calculatedAt), periodEnd: String(shift.closedAt ?? result.calculatedAt),
    recommendedNextStep: `Open Shift ${shiftNumber} and compare ${recordsToCompare.length ? recordsToCompare.join(", ").toLowerCase() : "its readings, collections and handover"}.`,
    displayValue: { shiftId, shiftNumber, stationName: shift.stationName, waitingMinutes: waiting, absoluteCollectionDifference: difference, missingReadings: readings, missingCollections: collections, issueTypes },
    priorityRank: numberValue(shift.priorityRank), priorityReason: reasons.join("; "), recordsToCompare, relatedContext: shift,
  }, evidenceIds);
}

function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value); }

const scopeInput = (input: JsonObject, locations: string[]): JsonObject => ({ locationIds: locations, asOf: typeof input.asOf === "string" ? input.asOf : new Date().toISOString(), ...(typeof input.startDate === "string" ? { startDate: input.startDate } : {}), ...(typeof input.endDate === "string" ? { endDate: input.endDate } : {}) });
