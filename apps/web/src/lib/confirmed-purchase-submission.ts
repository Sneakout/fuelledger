import type { PurchaseInvoiceInput } from "@fuelledger/shared";
import type { PurchaseInvoice, PurchaseProduct, PurchaseStation, Supplier } from "./api";
import { calculatedInvoiceTotal, validateEditableInvoiceDraft, type EditableInvoiceDraft } from "../components/EditableInvoiceReviewDialog";
import { defaultPurchaseDueDate } from "./purchase-due-date";

export function findMatchingSupplier(draft: EditableInvoiceDraft, suppliers: Supplier[]) {
  const gstin = normalize(draft.supplierGSTIN);
  if (gstin) {
    const gstinMatches = suppliers.filter(supplier => normalize(supplier.taxId) === gstin);
    if (gstinMatches.length === 1) return gstinMatches[0]!.id;
  }
  const name = normalize(draft.supplierName);
  const nameMatches = suppliers.filter(supplier => normalize(supplier.name) === name);
  return nameMatches.length === 1 ? nameMatches[0]!.id : "";
}

export function findMatchingProduct(description: string, product: string, hsnCode: string, products: PurchaseProduct[]) {
  const hsn = normalize(hsnCode);
  if (hsn) {
    const matches = products.filter(item => normalize(item.hsnCode) === hsn);
    if (matches.length === 1) return matches[0]!.id;
  }
  const candidates = new Set([normalize(description), normalize(product)].filter(Boolean));
  const exact = products.filter(item => candidates.has(normalize(item.name)) || candidates.has(normalize(item.code)));
  return exact.length === 1 ? exact[0]!.id : null;
}

export function compatibleTanks(stations: PurchaseStation[], stationId: string, productId: string) {
  return stations.find(station => station.id === stationId)?.configurations.flatMap(configuration => configuration.tanks).filter(tank => tank.productId === productId) ?? [];
}

export function onlyCompatibleTankId(stations: PurchaseStation[], stationId: string, productId: string) {
  const tanks = compatibleTanks(stations, stationId, productId);
  return tanks.length === 1 ? tanks[0]!.id : null;
}

export function validateReceiptSelections(
  receiveNow: boolean,
  stationId: string,
  productIds: Array<string | null>,
  tankIds: Array<string | null>,
  products: PurchaseProduct[],
  stations: PurchaseStation[],
) {
  if (!receiveNow) return [];
  const errors: string[] = [];
  productIds.forEach((productId, index) => {
    if (!productId) { errors.push(`Choose an inventory product for product ${index + 1}.`); return; }
    const product = products.find(item => item.id === productId);
    if (!product) { errors.push(`Choose an active inventory product for product ${index + 1}.`); return; }
    if (!product.tankLinked) return;
    const tankId = tankIds[index];
    const validTank = compatibleTanks(stations, stationId, productId).some(tank => tank.id === tankId);
    if (!validTank) errors.push(`Choose the receiving tank for ${product.name}.`);
  });
  return errors;
}

export function findDuplicateInvoice(supplierId: string, invoiceNumber: string, invoices: PurchaseInvoice[]) {
  const number = normalize(invoiceNumber);
  if (!supplierId || !number) return undefined;
  return invoices.find(invoice => invoice.supplier.id === supplierId && normalize(invoice.invoiceNumber) === number);
}

export function findDuplicateInvoiceForDraft(draft: EditableInvoiceDraft, suppliers: Supplier[], invoices: PurchaseInvoice[]) {
  const supplierId = findMatchingSupplier(draft, suppliers);
  return supplierId ? findDuplicateInvoice(supplierId, draft.invoiceNumber, invoices) : undefined;
}

export function validateConfirmedPurchase(draft: EditableInvoiceDraft, stationId: string, supplierId: string) {
  const dueDate = draft.dueDate || defaultPurchaseDueDate(draft.invoiceDate);
  const errors = validateEditableInvoiceDraft({ ...draft, dueDate });
  if (!stationId) errors.push("The selected fuel station is not available in Purchases.");
  if (!supplierId) errors.push("Choose the existing supplier for this invoice.");
  if (!dueDate) errors.push("Enter a valid invoice date so FuelNerve can set the T+3 due date.");
  if (Math.abs(Number(draft.totalAmount) - calculatedInvoiceTotal(draft)) >= 0.02) errors.push("Make the invoice total match the product amounts and tax to the nearest paise.");
  return [...new Set(errors)];
}

export function buildConfirmedPurchaseInput(
  draft: EditableInvoiceDraft,
  stationId: string,
  supplierId: string,
  productIds: Array<string | null>,
  options: { receiveNow?: boolean; tankIds?: Array<string | null> } = {},
): PurchaseInvoiceInput {
  const errors = validateConfirmedPurchase(draft, stationId, supplierId);
  if (errors.length) throw new Error(errors[0]);
  const receiveNow = options.receiveNow ?? true;
  const tankIds = options.tankIds ?? [];
  return {
    stationId,
    supplierId,
    invoiceNumber: draft.invoiceNumber.trim(),
    invoiceDate: isoDate(draft.invoiceDate),
    dueDate: isoDate(draft.dueDate || defaultPurchaseDueDate(draft.invoiceDate)),
    invoiceTotal: Number(draft.totalAmount),
    taxAmount: Number(draft.taxAmount || 0),
    purchasePriceExcludedAmount: Number(draft.purchasePriceExcludedAmount || 0) || undefined,
    receiveNow,
    paidNow: false,
    attachment: null,
    lines: draft.lines.map((line, index) => ({
      productId: productIds[index] || null,
      tankId: receiveNow ? tankIds[index] || null : null,
      description: line.description.trim(),
      quantity: Number(line.quantity),
      sourceUnit: line.unit.trim().toUpperCase() || undefined,
      unitCost: Number(line.unitRate),
      taxRate: Number(line.taxRate || 0),
      hsnCode: line.hsnCode.trim() || undefined,
    })),
  };
}

function isoDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
