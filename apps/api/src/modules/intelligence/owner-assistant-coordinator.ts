import { createHash } from "node:crypto";
import { readForNerve, type NerveReadCapability } from "../nerve/read-service.js";

export const ownerFollowUps = ["GIVE_DETAILS", "WHY_FIRST", "SHOW_RECORDS"] as const;
export type OwnerFollowUp = typeof ownerFollowUps[number];
type RecordLink = { evidenceId: string; evidenceType: string; label: string; resolverPath: string };
type CoordinatorFact = { id: string; label: string; value: string; context: string; evidenceLabel: string; evidencePath: string; priorityRank?: number; priorityReason?: string; supportingRecords: RecordLink[] };

export function matchOwnerFollowUp(question: string): OwnerFollowUp | null {
  const value = question.trim().toLowerCase();
  if (/^(give me )?(more )?details[?.!]*$/.test(value)) return "GIVE_DETAILS";
  if (/^why (is this )?first[?.!]*$/.test(value)) return "WHY_FIRST";
  if (/^(show|open)( me)? (the )?(records|evidence)[?.!]*$/.test(value)) return "SHOW_RECORDS";
  return null;
}

export function ownerAssistantReleaseRoute(input: { stage: "OFF" | "LOCAL" | "STAGING" | "PRODUCTION"; rolloutPercent: number; rollback: boolean; environment: "development" | "test" | "production"; organizationId: string; userId: string }) {
  if (input.rollback || input.stage === "OFF") return "LEGACY" as const;
  const allowed = input.environment === "production" ? input.stage === "PRODUCTION" : true;
  if (!allowed) return "LEGACY" as const;
  const bucket = createHash("sha256").update(`${input.organizationId}:${input.userId}`).digest().readUInt32BE(0) % 100;
  return bucket < input.rolloutPercent ? "COORDINATOR" as const : "LEGACY" as const;
}

export async function coordinateOwnerAnswer(input: { organizationId: string; stationId: string; question: string; asOf?: string; startDate?: string; endDate?: string }) {
  const snapshotDate = input.asOf ?? new Date().toISOString();
  const followUp = matchOwnerFollowUp(input.question);
  const capabilities: NerveReadCapability[] = followUp ? ["reconciliation", "inventory", "receipt-timing", "profit", "receivables", "purchase-review"] : capabilitiesFor(input.question);
  const snapshots = await Promise.all(capabilities.map(capability => readForNerve(capability, { organizationId: input.organizationId, stationId: input.stationId, asOf: snapshotDate, ...(input.startDate ? { startDate: input.startDate } : {}), ...(input.endDate ? { endDate: input.endDate } : {}) })));
  const facts = deduplicate(snapshots.flatMap((snapshot, index) => factsFrom(capabilities[index]!, snapshot as Snapshot))).sort((a, b) => (a.priorityRank ?? 999) - (b.priorityRank ?? 999));
  const first = facts[0];
  const presentation = followUp === "WHY_FIRST" && first
    ? { title: first.label, explanation: first.priorityReason ? `This is first because ${lower(first.priorityReason)}` : "This is the highest-priority verified item in this station snapshot.", action: "Open its supporting records before deciding what to do." }
    : followUp === "SHOW_RECORDS"
      ? { title: "Supporting records", explanation: `${new Set(facts.flatMap(fact => fact.supportingRecords.map(record => record.evidenceId))).size} exact supporting records are attached.`, action: "Open a record below to review the source information." }
      : followUp === "GIVE_DETAILS"
        ? { title: "Details from your five specialists", explanation: `${facts.length} verified items were found for this station snapshot.`, action: "Review the first item and its supporting records." }
        : { title: first?.label ?? "No exception found", explanation: first?.context ?? "The selected specialist found no supported exception in this snapshot.", action: first ? "Review the supporting records before taking action." : "Ask about shifts, stock, profit, customer credit or purchases." };
  return {
    intent: followUp ?? "SPECIALIST_COORDINATOR", scope: { date: snapshotDate.slice(0, 10), stationId: input.stationId },
    answer: { ...presentation, facts }, answerMode: "DETERMINISTIC", stationId: input.stationId, snapshotDate,
    stale: Date.now() - Date.parse(snapshotDate) > 86_400_000, inconsistentSnapshot: false, missingInformation: [],
    supportedFollowUps: ["Give me details", "Why first?", "Show the records"] as const,
  };
}

