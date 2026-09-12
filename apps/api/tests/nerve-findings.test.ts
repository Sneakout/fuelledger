import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nerveFindings, nerveFindingSources } from "../src/modules/intelligence/nerve-findings.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("local Nerve findings", () => {
  it("presents only evidence-backed, actionless findings for the exact scope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-findings-")); directories.push(directory); const reportPath = join(directory, "report.json");
    await writeFile(reportPath, JSON.stringify({ mode: "SHADOW", visibility: "HIDDEN", proposalsEnabled: false, actionsEnabled: false, generatedAt: new Date().toISOString(), scope: { organizationId: "org-a", stationId: "station-a" }, isolation: { crossTenantDenied: true, crossStationDenied: true }, offline: { failedClosed: true, fuelNerveUnaffected: true }, results: [{ agentKey: "inventory-watch", runId: "run-1", findings: [{ findingId: "finding-1", type: "INVENTORY_EMPTY", title: "Stock is empty", summary: JSON.stringify({ severity: "URGENT", whyItMatters: "No stock remains.", recommendedNextStep: "Review receipts.", displayValue: 0, calculatedAt: new Date().toISOString() }), detectedAt: new Date().toISOString(), visibility: "SHADOW", proposalIds: [], actionIds: [], evidence: [{ label: "Inventory", resolverPath: "/inventory" }] }] }] }));
    const result = await nerveFindings({ reportPath, organizationId: "org-a", stationId: "station-a" });
    expect(result.summary).toEqual({ agents: 1, findings: 1, urgent: 1 });
    expect(result.agents).toHaveLength(1);
    expect(result.safety.actionsEnabled).toBe(false);
    expect(result.agents[0]).toMatchObject({ agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock", status: "NEEDS_ATTENTION" });
    expect(Date.parse(result.agents[0]!.lastCompletedAt)).not.toBeNaN();
    expect(result.agents[0]?.findings[0]?.agent).toEqual({ agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock" });
    expect(result.agents[0]?.findings[0]?.whyItMatters).toBe("No stock remains.");
    await expect(nerveFindings({ reportPath, organizationId: "org-b", stationId: "station-a" })).rejects.toMatchObject({ code: "NERVE_REPORT_SCOPE_MISMATCH" });
  });

  it("uses a neutral identity for an unknown agent type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-findings-")); directories.push(directory); const reportPath = join(directory, "report.json");
    await writeFile(reportPath, JSON.stringify({ mode: "SHADOW", visibility: "HIDDEN", proposalsEnabled: false, actionsEnabled: false, generatedAt: new Date().toISOString(), scope: { organizationId: "org-a", stationId: "station-a" }, isolation: { crossTenantDenied: true, crossStationDenied: true }, offline: { failedClosed: true, fuelNerveUnaffected: true }, results: [{ agentKey: "future-agent", runId: "run-1", findings: [{ findingId: "finding-1", type: "REVIEW", title: "Review needed", summary: "{}", detectedAt: new Date().toISOString(), visibility: "SHADOW", proposalIds: [], actionIds: [], evidence: [{ label: "Records", resolverPath: "/reports" }] }] }] }));
    const result = await nerveFindings({ reportPath, organizationId: "org-a", stationId: "station-a" });
    expect(result.agents[0]).toMatchObject({ agentKey: "future-agent", name: "Nerve Specialist", purpose: "Reviews relevant business records", icon: "specialist" });
    expect(result.agents[0]?.findings[0]?.agent.name).toBe("Nerve Specialist");
  });

  it("fails closed for a malformed or action-enabled report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-findings-")); directories.push(directory); const reportPath = join(directory, "report.json");
    await writeFile(reportPath, JSON.stringify({ actionsEnabled: true }));
    await expect(nerveFindings({ reportPath, organizationId: "org-a", stationId: "station-a" })).rejects.toMatchObject({ code: "NERVE_REPORT_UNAVAILABLE" });
  });

  it("shows an old review for awareness but rejects attempts to investigate its stale findings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-findings-")); directories.push(directory); const reportPath = join(directory, "report.json");
    const generatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeFile(reportPath, JSON.stringify({ mode: "SHADOW", visibility: "HIDDEN", proposalsEnabled: false, actionsEnabled: false, generatedAt, scope: { organizationId: "org-a", stationId: "station-a" }, isolation: { crossTenantDenied: true, crossStationDenied: true }, offline: { failedClosed: true, fuelNerveUnaffected: true }, results: [{ agentKey: "inventory-watch", runId: "run-old", findings: [{ findingId: "finding-old", type: "INVENTORY_EMPTY", title: "Old stock finding", summary: "{}", detectedAt: generatedAt, visibility: "SHADOW", proposalIds: [], actionIds: [], evidence: [{ label: "Inventory", resolverPath: "/inventory" }] }] }] }));
    expect((await nerveFindings({ reportPath, organizationId: "org-a", stationId: "station-a" })).stale).toBe(true);
    await expect(nerveFindingSources({ reportPath, organizationId: "org-a", stationId: "station-a", findingIds: ["finding-old"] })).rejects.toMatchObject({ code: "NERVE_FINDING_STALE" });
  });
});
