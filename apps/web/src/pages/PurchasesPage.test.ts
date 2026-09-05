import { describe, expect, it } from "vitest";
import {
  dueDateFromInvoiceDate,
  invoiceBalanceDisplay,
  onlyCompatibleTankId,
  purchasePriceForDate,
} from "./PurchasesPage";

describe("purchase invoice balance display", () => {
  it("shows the full paid amount instead of zero outstanding", () => {
    expect(
      invoiceBalanceDisplay({ totalAmount: "1010000", outstanding: 0 }),
    ).toEqual({
      amount: 1010000,
      detail: "Paid in full",
    });
  });

  it("shows the balance and payment progress for a partially paid invoice", () => {
    expect(
      invoiceBalanceDisplay({ totalAmount: "1010000", outstanding: 400000 }),
    ).toEqual({
      amount: 400000,
      detail: "₹6,10,000 paid · ₹10,10,000 total",
    });
  });

  it("labels a wholly unpaid invoice as amount due", () => {
    expect(
      invoiceBalanceDisplay({ totalAmount: "1010000", outstanding: 1010000 }),
    ).toEqual({
      amount: 1010000,
      detail: "Amount due",
    });
  });
});

describe("purchase invoice tank selection", () => {
  const stations = [
    {
      id: "station-1",
      name: "Station One",
      code: "S-1",
      configurations: [
        {
          tanks: [
            { id: "tank-ms", code: "T-1", productId: "MS" },
            { id: "tank-hsd-1", code: "T-2", productId: "HSD" },
            { id: "tank-hsd-2", code: "T-3", productId: "HSD" },
          ],
        },
      ],
    },
  ];

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

describe("purchase invoice due date", () => {
  it("calculates credit terms from the invoice date", () => {
    expect(dueDateFromInvoiceDate("2026-09-04", 30)).toBe("2026-10-04");
  });

  it("handles month-end and leap-year boundaries", () => {
    expect(dueDateFromInvoiceDate("2028-02-28", 2)).toBe("2028-03-01");
  });
});

describe("effective-dated purchase price", () => {
  const product = {
    id: "HSD",
    name: "High Speed Diesel",
    code: "HSD",
    category: "FUEL",
    unit: "L",
    hsnCode: null,
    purchasePrice: "105",
    tankLinked: true,
    taxCategory: null,
    purchasePriceHistory: [
      {
        id: "new",
        price: "105",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "old",
        price: "101.02",
        effectiveFrom: "2025-12-01T00:00:00.000Z",
        createdAt: "2025-12-01T00:00:00.000Z",
      },
    ],
  };

  it("uses the price in force on a past invoice date", () => {
    expect(purchasePriceForDate(product, "2025-12-28")).toBe(101.02);
  });

  it("uses the newer price once its effective date is reached", () => {
    expect(purchasePriceForDate(product, "2026-01-01")).toBe(105);
  });

  it("keeps the saved invoice rate when no historical price existed yet", () => {
    expect(purchasePriceForDate(product, "2025-11-01", 92.6)).toBe(92.6);
  });
});
