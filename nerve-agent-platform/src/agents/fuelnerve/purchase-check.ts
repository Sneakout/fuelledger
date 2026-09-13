import type { AgentDefinition } from "../../runtime-contracts.ts";
import type { JsonObject, ToolResult } from "../../contracts.ts";
import { deterministicNarrative, evidenceForStation, factPacket, findingFact, resultItems, textValue, validateNarrative } from "./shared.ts";

export function createPurchaseAgent(): AgentDefinition {
  return {
    agentKey: "purchase-check", agentVersion: "1.0.0", promptVersion: "purchase-check.prompt@1",
    description: "Reviews supplier invoices, receipts, compatible agreed rates, quantities, corrections and overdue payments.",
    instructions: "Explain only supplied purchase exceptions. A duplicate candidate is never a confirmed duplicate. Do not correct invoices, receive stock, or make payments. Cite supplied facts and evidence.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: ["purchases.review.read"], maxToolCalls: 1, maxOutputTokens: 450,
    plan: (input, context) => [{ toolId: "purchases.review.read", input: { locationIds: context.permittedLocationIds, asOf: typeof input.asOf === "string" ? input.asOf : new Date().toISOString() } }],
    buildFacts(results) { const result = results[0]!; return factPacket(resultItems(result).map(item => purchaseFact(item, result)), results); },
    validateOutput: validateNarrative,
    deterministicFallback: facts => deterministicNarrative("Purchase review", facts, "FuelNerve reported no supplier purchase exceptions for this scope."),
  };
}

function purchaseFact(item: JsonObject, result: ToolResult) {
  const stationId = textValue(item.stationId, "unknown"), type = textValue(item.type, "PURCHASE_REVIEW");
  const invoiceId = textValue(item.invoiceId), receiptId = textValue(item.receiptId), relatedInvoiceId = textValue(item.relatedInvoiceId);
  const links = [
    ...(invoiceId ? [{ recordType: "PURCHASE_INVOICE", recordId: invoiceId, label: "Open supplier invoice", path: `/purchases?invoiceId=${encodeURIComponent(invoiceId)}` }] : []),
    ...(relatedInvoiceId ? [{ recordType: "PURCHASE_INVOICE", recordId: relatedInvoiceId, label: "Open possible matching invoice", path: `/purchases?invoiceId=${encodeURIComponent(relatedInvoiceId)}` }] : []),
    ...(receiptId ? [{ recordType: "PURCHASE_RECEIPT", recordId: receiptId, label: "Open stock receipt", path: `/purchases?receiptId=${encodeURIComponent(receiptId)}` }] : []),
  ];
  return findingFact({
    stationId, sourceKey: [type, invoiceId, relatedInvoiceId, receiptId, textValue(item.lineId)].filter(Boolean).join(":"), findingType: type,
    severity: textValue(item.severity, "ATTENTION") as "ATTENTION" | "URGENT", title: textValue(item.title, "Purchase record needs review"),
    whyItMatters: textValue(item.explanation, "Verified purchase records need review."), calculatedAt: result.calculatedAt,
    periodStart: result.calculatedAt, periodEnd: result.calculatedAt,
    recommendedNextStep: type === "PURCHASE_DUPLICATE_CANDIDATE" ? "Open both invoices and compare the original supplier documents before deciding whether either record is a duplicate." : "Open the linked invoice and receipt, then compare the source documents before proposing a correction or payment.",
    displayValue: { ...item, evidenceLinks: links, duplicateDecision: type === "PURCHASE_DUPLICATE_CANDIDATE" ? "UNCONFIRMED" : null },
    recordsToCompare: links.map(link => link.label), relatedContext: { evidenceLinks: links, correctionRequiresApproval: true, paymentRequiresApproval: true },
  }, evidenceForStation(result, stationId).map(row => row.evidenceId));
}
