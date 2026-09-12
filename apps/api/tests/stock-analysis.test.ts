import { describe, expect, it } from "vitest";
import { analyzeTankMovements } from "../src/modules/inventory/service.js";

const asOf = new Date("2026-09-08T10:00:00.000Z");
const sale = (id: string, day: string, litres: number) => ({ id, tankId: "tank-a", type: "SALE" as const, quantityDelta: -litres, occurredAt: new Date(`${day}T12:00:00.000Z`), note: null });

describe("Stock Agent deterministic movement analysis", () => {
  it("treats normal receipts, sales, and a small approved adjustment as ordinary", () => {
    const rows = [
      ...["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"].map((day, index) => sale(`sale-${index}`, day, 100 + index * 5)),
      { id: "receipt-1", tankId: "tank-a", type: "RECEIPT" as const, quantityDelta: 5000, occurredAt: new Date("2026-09-04T08:00:00.000Z"), note: "Verified delivery" },
      { id: "adjustment-1", tankId: "tank-a", type: "ADJUSTMENT" as const, quantityDelta: -20, occurredAt: new Date("2026-09-05T08:00:00.000Z"), note: "Approved calibration" },
    ];
    const result = analyzeTankMovements(rows, 1400, asOf);
    expect(result.unusualMovement).toBe(false);
    expect(result.unusualReasons).toEqual([]);
    expect(result.runoutEstimate).toMatchObject({ sampleSellingDays: 7, windowDays: 14 });
    expect(result.runoutEstimate?.assumption).toContain("no future receipt or demand change is assumed");
  });

  it("flags a genuine completed-day sales spike against seven prior selling days", () => {
    const prior = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"].map((day, index) => sale(`sale-${index}`, day, 300));
    const result = analyzeTankMovements([...prior, sale("sale-spike", "2026-09-07", 900)], 2000, asOf);
    expect(result.unusualMovement).toBe(true);
    expect(result.unusualReasons[0]).toContain("at least twice");
    expect(result.movementSample).toMatchObject({ latestSales: 900, priorSellingDays: 7, priorMedianDailySales: 300 });
  });

  it("withholds a runout estimate when fewer than seven selling days exist", () => {
    const result = analyzeTankMovements([sale("sale-1", "2026-09-06", 100), sale("sale-2", "2026-09-07", 120)], 1000, asOf);
    expect(result.runoutEstimate).toBeNull();
    expect(result.forecastWithheldReason).toBe("At least 7 selling days within the last 14 days are required.");
    expect(result.unusualMovement).toBe(false);
  });
});
