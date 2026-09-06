import { describe, expect, it } from "vitest";
import { calculateBookStock, calculateExpectedClosing, calculateStockVariance, stockRuleDefinitions } from "./stock-rules.js";

describe("canonical stock rules", () => {
  it("defines every agreed stock value and timestamp", () => {
    expect(Object.keys(stockRuleDefinitions)).toEqual(["invoiceDate", "receivedAt", "bookStock", "physicalStock", "shiftOpening", "expectedClosing", "actualClosing", "variance"]);
    expect(stockRuleDefinitions.invoiceDate).toContain("never determines");
    expect(stockRuleDefinitions.receivedAt).toContain("physically entered");
  });

  it("calculates book stock from the complete movement equation", () => {
    expect(calculateBookStock({ openingBalance: 8_000, receipts: 10_000, sales: 4_000, approvedAdjustments: -25 })).toBe(13_975);
  });

  it("keeps testing separate in the shift stock bridge", () => {
    const expected = calculateExpectedClosing({ shiftOpening: 8_000, receiptsDuringShift: 10_000, salesDuringShift: 4_000, testingNotReturned: 5, approvedAdjustmentsDuringShift: -20 });
    expect(expected).toBe(13_975);
    expect(calculateStockVariance(13_950, expected)).toBe(-25);
  });
});
