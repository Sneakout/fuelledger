import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("../src/lib/prisma.js", () => ({ prisma: { intelligenceInvestigation: { findFirst } } }));

import { answerInvestigationFollowUp } from "../src/modules/intelligence/investigation-follow-up.js";

const evidence = [
  { evidenceId: "evidence-inventory", evidenceType: "INVENTORY", applicationId: "fuelnerve", tenantId: "org-a", resourceId: "station-a:inventory", label: "Current stock position", observedAt: "2026-09-08T08:00:00.000Z", resolverPath: "/inventory" },
  { evidenceId: "evidence-receipt", evidenceType: "RECEIPT_TIMING", applicationId: "fuelnerve", tenantId: "org-a", resourceId: "station-a:receipt", label: "Receipt timing records", observedAt: "2026-09-08T08:00:00.000Z", resolverPath: "/purchases" },
];
const facts = [
  { factId: "tank-priority", label: "DEF T-1", value: { priorityRank: 1, priorityReasons: ["the recorded balance is empty"] }, context: "FuelNerve priority", evidenceIds: ["evidence-inventory"] },
  { factId: "receipt-1", label: "Receipt INV-4", value: { invoiceNumber: "INV-4", receiptId: "receipt-4" }, context: "Receipt candidate", evidenceIds: ["evidence-receipt"] },
];
const result = {
  agent: { agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks and receipts", icon: "stock" },
  snapshotHash: "",
  observations: [{ title: "Previous reading comparison", detail: "The saved comparison records a lower prior physical reading.", factIds: ["tank-priority"], evidenceIds: ["evidence-inventory"] }],
  timeline: [],
  unknowns: [{ title: "Arrival time", detail: "The physical arrival time cannot be confirmed.", factIds: ["receipt-1"], evidenceIds: ["evidence-receipt"] }],
  evidence,
};
const findingIds = ["finding-1"];

describe("context-bound investigation follow-ups", () => {
  beforeEach(() => { vi.clearAllMocks(); findFirst.mockResolvedValue(packetRow()); });

  it("answers from the immutable packet and returns only packet citations", async () => {
    const response = await answerInvestigationFollowUp(request("WHY_HIGHEST_PRIORITY"));
    expect(response).toMatchObject({ supported: true, status: "READ_ONLY", agent: { agentKey: "inventory-watch" } });
    expect(response.answer).toContain("recorded balance is empty");
    expect(response.citations).toEqual([{ evidenceId: "evidence-inventory", label: "Current stock position", resolverPath: "/inventory" }]);
    expect(response).not.toHaveProperty("actions");
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "investigation-1", organizationId: "org-a", stationId: "station-a", userId: "user-a" } });
  });

  it("provides the relevant saved receipt link without invoking any application tool", async () => {
    const response = await answerInvestigationFollowUp(request("RELEVANT_RECEIPT"));
    expect(response.supported).toBe(true);
    expect(response.answer).toContain("INV-4");
    expect(response.citations).toEqual([{ evidenceId: "evidence-receipt", label: "Receipt timing records", resolverPath: "/purchases" }]);
  });

  it("clearly refuses when the packet cannot support the selected question", async () => {
    const row = packetRow();
    row.factSnapshot = [facts[0]];
    row.result = { ...row.result, evidence: [evidence[0]], unknowns: [], snapshotHash: hash(findingIds, [facts[0]], [evidence[0]]) };
    row.snapshotHash = (row.result as typeof result).snapshotHash;
    findFirst.mockResolvedValue(row);
    const response = await answerInvestigationFollowUp(request("RELEVANT_RECEIPT"));
    expect(response).toMatchObject({ supported: false, citations: [] });
    expect(response.answer).toMatch(/^I can’t answer that from this saved briefing/);
  });

  it("fails closed when the stored snapshot or citations have been altered", async () => {
    const row = packetRow();
    row.factSnapshot = [{ ...facts[0], label: "Altered" }, facts[1]];
    findFirst.mockResolvedValue(row);
    await expect(answerInvestigationFollowUp(request("RECORDS_COMPARED"))).rejects.toMatchObject({ code: "INVESTIGATION_PACKET_INVALID" });
  });

  it("does not reveal another user, station, or organization investigation", async () => {
    findFirst.mockResolvedValue(null);
    await expect(answerInvestigationFollowUp(request("UNCONFIRMED"))).rejects.toMatchObject({ code: "INVESTIGATION_NOT_FOUND" });
  });
});

function request(prompt: Parameters<typeof answerInvestigationFollowUp>[0]["prompt"]) { return { investigationId: "investigation-1", organizationId: "org-a", stationId: "station-a", userId: "user-a", prompt }; }
function packetRow() {
  const snapshotHash = hash(findingIds, facts, evidence);
  return { id: "investigation-1", organizationId: "org-a", stationId: "station-a", userId: "user-a", findingIds, factSnapshot: facts, snapshotHash, result: { ...result, snapshotHash } };
}
function hash(ids: unknown, packetFacts: unknown, packetEvidence: unknown) { return createHash("sha256").update(canonicalJson({ findingIds: ids, facts: packetFacts, evidence: packetEvidence })).digest("hex"); }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`; }
