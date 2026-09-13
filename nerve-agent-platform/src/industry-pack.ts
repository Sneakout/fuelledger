export type IndustryTerminology = {
  packId: string;
  version: string;
  location: string;
  inventoryUnit: string;
  product: string;
  customer: string;
  receivable: string;
  profitReport: string;
};

export type IndustryConcept = { conceptKey: string; displayName: string; capabilityIds: string[] };
export type PackThresholdDefinition = { thresholdKey: string; description: string; valueType: "NUMBER" | "PERCENT" | "DURATION_MINUTES"; minimum?: number; maximum?: number; applicationEvaluated: true };
export type IndustryPack = {
  packId: string;
  version: string;
  terminology: IndustryTerminology;
  concepts: IndustryConcept[];
  findingKeys: string[];
  thresholdDefinitions: PackThresholdDefinition[];
  questionIntents: Record<string, string>;
  evidenceTypes: string[];
};

export const genericCommercePack: IndustryTerminology = {
  packId: "generic-commerce",
  version: "1.0.0",
  location: "location",
  inventoryUnit: "stock item",
  product: "product",
  customer: "customer",
  receivable: "receivable",
  profitReport: "profit report",
};

export const fuelRetailIndustryPack: IndustryPack = {
  packId: "fuel-retail", version: "1.0.0",
  terminology: { packId: "fuel-retail", version: "1.0.0", location: "station", inventoryUnit: "tank", product: "fuel product", customer: "credit customer", receivable: "customer due", profitReport: "journal-derived profit report" },
  concepts: ["tank", "nozzle", "meter-reading", "density", "wet-stock-variance", "shift-reconciliation", "receipt-timing"].map(conceptKey => ({ conceptKey, displayName: conceptKey.replaceAll("-", " "), capabilityIds: conceptKey === "shift-reconciliation" ? ["reconciliation.exceptions.read"] : ["inventory.position.read"] })),
  findingKeys: ["inventory.low", "inventory.empty", "inventory.variance", "density.missing", "receipt.timing", "shift.variance", "shift.overdue"],
  thresholdDefinitions: [
    { thresholdKey: "inventory.lowPercent", description: "Source-application low-stock threshold.", valueType: "PERCENT", minimum: 0, maximum: 100, applicationEvaluated: true },
    { thresholdKey: "inventory.varianceTolerance", description: "Source-application wet-stock tolerance.", valueType: "NUMBER", minimum: 0, applicationEvaluated: true },
    { thresholdKey: "shift.overdueMinutes", description: "Source-application overdue shift duration.", valueType: "DURATION_MINUTES", minimum: 1, applicationEvaluated: true },
  ],
  questionIntents: { inventory: "inventory.position.read", reconciliation: "reconciliation.exceptions.read", receivables: "receivables.ageing.read", profit: "profit.summary.read" },
  evidenceTypes: ["TANK_TIMELINE", "METER_READING", "DENSITY_READING", "SHIFT_RECONCILIATION", "PURCHASE_RECEIPT", "JOURNAL_SUMMARY"],
};

export const genericCommerceIndustryPack: IndustryPack = {
  packId: "generic-commerce", version: "1.0.0", terminology: genericCommercePack,
  concepts: ["product", "inventory-location", "invoice", "customer", "receivable", "expense", "profit"].map(conceptKey => ({ conceptKey, displayName: conceptKey.replaceAll("-", " "), capabilityIds: conceptKey === "receivable" ? ["receivables.ageing.read"] : conceptKey === "profit" || conceptKey === "expense" ? ["profit.summary.read"] : ["inventory.position.read"] })),
  findingKeys: ["inventory.low", "inventory.empty", "inventory.variance", "receivable.overdue", "profit.materialChange"],
  thresholdDefinitions: [
    { thresholdKey: "inventory.lowPercent", description: "Source-application low-stock threshold.", valueType: "PERCENT", minimum: 0, maximum: 100, applicationEvaluated: true },
    { thresholdKey: "receivable.overdueDays", description: "Source-application overdue-age threshold.", valueType: "NUMBER", minimum: 0, applicationEvaluated: true },
    { thresholdKey: "profit.materialChangePercent", description: "Source-application material-change threshold.", valueType: "PERCENT", minimum: 0, maximum: 100, applicationEvaluated: true },
  ],
  questionIntents: { inventory: "inventory.position.read", receivables: "receivables.ageing.read", profit: "profit.summary.read" },
  evidenceTypes: ["INVENTORY_POSITION", "RECEIVABLES_AGEING", "PROFIT_SUMMARY", "INVOICE"],
};
