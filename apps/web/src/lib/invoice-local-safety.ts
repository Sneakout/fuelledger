import type { CatalogProduct } from "./api";
import type { EditableInvoiceDraft } from "../components/EditableInvoiceReviewDialog";

export type InvoiceStationAssessment = {
  status: "MATCH" | "MISMATCH" | "UNKNOWN";
  consigneeName: string;
  stationName: string;
  message: string;
};

export type InvoicePriceAssessment = {
  productId: string;
  productName: string;
  unit: string;
  previousPrice: number;
  invoicePrice: number;
  difference: number;
  percentageChange: number | null;
  direction: "INCREASE" | "DECREASE" | "UNCHANGED";
};

export function assessInvoiceStation(consigneeName: string | null | undefined, stationName: string | null | undefined): InvoiceStationAssessment {
  const consignee = consigneeName?.trim() ?? "";
  const station = stationName?.trim() ?? "";
  if (!consignee || !station) return {
    status: "UNKNOWN",
    consigneeName: consignee,
    stationName: station,
    message: "I could not verify which fuel station this invoice was delivered to. Check the consignee before continuing.",
  };
  if (sameStationName(consignee, station)) return {
    status: "MATCH",
    consigneeName: consignee,
    stationName: station,
    message: `${consignee} matches the selected fuel station.`,
  };
  return {
    status: "MISMATCH",
    consigneeName: consignee,
    stationName: station,
    message: `This invoice is for ${consignee}, not ${station}. It will stay on this device and cannot be submitted.`,
  };
}

export function assessSingleProductInvoicePrice(draft: EditableInvoiceDraft, products: CatalogProduct[]): InvoicePriceAssessment | null {
  if (draft.lines.length !== 1) return null;
  const line = draft.lines[0]!;
  const quantity = Number(line.quantity);
  const total = Number(draft.totalAmount);
  if (!(quantity > 0) || !(total > 0)) return null;
  const product = matchProduct(line.description, line.product, line.hsnCode, products);
  if (!product) return null;
  const invoicePrice = convertUnitPrice(total / quantity, line.unit, product.unit);
  const previousPrice = Number(product.purchasePrice);
  if (!Number.isFinite(invoicePrice) || invoicePrice <= 0 || !Number.isFinite(previousPrice) || previousPrice <= 0) return null;
  const difference = roundMoney(invoicePrice - previousPrice);
  const percentageChange = previousPrice > 0 ? roundMoney((difference / previousPrice) * 100) : null;
  return {
    productId: product.id,
    productName: product.name,
    unit: product.unit || line.unit || "unit",
    previousPrice: roundMoney(previousPrice),
    invoicePrice: roundMoney(invoicePrice),
    difference,
    percentageChange,
    direction: Math.abs(difference) < 0.01 ? "UNCHANGED" : difference > 0 ? "INCREASE" : "DECREASE",
  };
}

function matchProduct(description: string, productCode: string, hsnCode: string, products: CatalogProduct[]) {
  const exactTerms = new Set([normalize(description), normalize(productCode)].filter(Boolean));
  const exact = products.filter(product => exactTerms.has(normalize(product.name)) || exactTerms.has(normalize(product.code)));
  if (exact.length === 1) return exact[0];
  const family = products.filter(product => exactTerms.has(normalizeFuelFamily(product.name)) || exactTerms.has(normalizeFuelFamily(product.code)));
  if (family.length === 1) return family[0];
  const hsn = normalize(hsnCode);
  const hsnMatches = hsn ? products.filter(product => normalize(product.hsnCode) === hsn) : [];
  return hsnMatches.length === 1 ? hsnMatches[0] : null;
}

function sameStationName(left: string, right: string) {
  const exactLeft = normalize(left);
  const exactRight = normalize(right);
  if (exactLeft === exactRight) return true;
  const coreLeft = stationCore(left);
  const coreRight = stationCore(right);
  return coreLeft.length >= 4 && coreLeft === coreRight;
}

function stationCore(value: string) {
  return normalize(value.replace(/\b(?:PETROLEUM|PETROL|FUELS?|FUEL\s+STATION|PETROL\s+PUMP|SERVICE\s+STATION|INDIAN\s+OIL\s+DEALER|DEALER)\b/gi, " "));
}

function normalizeFuelFamily(value: string) {
  const normalized = normalize(value);
  if (/^(?:HSD|HIGHSPEEDDIESEL)/.test(normalized)) return "HSD";
  if (/^(?:MS|MOTORSPIRIT)/.test(normalized)) return "MS";
  return normalized;
}

function convertUnitPrice(value: number, fromUnit: string, toUnit: string) {
  const from = normalize(fromUnit);
  const to = normalize(toUnit);
  if (!from || !to || from === to) return value;
  if (from === "KL" && (to === "L" || to === "LTR" || to === "LITRE" || to === "LITER")) return value / 1000;
  if ((from === "L" || from === "LTR" || from === "LITRE" || from === "LITER") && to === "KL") return value * 1000;
  return Number.NaN;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
