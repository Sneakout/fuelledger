import { describe, expect, it } from "vitest";
import { invoiceBalanceDisplay, onlyCompatibleTankId } from "./PurchasesPage";

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

describe("purchase invoice tank selection", () => {
  const stations = [{
    id: "station-1",
    name: "Station One",
    code: "S-1",
    configurations: [{ tanks: [
      { id: "tank-ms", code: "T-1", productId: "MS" },
      { id: "tank-hsd-1", code: "T-2", productId: "HSD" },
      { id: "tank-hsd-2", code: "T-3", productId: "HSD" },
    ] }],
  }];

  it("selects the tank when exactly one tank carries the product", () => {
    expect(onlyCompatibleTankId(stations, "station-1", "MS")).toBe("tank-ms");
  });

  it("requires a choice when multiple tanks carry the product", () => {
    expect(onlyCompatibleTankId(stations, "station-1", "HSD")).toBe("");
  });

  it("leaves the tank empty when the station or product has no tank", () => {
    expect(onlyCompatibleTankId(stations, "station-1", "DEF")).toBe("");
  });
});
