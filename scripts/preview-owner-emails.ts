import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emailCategories, renderOwnerEmail } from '../apps/api/src/modules/notifications/email-template.js';

// Synthetic examples only. Never read customer records or send email from this script.
async function main() {
const directory = resolve(process.argv[2] ?? '/tmp/fuelnerve-email-previews');
await mkdir(directory, { recursive: true });
const examples = {
  OWNER_WELCOME: 'Your account for Greenway Fuel Point is ready.\nReview fuel station setup, then get started with shifts, sales and tank stock.',
  DAILY_SUMMARY: 'FuelNerve · Daily operating summary · 2026-11-20\n\nSales: MS: 2,000 L, HSD: 3,500 L\n\nCollections (reconciled shifts): ₹5,20,000.00\n\nTank book stock:\nGreenway Fuel Point · MS T-1: 8,250 L\nGreenway Fuel Point · HSD T-2: 12,600 L',
  LOW_STOCK: 'FuelNerve Stock Agent · Greenway Fuel Point\nMS tank T-1: 3,200 L book stock. Stock is at or below the 20% alert threshold.',
  SHIFT_CLOSED_SUMMARY: 'FuelNerve Shift Agent · Shift #42 reconciled · Greenway Fuel Point\nSales: MS: 2,000 L · HSD: 3,500 L\nExpected collection: ₹5,20,000.00\nActual collection: ₹5,19,750.00\nShortage: ₹250.00\nClosing tank stock:\nMS T-1: 8,240 L measured · 8,250 L book\nHSD T-2: 12,600 L measured · 12,600 L book',
  PURCHASE_RECEIPT_SUMMARY: 'FuelNerve Purchase Agent · Stock received · Greenway Fuel Point\nSupplier: Example Fuel Supplier · Received: 2026-11-20\nMS: 10,000 L → Tank T-1\nHSD: 8,000 L → Tank T-2\nInvoice INV-2042: ₹17,10,000.00\nPayment outstanding: ₹10,00,000.00 · Due: 2026-11-27',
  OVERDUE_CUSTOMER: 'FuelNerve Credit Agent · Customer dues\n₹44,000.00 outstanding · ₹18,000.00 overdue\nExample Logistics: ₹28,000.00 outstanding · ₹18,000.00 overdue · oldest 12 days\nExample Travels: ₹16,000.00 outstanding · None overdue',
};
for (const type of emailCategories) {
  const result = renderOwnerEmail({ type, message: examples[type], ownerName: 'Alex', stationName: 'Greenway Fuel Point · Example preview', appUrl: 'https://fuel.mindvector.tech', date: '20 November 2026' });
  await writeFile(resolve(directory, `${type.toLowerCase()}.html`), result.html);
}
console.log(`Created ${emailCategories.length} synthetic email previews in ${directory}`);

}
void main();
