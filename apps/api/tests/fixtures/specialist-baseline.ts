export type SpecialistBaselineScenario = {
  id: string;
  specialist: "SHIFT" | "STOCK" | "PROFIT";
  title: string;
  sanitizedInput: Record<string, unknown>;
  expectedFindingKeys: string[];
  expectedPriority: string;
  expectedEvidencePath: string;
  recommendedNextCheck: string;
  unsupportedClaims: string[];
};

export const specialistBaselineScenarios: SpecialistBaselineScenario[] = [
  {
    id: "shift-strongest-review-signal",
    specialist: "SHIFT",
    title: "A completed shift has missing closing records and a collection difference",
    sanitizedInput: {
      stationId: "station-baseline",
      shiftNumber: 7,
      status: "RECONCILIATION_REQUIRED",
      awaitingMinutes: 240,
      missingClosingReadings: 2,
      missingCollectionDetails: 1,
      absoluteCollectionDifference: 50,
    },
    expectedFindingKeys: ["SHIFT_REVIEW_BRIEFING"],
    expectedPriority: "Shift 7 ranks first because its deterministic score combines waiting time, missing readings, missing collections and the absolute collection difference.",
    expectedEvidencePath: "/reconciliation",
    recommendedNextCheck: "Compare closing readings, nozzle collections, payment-method totals and the shift handover before reconciliation.",
    unsupportedClaims: ["The manager caused the difference", "The shift is fraudulent", "The difference is approved or resolved"],
  },
  {
    id: "stock-empty-with-receipt-context",
    specialist: "STOCK",
    title: "An empty recorded tank has a physical variance and an ambiguous recent receipt",
    sanitizedInput: {
      stationId: "station-baseline",
      tankCode: "T-EMPTY",
      productCode: "HSD",
      bookStockLitres: 0,
      physicalStockLitres: 10,
      varianceLitres: 10,
      morningDensityRecorded: false,
      ambiguousReceiptCount: 1,
    },
    expectedFindingKeys: ["INVENTORY_REVIEW_PRIORITY", "INVENTORY_EMPTY", "PHYSICAL_BOOK_VARIANCE", "DENSITY_READING_MISSING", "RECEIPT_TIMING_ANOMALY"],
    expectedPriority: "HSD T-EMPTY ranks ahead of a merely low tank because empty stock carries the highest deterministic stock score, followed by variance, receipt timing and missing density.",
    expectedEvidencePath: "/inventory",
    recommendedNextCheck: "Compare the physical reading with movements, recent receipts and approved adjustments, then verify the receipt document and physical arrival time.",
    unsupportedClaims: ["The physical reading is accurate", "The delivery arrived at the recorded time", "Stock was stolen", "An adjustment should be posted"],
  },
  {
    id: "profit-leading-movement",
    specialist: "PROFIT",
    title: "Revenue has the largest absolute movement between equivalent periods",
    sanitizedInput: {
      stationId: "station-baseline",
      currentPeriod: { start: "2026-09-01", end: "2026-09-07", revenue: 1000, costOfSales: 600, operatingExpenses: 100, netProfit: 300 },
      previousPeriod: { start: "2026-08-25", end: "2026-08-31", revenue: 800, costOfSales: 500, operatingExpenses: 100, netProfit: 200 },
    },
    expectedFindingKeys: ["PROFIT_POSITION", "PROFIT_CHANGE_MATERIAL"],
    expectedPriority: "Revenue ranks first because its absolute movement is the largest and the configured ten-percent materiality rule is crossed.",
    expectedEvidencePath: "/reports",
    recommendedNextCheck: "Open the profit report and inspect the posted journals behind revenue, cost of sales and operating expenses.",
    unsupportedClaims: ["Revenue changed because of price", "The movement will continue", "A journal is incorrect", "The agent calculated a new accounting result"],
  },
];
