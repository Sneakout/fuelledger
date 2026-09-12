import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { agentPresentation } from "./agent-presentation.js";

export const investigationFollowUpPrompts = [
  "WHY_HIGHEST_PRIORITY",
  "RECORDS_COMPARED",
  "CHANGED_SINCE_PREVIOUS",
  "UNCONFIRMED",
  "RELEVANT_RECEIPT",
] as const;

export type InvestigationFollowUpPrompt = (typeof investigationFollowUpPrompts)[number];

const evidenceSchema = z.object({
  evidenceId: z.string().min(1),
  label: z.string().min(1),
  resolverPath: z.string().startsWith("/"),
}).passthrough();
const citedSchema = z.object({
  title: z.string(),
  detail: z.string(),
  factIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
}).passthrough();
const factSchema = z.object({
  factId: z.string().min(1),
  label: z.string().min(1),
  value: z.unknown(),
  evidenceIds: z.array(z.string()).min(1),
}).passthrough();
const resultSchema = z.object({
  agent: z.object({ agentKey: z.string(), name: z.string(), purpose: z.string(), icon: z.string() }).passthrough(),
  snapshotHash: z.string(),
  observations: z.array(citedSchema),
  timeline: z.array(citedSchema),
  unknowns: z.array(citedSchema),
  evidence: z.array(evidenceSchema),
}).passthrough();

type Packet = {
  facts: z.infer<typeof factSchema>[];
  result: z.infer<typeof resultSchema>;
  evidenceById: Map<string, z.infer<typeof evidenceSchema>>;
};
type Citation = { evidenceId: string; label: string; resolverPath: string };

const questions: Record<InvestigationFollowUpPrompt, string> = {
  WHY_HIGHEST_PRIORITY: "Why is this the highest priority?",
  RECORDS_COMPARED: "Which records did you compare?",
  CHANGED_SINCE_PREVIOUS: "What changed since the previous reading?",
  UNCONFIRMED: "What can’t you determine?",
  RELEVANT_RECEIPT: "Show me the relevant receipt.",
};

export async function answerInvestigationFollowUp(input: {
  investigationId: string;
  organizationId: string;
  stationId: string;
  userId: string;
  prompt: InvestigationFollowUpPrompt;
}) {
  const row = await prisma.intelligenceInvestigation.findFirst({ where: {
    id: input.investigationId,
    organizationId: input.organizationId,
    stationId: input.stationId,
    userId: input.userId,
  } });
  if (!row) throw new AppError(404, "INVESTIGATION_NOT_FOUND", "This agent briefing is no longer available in your current station context.");

  const packet = parseAndVerifyPacket(row);
  const response = answer(input.prompt, packet);
  return {
    investigationId: row.id,
    agent: verifiedAgent(packet),
    prompt: input.prompt,
    question: questions[input.prompt],
    status: "READ_ONLY" as const,
    snapshotHash: row.snapshotHash,
    ...response,
  };
}

function answer(prompt: InvestigationFollowUpPrompt, packet: Packet): { supported: boolean; answer: string; citations: Citation[] } {
  if (prompt === "WHY_HIGHEST_PRIORITY") {
    const priority = packet.facts.find(fact => {
      const value = objectValue(fact.value);
      return value?.priorityRank === 1 || fact.factId.endsWith("-priority");
    });
    if (!priority) return refusal("This briefing does not contain a confirmed highest-priority ranking.");
    const value = objectValue(priority.value);
    const reasons = stringArray(value?.priorityReasons);
    const explanation = reasons.length ? reasons.join("; ") : "FuelNerve marked this record as the first item to review in the saved assessment.";
    return supported(`I put ${priority.label} first because ${lowerFirst(explanation)}.`, priority.evidenceIds, packet);
  }

  if (prompt === "RECORDS_COMPARED") {
    if (!packet.result.evidence.length) return refusal("No supporting records are saved with this briefing.");
    const labels = packet.result.evidence.map(item => item.label);
    return { supported: true, answer: `I compared ${naturalList(labels)}.`, citations: packet.result.evidence.map(toCitation) };
  }

  if (prompt === "CHANGED_SINCE_PREVIOUS") {
    const comparison = packet.result.observations.find(item => /previous|comparison|changed|movement/i.test(`${item.title} ${item.detail}`));
    if (!comparison) return refusal("This briefing does not contain a verified previous reading or period comparison, so I can’t describe a change safely.");
    return supported(`${comparison.title}: ${comparison.detail}`, comparison.evidenceIds, packet);
  }

  if (prompt === "UNCONFIRMED") {
    if (!packet.result.unknowns.length) return refusal("This briefing does not record a specific unresolved question.");
    const unknowns = packet.result.unknowns.slice(0, 3);
    return supported(unknowns.map(item => `${item.title}: ${item.detail}`).join(" "), unknowns.flatMap(item => item.evidenceIds), packet);
  }

  const receiptFact = packet.facts.find(fact => fact.factId.startsWith("receipt-"));
  if (!receiptFact) return refusal("No receipt was identified as relevant in the records saved with this briefing.");
  const receiptEvidence = receiptFact.evidenceIds.map(id => packet.evidenceById.get(id)).filter((item): item is z.infer<typeof evidenceSchema> => Boolean(item));
  const purchaseEvidence = packet.result.evidence.filter(item => item.resolverPath === "/purchases");
  const citations = uniqueCitations([...receiptEvidence, ...purchaseEvidence].map(toCitation));
  if (!citations.length) return refusal("The packet mentions a receipt but does not contain a safe link to its supporting record.");
  const value = objectValue(receiptFact.value);
  const reference = String(value?.invoiceNumber ?? value?.receiptId ?? receiptFact.label);
  return { supported: true, answer: `${receiptFact.label} (${reference}) is the receipt connected to this briefing. Open the cited purchase record to verify its source details.`, citations };
}

