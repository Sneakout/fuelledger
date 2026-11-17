import { describe, expect, it } from "vitest";
import { allowsOwnerWhatsApp, findFuelNerveAgent, hasActiveIntelligence } from "./fuelnerve-agents.js";

describe("FuelNerve WhatsApp plan rules", () => {
  it("reserves the operating summary for Core and blocks the old briefing on both plans", () => {
    expect(allowsOwnerWhatsApp("DAILY_SUMMARY", "CORE_DAILY_SUMMARY", false)).toBe(true);
    expect(allowsOwnerWhatsApp("DAILY_SUMMARY", "CORE_DAILY_SUMMARY", true)).toBe(false);
    for (const active of [false, true]) {
      expect(allowsOwnerWhatsApp("DAILY_SUMMARY", "DAILY_BRIEFING", active)).toBe(false);
      expect(allowsOwnerWhatsApp("APPROVAL_REQUIRED", "PRODUCT_PRICE_CHANGE_REQUEST", active)).toBe(false);
      expect(allowsOwnerWhatsApp("CUSTOMER_CREDIT_REMINDER", "CUSTOMER_RECEIVABLE", active)).toBe(false);
    }
  });

  it("stops Intelligence alerts at expiry and continues to recognise saved agent aliases", () => {
    const plan = { intelligenceEnabledAt: "2026-11-01", intelligenceExpiresAt: "2026-12-01" };
    expect(allowsOwnerWhatsApp("LOW_STOCK", "TANK", hasActiveIntelligence(plan, new Date("2026-11-30")))).toBe(true);
    expect(allowsOwnerWhatsApp("LOW_STOCK", "TANK", hasActiveIntelligence(plan, new Date("2026-12-01")))).toBe(false);
    expect(findFuelNerveAgent("receivables-watch")?.agentKey).toBe("credit-watch");
    expect(findFuelNerveAgent("owner-assistant")?.agentKey).toBe("business-assistant");
  });
});
