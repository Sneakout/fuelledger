import { createHash } from "node:crypto";
import { agentPresentation } from "./agent-presentation.js";
import type { BriefingFact } from "./daily-briefing.js";

const definitions = [
  { agentKey: "reconciliation-review", categories: ["SHIFT"] },
  { agentKey: "inventory-watch", categories: ["STOCK"] },
  { agentKey: "credit-watch", categories: ["CREDIT"] },
  { agentKey: "purchase-check", categories: ["PURCHASES"] },
  { agentKey: "profit-insight", categories: ["PROFIT", "SALES"] },
  { agentKey: "business-assistant", categories: ["*"] },
] as const;

export function demoAgentFindings(input: { organizationId: string; stationId: string; generatedAt: string; facts: BriefingFact[] }) {
  const agents = definitions.map(definition => {
    const agent = agentPresentation(definition.agentKey);
    const matchedFacts = definition.categories[0] === "*" ? input.facts.slice(0, 1) : input.facts.filter(fact => (definition.categories as readonly string[]).includes(fact.category));
    const findings = matchedFacts.map((fact, index) => ({
      findingId: stableUuid(`${input.organizationId}:${input.stationId}:${definition.agentKey}:${fact.id}`),
      type: `DEMO_${fact.category}_${fact.id}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
      severity: fact.severity === "URGENT" || fact.severity === "ATTENTION" ? fact.severity : "INFORMATION" as const,
      title: definition.agentKey === "business-assistant" ? "Your owner view is ready" : fact.label,
      agent,
      whyItMatters: definition.agentKey === "business-assistant" ? `${input.facts.length} verified business signal${input.facts.length === 1 ? " is" : "s are"} available across your specialists.` : fact.context,
      recommendedNextStep: definition.agentKey === "business-assistant" ? "Start with the highest-priority supporting record." : `Open ${fact.evidenceLabel.toLowerCase()} and review the saved record.`,
      displayValue: definition.agentKey === "business-assistant" ? `${input.facts.length} signal${input.facts.length === 1 ? "" : "s"}` : fact.value,
      calculatedAt: input.generatedAt, priorityRank: index + 1,
      priorityReason: index === 0 ? "This is the first verified item for this specialist." : "Shown after higher-priority verified items.",
      recordsToCompare: [fact.evidenceLabel], evidence: [{ label: fact.evidenceLabel, resolverPath: fact.evidencePath }],
    }));
    return { ...agent, runId: stableUuid(`${input.organizationId}:${input.stationId}:${definition.agentKey}:${input.generatedAt.slice(0, 10)}`), status: findings.some(finding => finding.severity === "URGENT") ? "NEEDS_ATTENTION" as const : findings.length ? "FINDINGS" as const : "ALL_CLEAR" as const, lastCompletedAt: input.generatedAt, findings };
  });
  const findings = agents.flatMap(agent => agent.findings);
  return { mode: "READ_ONLY" as const, sourceMode: "VERIFIED_DEMO" as const, generatedAt: input.generatedAt, stale: false, safety: { evidenceVerified: true, crossTenantDenied: true, crossStationDenied: true, offlineSafe: true, proposalsEnabled: false as const, actionsEnabled: false as const }, summary: { agents: agents.length, findings: findings.length, urgent: findings.filter(finding => finding.severity === "URGENT").length }, agents };
}

function stableUuid(value: string) {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hash[12] = "4"; hash[16] = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  const text = hash.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
