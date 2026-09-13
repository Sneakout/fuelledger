import type { AgentDefinition } from "../../runtime-contracts.ts";
import type { JsonObject, ToolResult } from "../../contracts.ts";
import { arrayObjects, deterministicNarrative, evidenceForStation, factPacket, findingFact, numberValue, resultItems, textValue, validateNarrative } from "./shared.ts";

export function createCreditAgent(): AgentDefinition {
  return {
    agentKey: "credit-watch", agentVersion: "1.0.0", promptVersion: "credit-watch.prompt@1",
    description: "Reviews invoice-level customer dues and prepares verified reminder drafts without sending them.",
    instructions: "Explain only supplied receivable facts. Never change balances, allocate payments, mark disputes, or send messages. Reminder text is a draft. Cite supplied fact and evidence IDs.",
    outputSchemaId: "nerve.agent-narrative@1", allowedToolIds: ["receivables.ageing.read"], maxToolCalls: 1, maxOutputTokens: 400,
    plan: (input, context) => [{ toolId: "receivables.ageing.read", input: { locationIds: context.permittedLocationIds, asOf: typeof input.asOf === "string" ? input.asOf : new Date().toISOString() } }],
    buildFacts(results) {
      const result = results[0]!;
      return factPacket(resultItems(result).flatMap(item => creditFacts(item, result)), results);
    },
    validateOutput: validateNarrative,
    deterministicFallback: facts => deterministicNarrative("Credit review", facts, "FuelNerve reported no overdue customer invoices for this scope."),
  };
}

function creditFacts(item: JsonObject, result: ToolResult) {
  const stationId = textValue(item.stationId, "unknown");
  const evidenceIds = evidenceForStation(result, stationId).map(row => row.evidenceId);
  const invoices = arrayObjects(item.invoices).filter(invoice => {
    const status = textValue(invoice.status);
    return status === "OVERDUE" || status === "PARTIALLY_PAID_OVERDUE" || status === "CREDIT_LIMIT_EXCEEDED";
  });
  return invoices.map(invoice => {
    const customer = textValue(invoice.customer, textValue(item.customer, "Customer"));
    const invoiceNumber = textValue(invoice.invoiceNumber, textValue(invoice.invoiceId, "invoice"));
    const outstanding = numberValue(invoice.outstanding);
    const daysOverdue = Math.max(0, numberValue(invoice.daysOverdue));
    const creditLimit = numberValue(invoice.creditLimit);
    const customerOutstanding = numberValue(invoice.customerOutstanding);
    const limitExceeded = creditLimit > 0 && customerOutstanding > creditLimit;
    const status = textValue(invoice.status);
    const partial = status === "PARTIALLY_PAID_OVERDUE" || numberValue(invoice.amountPaid) > 0;
    const reasons = [
      `${money(outstanding)} remains unpaid for ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`,
      ...(partial ? [`a partial payment of ${money(numberValue(invoice.amountPaid))} is recorded`] : []),
      ...(limitExceeded ? [`the customer's ${money(creditLimit)} agreed credit limit is exceeded by ${money(customerOutstanding - creditLimit)}`] : []),
    ];
    const reminderDraft = `${customer}, this is a reminder that ${money(outstanding)} remains outstanding on invoice ${invoiceNumber}, which was due on ${dateLabel(textValue(invoice.dueDate))}. Please review the invoice and arrange payment or contact us if the record needs clarification.`;
    return findingFact({
      stationId, sourceKey: textValue(invoice.invoiceId, invoiceNumber), findingType: "CUSTOMER_INVOICE_OVERDUE",
      severity: limitExceeded || daysOverdue >= 30 ? "URGENT" : "ATTENTION",
      title: `${customer}'s invoice ${invoiceNumber} is overdue`,
      whyItMatters: `${reasons.join("; ")}.`, calculatedAt: result.calculatedAt,
      periodStart: textValue(invoice.eventDate, result.calculatedAt), periodEnd: result.calculatedAt,
      recommendedNextStep: `Open invoice ${invoiceNumber} and verify its ledger and receipt records before using the reminder draft.`,
      displayValue: { customerId: item.customerId, customer, invoiceId: invoice.invoiceId, invoiceNumber, originalAmount: invoice.originalAmount, amountPaid: invoice.amountPaid, outstanding, eventDate: invoice.eventDate, dueDate: invoice.dueDate, daysOverdue, status, creditLimit, customerOutstanding, reminderDraft, sendState: "NOT_SENT", sendingRequiresExplicitApproval: true },
      priorityRank: numberValue(invoice.priorityRank), priorityReason: textValue(invoice.priorityReason),
      recordsToCompare: ["Customer invoice", "Customer ledger", "Recorded receipts"], relatedContext: { reminderDraft, sendState: "NOT_SENT", sendingRequiresExplicitApproval: true },
    }, evidenceIds);
  });
}

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
function dateLabel(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date) : "the recorded due date"; }