function parseAndVerifyPacket(row: { findingIds: unknown; factSnapshot: unknown; snapshotHash: string; result: unknown }): Packet {
  const facts = z.array(factSchema).safeParse(row.factSnapshot);
  const result = resultSchema.safeParse(row.result);
  const findingIds = z.array(z.string()).safeParse(row.findingIds);
  if (!facts.success || !result.success || !findingIds.success || result.data.snapshotHash !== row.snapshotHash) throw invalidPacket();
  const expectedHash = createHash("sha256").update(canonicalJson({ findingIds: findingIds.data, facts: facts.data, evidence: result.data.evidence })).digest("hex");
  if (expectedHash !== row.snapshotHash) throw invalidPacket();
  const factIds = new Set(facts.data.map(fact => fact.factId));
  const evidenceById = new Map(result.data.evidence.map(item => [item.evidenceId, item]));
  for (const fact of facts.data) if (fact.evidenceIds.some(id => !evidenceById.has(id))) throw invalidPacket();
  for (const item of [...result.data.observations, ...result.data.timeline, ...result.data.unknowns]) {
    if (item.factIds.some(id => !factIds.has(id)) || item.evidenceIds.some(id => !evidenceById.has(id))) throw invalidPacket();
  }
  return { facts: facts.data, result: result.data, evidenceById };
}

function verifiedAgent(packet: Packet) {
  const factIds = packet.facts.map(fact => fact.factId);
  const expectedKey = factIds.some(id => id.startsWith("profit-")) ? "profit-insight"
    : factIds.some(id => id.startsWith("shift-") || id.startsWith("reconciliation-")) ? "reconciliation-review"
    : factIds.some(id => id.startsWith("tank-") || id.startsWith("receipt-")) ? "inventory-watch"
    : "nerve-specialist";
  if (packet.result.agent.agentKey !== expectedKey) throw invalidPacket();
  return agentPresentation(expectedKey);
}

function supported(answer: string, evidenceIds: string[], packet: Packet) {
  const citations = uniqueCitations(evidenceIds.map(id => packet.evidenceById.get(id)).filter((item): item is z.infer<typeof evidenceSchema> => Boolean(item)).map(toCitation));
  if (!citations.length) throw invalidPacket();
  return { supported: true, answer, citations };
}
function refusal(detail: string) { return { supported: false, answer: `I can’t answer that from this saved briefing. ${detail}`, citations: [] as Citation[] }; }
function invalidPacket() { return new AppError(409, "INVESTIGATION_PACKET_INVALID", "This briefing could not be verified, so Nerve did not answer the follow-up."); }
function toCitation(item: z.infer<typeof evidenceSchema>): Citation { return { evidenceId: item.evidenceId, label: item.label, resolverPath: item.resolverPath }; }
function uniqueCitations(items: Citation[]) { return [...new Map(items.map(item => [item.evidenceId, item])).values()]; }
function naturalList(items: string[]) { return items.length < 2 ? items[0] ?? "the saved records" : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`; }
function objectValue(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []; }
function lowerFirst(value: string) { return value ? `${value[0]!.toLowerCase()}${value.slice(1)}`.replace(/[.]+$/, "") : value; }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`; }
