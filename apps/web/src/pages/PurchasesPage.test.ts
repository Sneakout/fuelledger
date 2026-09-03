import { describe, expect, it } from "vitest";
import { invoiceBalanceDisplay } from "./PurchasesPage";

describe("purchase invoice balance display", () => {
  it("shows the full paid amount instead of zero outstanding", () => {
    expect(invoiceBalanceDisplay({ totalAmount: "1010000", outstanding: 0 })).toEqual({
      amount: 1010000,
      detail: "Paid in full",
    });
  });

  it("shows the balance and payment progress for a partially paid invoice", () => {
    expect(invoiceBalanceDisplay({ totalAmount: "1010000", outstanding: 400000 })).toEqual({
      amount: 400000,
      detail: "₹6,10,000 paid · ₹10,10,000 total",
    });
  });

  it("labels a wholly unpaid invoice as amount due", () => {
    expect(invoiceBalanceDisplay({ totalAmount: "1010000", outstanding: 1010000 })).toEqual({
      amount: 1010000,
      detail: "Amount due",
    });
  });
});
