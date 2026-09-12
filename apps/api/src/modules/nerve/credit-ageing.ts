type LedgerCharge = { id: string; amount: unknown; dueDate: Date | null; occurredAt: Date; description: string; saleId?: string | null; disputedAt?: Date | null; disputeReason?: string | null };
type CustomerCreditRecord = { id: string; name: string; creditLimit: unknown; ledger: LedgerCharge[] };

export function buildCustomerInvoiceAgeing(customer: CustomerCreditRecord, asOf: Date) {
  const charges = customer.ledger.filter(row => amount(row.amount) > 0 && row.occurredAt <= asOf).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime()).map(row => ({ ...row, originalAmount: amount(row.amount), outstanding: amount(row.amount) }));
  let receipts = Math.abs(customer.ledger.filter(row => amount(row.amount) < 0 && row.occurredAt <= asOf).reduce((sum, row) => sum + amount(row.amount), 0));
  for (const charge of charges) {
    const applied = Math.min(charge.outstanding, receipts);
    charge.outstanding -= applied;
    receipts -= applied;
  }
  const customerOutstanding = charges.reduce((sum, row) => sum + row.outstanding, 0);
  const creditLimit = amount(customer.creditLimit);
  const ranked = charges.map(charge => {
    const dueDate = charge.dueDate ?? charge.occurredAt;
    const daysOverdue = Math.max(0, Math.floor((startOfDay(asOf).getTime() - startOfDay(dueDate).getTime()) / 86_400_000));
    const amountPaid = charge.originalAmount - charge.outstanding;
    const disputed = Boolean(charge.disputedAt);
    const status = disputed ? "DISPUTED" : charge.outstanding <= .005 ? "PAID" : dueDate >= startOfDay(asOf) ? (amountPaid > .005 ? "PARTIALLY_PAID_NOT_DUE" : "NOT_DUE") : amountPaid > .005 ? "PARTIALLY_PAID_OVERDUE" : "OVERDUE";
    const limitExcess = creditLimit > 0 ? Math.max(0, customerOutstanding - creditLimit) : 0;
    const priorityScore = status.includes("OVERDUE") ? Math.round(charge.outstanding * 100) + daysOverdue * 10_000 + Math.round(limitExcess * 100) : 0;
    return { invoiceId: charge.id, invoiceNumber: charge.saleId ? `SALE-${charge.saleId.slice(-8).toUpperCase()}` : charge.description || `LEDGER-${charge.id.slice(-8).toUpperCase()}`, eventDate: charge.occurredAt.toISOString(), dueDate: dueDate.toISOString(), originalAmount: charge.originalAmount, amountPaid, outstanding: charge.outstanding, status, daysOverdue, creditLimit, customerOutstanding, priorityScore, disputeReason: disputed ? charge.disputeReason ?? "Dispute recorded" : null };
  }).sort((left, right) => right.priorityScore - left.priorityScore || left.dueDate.localeCompare(right.dueDate));
  return ranked.map((invoice, index) => ({ ...invoice, priorityRank: invoice.priorityScore > 0 ? index + 1 : null, priorityReason: invoice.priorityScore > 0 ? `${money(invoice.outstanding)} overdue for ${invoice.daysOverdue} day${invoice.daysOverdue === 1 ? "" : "s"}${creditLimit > 0 && customerOutstanding > creditLimit ? `; customer is ${money(customerOutstanding - creditLimit)} above the agreed credit limit` : ""}` : null }));
}

export function rankCustomerInvoiceAgeing<T extends { invoices: Array<{ invoiceId: string; priorityScore: number; priorityReason: string | null }> }>(customers: T[]): T[] {
  const actionable = customers.flatMap(customer => customer.invoices).filter(invoice => invoice.priorityScore > 0).sort((left, right) => right.priorityScore - left.priorityScore || left.invoiceId.localeCompare(right.invoiceId));
  const ranks = new Map(actionable.map((invoice, index) => [invoice.invoiceId, index + 1]));
  return customers.map(customer => ({ ...customer, invoices: customer.invoices.map(invoice => ({ ...invoice, priorityRank: ranks.get(invoice.invoiceId) ?? null })) }));
}

const amount = (value: unknown) => Number(value ?? 0);
const startOfDay = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
