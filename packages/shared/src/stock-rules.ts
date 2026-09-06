/** Canonical wet-stock vocabulary shared by calculations and UI projections. */
export const stockRuleDefinitions = {
  invoiceDate: "The date printed on the supplier document. It is an accounting date and never determines when stock physically entered a tank.",
  receivedAt: "The effective date and time when stock physically entered the selected tank. Inventory receipt movements use this timestamp.",
  bookStock: "Configured opening balance plus receipts, minus sales, plus or minus approved adjustments, calculated at a stated time.",
  physicalStock: "A measured tank quantity captured at a stated time. It is evidence and does not change book stock by itself.",
  shiftOpening: "The physical tank quantity captured when a shift begins. It remains an immutable snapshot for that shift.",
  expectedClosing: "Shift opening plus receipts during the shift, minus sales, minus testing not returned, plus or minus other approved adjustments during the shift.",
  actualClosing: "The physical tank quantity measured when the shift ends.",
  variance: "Actual closing minus expected closing. It remains visible until reviewed and is not an automatic stock adjustment.",
} as const;

export type StockRuleTerm = keyof typeof stockRuleDefinitions;
export type BookStockInputs = { openingBalance: number; receipts: number; sales: number; approvedAdjustments: number };
export type ShiftStockBridgeInputs = { shiftOpening: number; receiptsDuringShift: number; salesDuringShift: number; testingNotReturned: number; approvedAdjustmentsDuringShift: number };

export const calculateBookStock = (input: BookStockInputs) =>
  input.openingBalance + input.receipts - input.sales + input.approvedAdjustments;

export const calculateExpectedClosing = (input: ShiftStockBridgeInputs) =>
  input.shiftOpening + input.receiptsDuringShift - input.salesDuringShift - input.testingNotReturned + input.approvedAdjustmentsDuringShift;

export const calculateStockVariance = (actualClosing: number, expectedClosing: number) =>
  actualClosing - expectedClosing;
