import { describe, expect, it } from "vitest";
import { buildCustomerInvoiceAgeing, rankCustomerInvoiceAgeing } from "../src/modules/nerve/credit-ageing.js";

const asOf = new Date("2026-09-12T12:00:00.000Z");
const customer = (ledger: any[], creditLimit = 1_000) => ({ id: "customer-a", name: "Arun Transport", creditLimit, ledger });
const charge = (id: string, amount: number, dueDate: string, occurredAt = "2026-08-01T00:00:00.000Z", extra = {}) => ({ id, amount, dueDate: new Date(dueDate), occurredAt: new Date(occurredAt), description: `Invoice ${id}`, saleId: id, ...extra });

describe("credit ageing", () => {
it("applies receipts FIFO and preserves invoice-level partial balances", () => {
  const rows = buildCustomerInvoiceAgeing(customer([charge("sale-1", 800, "2026-09-01"), charge("sale-2", 500, "2026-09-20", "2026-09-05"), { id: "receipt-1", amount: -300, dueDate: null, occurredAt: new Date("2026-09-06"), description: "Receipt" }], 900), asOf);
  expect(rows.map(row => ({ id: row.invoiceId, paid: row.amountPaid, outstanding: row.outstanding, status: row.status }))).toEqual([{ id: "sale-1", paid: 300, outstanding: 500, status: "PARTIALLY_PAID_OVERDUE" }, { id: "sale-2", paid: 0, outstanding: 500, status: "NOT_DUE" }]);
  expect(rows[0]!.priorityRank).toBe(1);
  expect(rows[0]!.priorityReason).toMatch(/₹500.*11 days.*credit limit/i);
});

it("marks fully paid, disputed and not-yet-due records without prioritizing them", () => {
  const rows = buildCustomerInvoiceAgeing(customer([charge("paid", 100, "2026-09-01"), { id: "receipt", amount: -100, dueDate: null, occurredAt: new Date("2026-09-02"), description: "Receipt" }, charge("disputed", 200, "2026-09-01", "2026-08-01", { disputedAt: new Date("2026-09-05"), disputeReason: "Quantity under review" }), charge("future", 300, "2026-09-20")]), asOf);
  expect(Object.fromEntries(rows.map(row => [row.invoiceId, row.status]))).toEqual({ paid: "PAID", disputed: "DISPUTED", future: "NOT_DUE" });
  expect(rows.every(row => row.priorityRank === null)).toBe(true);
});

it("ranks overdue invoices globally rather than restarting priority for each customer", () => {
  const ranked = rankCustomerInvoiceAgeing([{ customer: "A", invoices: [{ invoiceId: "a", priorityScore: 10, priorityReason: "A" }] }, { customer: "B", invoices: [{ invoiceId: "b", priorityScore: 20, priorityReason: "B" }] }]);
  expect(ranked[0]!.invoices[0]!.priorityRank).toBe(2);
  expect(ranked[1]!.invoices[0]!.priorityRank).toBe(1);
});
});
