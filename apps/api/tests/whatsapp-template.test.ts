import { describe, expect, it } from "vitest";
import { buildWhatsAppTemplate } from "../src/modules/notifications/whatsapp-template.js";

describe("WhatsApp template adapter", () => {
  it("places verified FuelNerve alert text in the approved body variable", () => {
    expect(buildWhatsAppTemplate("fuelnerve_alert", "en", "ALERT_BODY", "Low stock at Station A")).toEqual({
      name: "fuelnerve_alert",
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Low stock at Station A" }] }],
    });
  });

  it("sends Meta's parameter-free transport template without invented business content", () => {
    expect(buildWhatsAppTemplate("hello_world", "en_US", "NO_PARAMETERS", "Ignored test copy")).toEqual({
      name: "hello_world",
      language: { code: "en_US" },
    });
  });
});
