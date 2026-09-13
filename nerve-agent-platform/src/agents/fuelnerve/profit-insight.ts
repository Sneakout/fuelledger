import type { AgentDefinition } from "../../runtime-contracts.ts";
import type { JsonObject, ToolResult } from "../../contracts.ts";
import { booleanValue, deterministicNarrative, evidenceForStation, factPacket, findingFact, objectValue, resultItems, stringValues, textValue, validateNarrative } from "./shared.ts";

export function createProfitInsightAgent(): AgentDefinition {
  return {
    agentKey: "profit-insight", agentVersion: "1.0.0", promptVersion: "profit-insight.prompt@1",
    description: "Explains FuelNerve journal-derived profit and application-calculated comparisons and contributions.",
    instructions: "Explain only supplied accounting facts. Never recalculate amounts or infer causes. Clearly label changes as items to investigate and cite supplied fact and evidence IDs.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: ["profit.summary.read"], maxToolCalls: 1, maxOutputTokens: 400,
    plan: (input, context) => [{ toolId: "profit.summary.read", input: { locationIds: context.permittedLocationIds, asOf: typeof input.asOf === "string" ? input.asOf : new Date().toISOString(), ...(typeof input.startDate === "string" ? { startDate: input.startDate } : {}), ...(typeof input.endDate === "string" ? { endDate: input.endDate } : {}) } }],
    buildFacts(results) {
      const result = results[0]!;
      const facts = resultItems(result).flatMap(item => profitFacts(item, result));
      return factPacket(facts, results);
    },
    validateOutput: validateNarrative,
    deterministicFallback: facts => deterministicNarrative("Profit insight", facts, "No material profit change was reported for this scope."),
  };
}

function profitFacts(item: JsonObject, result: ToolResult) {
  const stationId = String(item.stationId ?? "unknown"), evidenceIds = evidenceForStation(result, stationId).map(row => row.evidenceId);
  const reportPeriod = objectValue(item.reportPeriod);
  const common = {
    stationId,
    periodStart: String(reportPeriod?.startDate ?? result.output.startDate ?? result.calculatedAt),
    periodEnd: String(reportPeriod?.endDate ?? result.output.endDate ?? result.calculatedAt),
    calculatedAt: result.calculatedAt,
  };
  const quality = objectValue(item.reportQuality), contributions = objectValue(item.observedContributions);
  const facts = [findingFact({ ...common, findingType: "PROFIT_POSITION", severity: "INFORMATION", title: "Journal-derived profit position", whyItMatters: "These amounts come from FuelNerve's posted report; fuel and non-fuel figures are observed sales-revenue contributions, not profit attribution.", recommendedNextStep: "Open the profit report to inspect source journals and the recorded sales mix.", displayValue: { revenue: item.revenue ?? 0, cogs: item.cogs ?? 0, operatingExpenses: item.operatingExpenses ?? 0, netProfit: item.netProfit ?? 0, topProduct: item.topProduct ?? null, topProductContribution: item.topProductContribution ?? null, stationContribution: item.stationContribution ?? null, observedContributions: contributions ?? {}, reportQuality: quality ?? {} }, recordsToCompare: ["Posted revenue journals", "Cost-of-sales journals", "Operating-expense journals", "Recorded product sales"], unverified: stringValues(item.unverified) }, evidenceIds)];
  if (quality && (!booleanValue(quality.periodComplete) || booleanValue(quality.missingCostOfSales))) {
    const issues = [textValue(quality.incompleteReason), textValue(quality.missingCostReason)].filter(Boolean);
    facts.push(findingFact({ ...common, findingType: "PROFIT_DATA_INCOMPLETE", severity: "ATTENTION", title: "Profit period needs a completeness check", whyItMatters: issues.join(" "), recommendedNextStep: booleanValue(quality.missingCostOfSales) ? "Open the profit report and verify that the period's cost-of-sales journals have been posted before relying on profit." : "Wait until the selected period closes or compare only completed business days.", displayValue: quality, recordsToCompare: ["Selected report period", "Sales records", "Cost-of-sales journals"] }, evidenceIds));
  }
  if (booleanValue(item.materialChange)) {
    const leadingComponent = textValue(item.leadingComponent, "financial result"), reasons = stringValues(item.priorityReasons);
    facts.push(findingFact({ ...common, findingType: "PROFIT_CHANGE_MATERIAL", severity: "ATTENTION", title: `Review ${leadingComponent.toLowerCase()} movement first`, whyItMatters: `${reasons.length ? `FuelNerve prioritized this because ${reasons.join("; ").toLowerCase()}. ` : "FuelNerve's period comparison crossed its configured materiality threshold. "}This is an observed change, not a proven cause.`, recommendedNextStep: `Open the profit report and inspect the posted journals behind ${leadingComponent.toLowerCase()} before drawing a conclusion.`, displayValue: { revenue: item.revenue ?? 0, cogs: item.cogs ?? 0, operatingExpenses: item.operatingExpenses ?? 0, netProfit: item.netProfit ?? 0, componentMovements: item.componentMovements ?? [], leadingComponent, leadingComponentChange: item.leadingComponentChange ?? 0, observedContributions: contributions ?? {}, relatedPostedAccounts: item.relatedPostedAccounts ?? [] }, priorityRank: 1, priorityReason: reasons.join("; "), recordsToCompare: ["Current profit report", "Equivalent previous-period profit report", "Related posted journals", "Recorded product sales"], relatedContext: { componentMovements: item.componentMovements ?? [], observedContributions: contributions ?? {}, possibleCauses: item.possibleCauses ?? [], relatedPostedAccounts: item.relatedPostedAccounts ?? [] }, unverified: stringValues(item.unverified).length ? stringValues(item.unverified) : ["Operational cause of the change"] }, evidenceIds));
  }
  return facts;
}
