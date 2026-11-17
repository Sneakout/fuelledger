type FuelNerveAgent = {
  agentKey: string;
  name: string;
  purpose: string;
  icon: "shift" | "stock" | "profit" | "assistant" | "specialist";
  area: string;
  aliases?: string[];
  checks: string[];
};

export const fuelNerveAgents: FuelNerveAgent[] = [
  { agentKey: "reconciliation-review", name: "Shift Agent", purpose: "Shifts, collections and handovers", icon: "shift", area: "Operations", checks: ["Open or overdue shifts", "Missing readings and collections", "Differences that still need reconciliation"] },
  { agentKey: "inventory-watch", name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock", area: "Operations", checks: ["Empty and low-stock tanks", "Physical stock compared with book stock", "Missing density readings and unusual movement"] },
  { agentKey: "credit-watch", aliases: ["receivables-watch"], name: "Credit Agent", purpose: "Customer dues, ageing and reminder drafts", icon: "specialist", area: "Money", checks: ["Customer payments that are overdue", "Partial payments and agreed credit limits", "Verified details for reminder drafts"] },
  { agentKey: "purchase-check", name: "Purchase Agent", purpose: "Invoices, receipts, rates and supplier payments", icon: "specialist", area: "Money", checks: ["Invoice and delivery quantity differences", "Possible duplicates and rate differences", "Supplier payments that are overdue"] },
  { agentKey: "profit-insight", name: "Profit Agent", purpose: "Margins, costs and financial changes", icon: "profit", area: "Money", checks: ["Revenue and cost changes", "Fuel and non-fuel contribution", "Comparable periods and missing costs"] },
  { agentKey: "business-assistant", aliases: ["owner-assistant"], name: "Nerve Assistant", purpose: "Connects findings and answers with supporting records", icon: "assistant", area: "Your guide", checks: ["Brings related agent findings together", "Explains why an issue comes first", "Takes you to the exact supporting records"] },
];

export function findFuelNerveAgent(key: string) {
  return fuelNerveAgents.find(agent => agent.agentKey === key || agent.aliases?.includes(key));
}

export const intelligenceWhatsAppAgents = {
  LOW_STOCK: "inventory-watch",
  SHIFT_CLOSED_SUMMARY: "reconciliation-review",
  PURCHASE_RECEIPT_SUMMARY: "purchase-check",
  OVERDUE_CUSTOMER: "credit-watch",
  CUSTOMER_CREDIT_REMINDER: "credit-watch",
} as const;

export function allowsOwnerWhatsApp(type: string, recordType: string, intelligenceActive: boolean) {
  if (type === "SYSTEM_TEST" || type === "OWNER_WELCOME") return true;
  if (!intelligenceActive) return type === "DAILY_SUMMARY" && recordType === "CORE_DAILY_SUMMARY";
  return type !== "CUSTOMER_CREDIT_REMINDER" && Object.hasOwn(intelligenceWhatsAppAgents, type);
}

export function hasActiveIntelligence(plan: {
  intelligenceEnabledAt?: Date | string | null;
  intelligenceExpiresAt?: Date | string | null;
} | null, now = new Date()) {
  return Boolean(plan?.intelligenceEnabledAt && new Date(plan.intelligenceEnabledAt) <= now
    && (!plan.intelligenceExpiresAt || new Date(plan.intelligenceExpiresAt) > now));
}
