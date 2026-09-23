export const DEFAULT_PURCHASE_DUE_DAYS = 3;

export function defaultPurchaseDueDate(invoiceDate: string) {
  const match = invoiceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + DEFAULT_PURCHASE_DUE_DAYS);
  return date.toISOString().slice(0, 10);
}
