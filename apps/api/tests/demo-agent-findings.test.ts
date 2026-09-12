import { describe, expect, it } from "vitest";
import { demoAgentFindings } from "../src/modules/intelligence/demo-agent-findings.js";

describe("production demo agent findings", () => {
  it("presents all six read-only specialists from verified briefing facts", () => {
    const response = demoAgentFindings({
      organizationId: "org-demo",
      stationId: "station-demo",
      generatedAt: "2026-09-12T08:00:00.000Z",
      facts: [
        { id: "open-shifts", category: "SHIFT", severity: "ATTENTION", label: "Open shifts", value: "1", context: "One shift still needs a handover.", evidenceLabel: "Open shift records", evidencePath: "/operations" },
        { id: "tank-ms", category: "STOCK", severity: "URGENT", label: "MS Tank 1", value: "0 L", context: "Book stock is empty.", evidenceLabel: "Tank stock timeline", evidencePath: "/inventory" },
        { id: "sales", category: "SALES", severity: "POSITIVE", label: "Sales today", value: "₹5,110", context: "Sales are above yesterday.", evidenceLabel: "Sales records", evidencePath: "/sales" },
      ],
    });
    expect(response.agents).toHaveLength(6);
    expect(response.safety).toMatchObject({ evidenceVerified: true, crossStationDenied: true, proposalsEnabled: false, actionsEnabled: false });
    expect(response.agents.find(agent => agent.agentKey === "inventory-watch")).toMatchObject({ status: "NEEDS_ATTENTION", findings: [{ title: "MS Tank 1", evidence: [{ resolverPath: "/inventory" }] }] });
    expect(response.agents.find(agent => agent.agentKey === "business-assistant")).toMatchObject({ status: "FINDINGS", findings: [{ title: "Your owner view is ready", displayValue: "3 signals" }] });
    expect(response.agents.flatMap(agent => agent.findings).every(finding => /^[0-9a-f-]{36}$/.test(finding.findingId))).toBe(true);
  });

  it("uses stable identifiers so refreshing the demo does not duplicate findings", () => {
    const input = { organizationId: "org-demo", stationId: "station-demo", generatedAt: "2026-09-12T08:00:00.000Z", facts: [{ id: "credit", category: "CREDIT", severity: "ATTENTION" as const, label: "Customer balances", value: "₹1,590", context: "Customer balances remain outstanding.", evidenceLabel: "Customer ledgers", evidencePath: "/customers" }] };
    expect(demoAgentFindings(input).agents[2]!.findings[0]!.findingId).toBe(demoAgentFindings(input).agents[2]!.findings[0]!.findingId);
  });
});
