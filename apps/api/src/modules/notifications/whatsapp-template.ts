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

export const operationalBodies: Record<string, string> = {
  fuelnerve_stock_level_v1: 'FuelNerve stock alert for your fuel station. A tank has reached its configured reorder threshold. {{1}} Review the tank record in FuelNerve to confirm whether a delivery is needed.',
  fuelnerve_shift_closed_v1: 'FuelNerve shift closure report for your fuel station. The shift has been closed and its sales, collections and closing tank stock have been recorded. {{1}} Review the shift reconciliation in FuelNerve for the original readings.',
  fuelnerve_purchase_receipt_v1: 'FuelNerve purchase receipt for your fuel station. A supplier delivery has been recorded against a purchase invoice. {{1}} Review the purchase invoice in FuelNerve for receipt and payment details.',
  fuelnerve_owner_credit_v1: 'FuelNerve customer credit report for your fuel station. The following customer balances are outstanding as of this report. {{1}} Review customer accounts in FuelNerve before following up.',
  fuelnerve_customer_payment_reminder_v1: 'Payment reminder for your fuel account. Our records show an overdue balance. {{1}} If you have already paid or believe the balance is incorrect, please contact your fuel station.',
  fuelnerve_daily_operations_v1: 'FuelNerve daily operations report for your fuel station. This is the daily summary of recorded fuel sales, collections and tank stock. {{1}} Review the station dashboard in FuelNerve for the underlying records.',
};

export const welcomeTemplate = {
  name: 'fuelnerve_owner_welcome_v1',
  language: 'en',
  body: '*Welcome to FuelNerve, {{1}}!*\n\nYour account for *{{2}}* is ready. Open FuelNerve to review your fuel station setup and get started with shifts, sales, and tank stock.\n\nTo choose which updates you receive here, go to *Settings → WhatsApp alerts*.',
  button: { type: 'URL', text: 'Open FuelNerve', url: 'https://fuel.mindvector.tech/' },
} as const;

export function buildWelcomeMessage(ownerName: string, stationName: string) {
  const firstName = ownerName.trim().split(/\s+/)[0] || 'there';
  const station = stationName.replace(/\s+/g, ' ').trim();
  const parameters = [firstName, station].map(text => ({ type: 'text', text }));
  return {
    body: welcomeTemplate.body.replace(/{{([12])}}/g, (_, index: string) => parameters[Number(index) - 1]!.text),
    template: { name: welcomeTemplate.name, language: { code: welcomeTemplate.language }, components: [{ type: 'body', parameters }] },
  };
}
