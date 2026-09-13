import type { AgentDefinition } from "../../runtime-contracts.ts";
import type { JsonObject, ToolResult } from "../../contracts.ts";
import { booleanValue, deterministicNarrative, evidenceForStation, factPacket, findingFact, numberValue, resultItems, stringValues, textValue, validateNarrative } from "./shared.ts";

export function createStockWatchAgent(): AgentDefinition {
  return {
    agentKey: "inventory-watch", agentVersion: "1.0.0", promptVersion: "inventory-watch.prompt@1",
    description: "Reviews FuelNerve-calculated stock, physical readings, receipt timing, movements, and density status.",
    instructions: "Explain only supplied inventory facts. Never calculate stock, variance, or receipt timing. Do not propose an adjustment. Cite supplied fact and evidence IDs.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: ["inventory.position.read", "fuelnerve.receipt-timing.read"], maxToolCalls: 2, maxOutputTokens: 400,
    plan: (input, context) => ["inventory.position.read", "fuelnerve.receipt-timing.read"].map(toolId => ({ toolId, input: scopeInput(input, context.permittedLocationIds) })),
    buildFacts(results) {
      const inventory = results.find(row => row.toolId === "inventory.position.read")!;
      const receipt = results.find(row => row.toolId === "fuelnerve.receipt-timing.read")!;
      const facts = [...resultItems(inventory).flatMap(item => inventoryFacts(item, inventory)), ...resultItems(receipt).flatMap(item => receiptFacts(item, receipt))];
      return factPacket(facts, results);
    },
    validateOutput: validateNarrative,
    deterministicFallback: facts => deterministicNarrative("Stock watch", facts, "FuelNerve reported no stock exceptions for this scope."),
  };
}

function inventoryFacts(item: JsonObject, result: ToolResult) {
  const stationId = String(item.stationId ?? "unknown"), evidenceIds = evidenceForStation(result, stationId).map(row => row.evidenceId);
  const common = { stationId, sourceKey: String(item.tankId ?? item.productId ?? "scope"), periodStart: result.calculatedAt, periodEnd: result.calculatedAt, calculatedAt: result.calculatedAt };
  const facts = [];
  const status = textValue(item.stockStatus);
  const priorityReasons = stringValues(item.priorityReasons);
  if (numberValue(item.priorityRank) === 1 && priorityReasons.length) {
    const tank = `${textValue(item.productCode, "Tank")} ${textValue(item.tankCode)}`.trim();
    facts.push(findingFact({ ...common, findingType: "INVENTORY_REVIEW_PRIORITY", severity: status === "EMPTY" ? "URGENT" : "ATTENTION", title: `${tank} needs attention first`, whyItMatters: `FuelNerve ranked this position first because ${priorityReasons.join("; ").toLowerCase()}.`, recommendedNextStep: "Compare its physical reading, movements, recent receipts, and approved adjustments before deciding what happened.", displayValue: { tank, stockStatus: status, bookStock: item.bookStock ?? 0, variance: item.variance ?? null, relatedMovements: item.relatedMovements ?? {}, recentReceipts: item.recentReceipts ?? [], ambiguousReceipts: item.ambiguousReceipts ?? [] }, priorityRank: 1, priorityReason: priorityReasons.join("; "), relatedContext: { movements: item.relatedMovements ?? {}, recentReceipts: item.recentReceipts ?? [], ambiguousReceipts: item.ambiguousReceipts ?? [] }, unverified: stringValues(item.unverified) }, evidenceIds));
  }
  if (status === "LOW" || status === "EMPTY") facts.push(findingFact({ ...common, findingType: status === "EMPTY" ? "INVENTORY_EMPTY" : "INVENTORY_LOW", severity: status === "EMPTY" ? "URGENT" : "ATTENTION", title: status === "EMPTY" ? "Stock is empty" : "Stock is low", whyItMatters: "FuelNerve's time-aware stock service marked this position for attention.", recommendedNextStep: "Open the stock timeline and verify planned receipts.", displayValue: item.bookStock ?? 0 }, evidenceIds));
  if (booleanValue(item.varianceRequiresReview)) facts.push(findingFact({ ...common, findingType: "PHYSICAL_BOOK_VARIANCE", severity: "ATTENTION", title: "Physical and book stock differ", whyItMatters: "FuelNerve reported a variance above the configured review tolerance.", recommendedNextStep: "Compare the physical reading with the stock timeline; do not adjust automatically.", displayValue: item.variance ?? 0 }, evidenceIds));
  if (booleanValue(item.unusualMovement)) facts.push(findingFact({ ...common, findingType: "INVENTORY_MOVEMENT_UNUSUAL", severity: "ATTENTION", title: "Stock movement needs review", whyItMatters: stringValues(item.unusualMovementReasons).join("; ") || "FuelNerve marked movement outside its configured pattern.", recommendedNextStep: "Inspect the identified ledger entries and compare them with the source receipt, metered sale, or approved adjustment.", displayValue: { reasons: item.unusualMovementReasons ?? [], sample: item.movementSample ?? {} } }, evidenceIds));
  if (item.runoutEstimate && typeof item.runoutEstimate === "object" && !Array.isArray(item.runoutEstimate)) {
    const estimate = item.runoutEstimate as JsonObject;
    facts.push(findingFact({ ...common, findingType: "INVENTORY_RUNOUT_ESTIMATE", severity: numberValue(estimate.estimatedDaysRemaining) <= 2 ? "URGENT" : "ATTENTION", title: "Consumption-based runout estimate", whyItMatters: textValue(estimate.assumption), recommendedNextStep: "Compare the estimate with confirmed incoming deliveries and recent demand before planning replenishment.", displayValue: estimate }, evidenceIds));
  }
  if (booleanValue(item.densityMissing)) facts.push(findingFact({ ...common, findingType: "DENSITY_READING_MISSING", severity: "ATTENTION", title: "Morning density is missing", whyItMatters: "The daily fuel-quality record is incomplete.", recommendedNextStep: "Open inventory and enter the verified density reading.", displayValue: "MISSING" }, evidenceIds));
  return facts;
}

function receiptFacts(item: JsonObject, result: ToolResult) {
  if (!booleanValue(item.anomaly)) return [];
  const stationId = String(item.stationId ?? "unknown"), evidenceIds = evidenceForStation(result, stationId).map(row => row.evidenceId);
  return [findingFact({ findingType: "RECEIPT_TIMING_ANOMALY", severity: "ATTENTION", title: "Receipt timing needs review", whyItMatters: "FuelNerve's receipt-timing audit marked a potentially ambiguous physical receipt time.", stationId, sourceKey: String(item.receiptId ?? "scope"), periodStart: result.calculatedAt, periodEnd: result.calculatedAt, calculatedAt: result.calculatedAt, recommendedNextStep: "Open the receipt-timing audit and verify the source document and physical arrival time.", displayValue: item.candidateCount ?? 1 }, evidenceIds)];
}

const scopeInput = (input: JsonObject, locations: string[]): JsonObject => ({ locationIds: locations, asOf: typeof input.asOf === "string" ? input.asOf : new Date().toISOString() });