function capabilitiesFor(question: string): NerveReadCapability[] {
  const value = question.toLowerCase();
  if (/stock|tank|inventory|litre|fuel level/.test(value)) return ["inventory", "receipt-timing"];
  if (/shift|collection|cash|upi|card|handover|reconcil/.test(value)) return ["reconciliation"];
  if (/profit|margin|earning|cost of sale|revenue|expense/.test(value)) return ["profit"];
  if (/customer|receivable|credit|owe us|owes us|due from/.test(value)) return ["receivables"];
  if (/supplier|vendor|purchase|invoice|delivery|payable|we owe|duplicate/.test(value)) return ["purchase-review"];
  if (/today|overview|business|attention|doing/.test(value)) return ["reconciliation", "inventory", "receipt-timing", "profit", "receivables", "purchase-review"];
  return [];
}

type Snapshot = { data: { items?: unknown[] }; evidence: Array<{ evidenceId: string; evidenceType: string; label: string; resolverPath: string }> };
function factsFrom(capability: NerveReadCapability, snapshot: Snapshot): CoordinatorFact[] {
  const records = snapshot.evidence.map(record => ({ evidenceId: record.evidenceId, evidenceType: record.evidenceType, label: record.label, resolverPath: record.resolverPath }));
  const items = (snapshot.data.items ?? []).filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object");
  const make = (id: string, label: string, value: string, context: string, priorityRank?: number, priorityReason?: string): CoordinatorFact => ({ id: `${capability}:${id}`, label, value, context, evidenceLabel: records[0]?.label ?? "Supporting records", evidencePath: records[0]?.resolverPath ?? "/", ...(priorityRank ? { priorityRank } : {}), ...(priorityReason ? { priorityReason } : {}), supportingRecords: records });
  if (capability === "reconciliation") return items.flatMap(item => (item.shiftBriefings ?? []).map((shift: any) => make(shift.shiftId, shift.status === "OPEN" ? `Shift ${shift.shiftNumber} is overdue for closing` : `Review Shift ${shift.shiftNumber}`, `${shift.awaitingMinutes ?? 0} min`, (shift.priorityReasons ?? []).join("; "), shift.priorityRank, (shift.priorityReasons ?? []).join("; "))));
  if (capability === "inventory") return items.filter(item => item.priorityReasons?.length).map(item => make(item.tankId ?? item.productId, `${item.productCode ?? "Tank"} ${item.tankCode ?? ""} needs attention`, `${Number(item.bookStock ?? 0).toLocaleString("en-IN")} L`, item.priorityReasons.join("; "), item.priorityRank, item.priorityReasons.join("; ")));
  if (capability === "receipt-timing") return items.filter(item => item.anomaly).map(item => make(item.receiptId, `${item.supplierName ?? "A supplier"} receipt timing needs review`, item.invoiceNumber ?? "Receipt", item.reason ?? "The recorded receipt time needs review."));
  if (capability === "profit") return items.filter(item => item.materialChange || item.reportQuality?.periodComplete === false || item.reportQuality?.missingCostOfSales).map(item => make("period", "Review the profit movement", money(item.netProfit), item.priorityReasons?.join("; ") ?? "Posted profit records need review.", item.priorityRank ?? undefined, item.priorityReasons?.join("; ")));
  if (capability === "receivables") return items.flatMap(customer => (customer.invoices ?? []).filter((invoice: any) => String(invoice.status).includes("OVERDUE")).map((invoice: any) => make(invoice.invoiceId, `${customer.customer} payment is overdue`, money(invoice.outstanding), `${invoice.invoiceNumber} was due ${dateLabel(invoice.dueDate)} and remains unpaid.`, invoice.priorityRank ?? undefined, invoice.priorityReason ?? undefined)));
  if (capability === "purchase-review") return items.map(item => make(item.invoiceId ?? item.receiptId ?? item.type, item.title ?? "Purchase record needs review", item.outstanding ? money(item.outstanding) : item.difference !== undefined ? String(item.difference) : "Review", item.explanation ?? "The purchase record needs review.", item.severity === "URGENT" ? 1 : undefined, item.explanation));
  return [];
}

function deduplicate(facts: CoordinatorFact[]) { const seen = new Set<string>(); return facts.filter(fact => seen.has(fact.id) ? false : (seen.add(fact.id), true)); }
function money(value: unknown) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
function dateLabel(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function lower(value: string) { return value ? value[0]!.toLowerCase() + value.slice(1) : value; }
