export type WhatsAppTemplateStyle = "ALERT_BODY" | "NO_PARAMETERS";

export function buildWhatsAppTemplate(name: string, language: string, style: WhatsAppTemplateStyle, message: string) {
  return {
    name,
    language: { code: language },
    ...(style === "ALERT_BODY"
      ? { components: [{ type: "body", parameters: [{ type: "text", text: message }] }] }
      : {}),
  };
}
