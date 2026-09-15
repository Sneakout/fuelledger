import { describe, expect, it } from "vitest";
import { calculateLandedPurchasePrices } from "./purchase-price.js";

describe("landed purchase price", () => {
  it("uses the tax-inclusive product value and normalizes KL to litres", () => {
    const result = calculateLandedPurchasePrices({
      invoiceTotal: 1_207_079,
      lines: [{ key: "hsd", quantity: 12, sourceUnit: "KL", productUnit: "LITRE", baseAmount: 952_095.24 }],
    });
    expect(result?.[0]?.taxInclusiveAmount).toBeCloseTo(1_207_079, 8);
    expect(result?.[0]?.unitPrice).toBeCloseTo(100.5899166667, 8);
  });

  it("attributes line tax first and allocates only shared charges by value", () => {
    const result = calculateLandedPurchasePrices({
      invoiceTotal: 1_330,
      lines: [
        { key: "a", quantity: 10, productUnit: "L", baseAmount: 1_000, taxRate: 18 },
        { key: "b", quantity: 2, productUnit: "L", baseAmount: 100, taxRate: 0 },
      ],
    });
    expect(result?.find(line => line.key === "a")?.taxInclusiveAmount).toBeCloseTo(1_225.45454545, 8);
    expect(result?.find(line => line.key === "b")?.taxInclusiveAmount).toBeCloseTo(104.54545455, 8);
  });

  it("keeps refundable deposits and unrelated adjustments out of product cost", () => {
    const result = calculateLandedPurchasePrices({
      invoiceTotal: 12_000,
      excludedAmount: 1_000,
      lines: [{ key: "ms", quantity: 100, productUnit: "L", baseAmount: 10_000 }],
    });
    expect(result?.[0]?.taxInclusiveAmount).toBe(11_000);
    expect(result?.[0]?.unitPrice).toBe(110);
  });

  it("aggregates repeated lines for one product without losing precision", () => {
    const result = calculateLandedPurchasePrices({
      invoiceTotal: 300.01,
      lines: [
        { key: "ms", quantity: 1, productUnit: "L", baseAmount: 100.003 },
        { key: "ms", quantity: 2, productUnit: "L", baseAmount: 200.007 },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result?.[0]?.unitPrice).toBeCloseTo(100.0033333333, 10);
  });

  it("rejects unknown conversions and impossible totals", () => {
    expect(calculateLandedPurchasePrices({ invoiceTotal: 10, lines: [{ key: "x", quantity: 1, sourceUnit: "KL", productUnit: "KG", baseAmount: 10 }] })).toBeNull();
    expect(calculateLandedPurchasePrices({ invoiceTotal: 9, lines: [{ key: "x", quantity: 1, productUnit: "L", baseAmount: 10 }] })).toBeNull();
  });
});
