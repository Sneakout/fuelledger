export type LandedPriceLine = {
  key: string;
  quantity: number;
  sourceUnit?: string | null;
  productUnit: string;
  baseAmount: number;
  taxRate?: number | null;
};

export type LandedPriceResult = {
  key: string;
  normalizedQuantity: number;
  baseAmount: number;
  directTax: number;
  allocatedCharges: number;
  taxInclusiveAmount: number;
  unitPrice: number;
};

/**
 * Calculates tax-inclusive purchase prices without rounding intermediate values.
 * Invoice-level charges are allocated by product value only after any reliable
 * line tax has been attributed. Deposits and unrelated adjustments must be
 * supplied as excludedAmount and never enter a product's purchase price.
 */
export function calculateLandedPurchasePrices(input: {
  invoiceTotal: number;
  excludedAmount?: number;
  lines: LandedPriceLine[];
}): LandedPriceResult[] | null {
  const { invoiceTotal, lines } = input;
  const excludedAmount = input.excludedAmount ?? 0;
  if (!finite(invoiceTotal) || invoiceTotal <= 0 || !finite(excludedAmount) || excludedAmount < 0 || !lines.length) return null;

  const grouped = new Map<string, { key: string; normalizedQuantity: number; baseAmount: number; directTax: number }>();
  for (const line of lines) {
    const quantity = quantityInUnit(line.quantity, line.sourceUnit, line.productUnit);
    const taxRate = line.taxRate ?? 0;
    if (!line.key || !finite(quantity) || quantity <= 0 || !finite(line.baseAmount) || line.baseAmount < 0 || !finite(taxRate) || taxRate < 0 || taxRate > 100) return null;
    const current = grouped.get(line.key) ?? { key: line.key, normalizedQuantity: 0, baseAmount: 0, directTax: 0 };
    current.normalizedQuantity += quantity;
    current.baseAmount += line.baseAmount;
    current.directTax += line.baseAmount * taxRate / 100;
    grouped.set(line.key, current);
  }

  const values = [...grouped.values()];
  const baseSubtotal = values.reduce((sum, line) => sum + line.baseAmount, 0);
  const landedInvoiceTotal = invoiceTotal - excludedAmount;
  if (!(baseSubtotal > 0) || !(landedInvoiceTotal > 0) || landedInvoiceTotal + 0.02 < baseSubtotal) return null;

  const statedCharges = landedInvoiceTotal - baseSubtotal;
  const statedDirectTax = values.reduce((sum, line) => sum + line.directTax, 0);
  // OCR tax rates are advisory. Do not attribute more line tax than the invoice
  // actually contains; fall back to proportional allocation when inconsistent.
  const useDirectTax = statedDirectTax <= statedCharges + 0.02;
  const directTaxTotal = useDirectTax ? statedDirectTax : 0;
  const sharedCharges = statedCharges - directTaxTotal;

  return values.map(line => {
    const directTax = useDirectTax ? line.directTax : 0;
    const allocatedCharges = directTax + sharedCharges * (line.baseAmount / baseSubtotal);
    const taxInclusiveAmount = line.baseAmount + allocatedCharges;
    return {
      key: line.key,
      normalizedQuantity: line.normalizedQuantity,
      baseAmount: line.baseAmount,
      directTax,
      allocatedCharges,
      taxInclusiveAmount,
      unitPrice: taxInclusiveAmount / line.normalizedQuantity,
    };
  });
}

export function quantityInUnit(quantity: number, sourceUnit: string | null | undefined, productUnit: string) {
  if (!finite(quantity) || quantity <= 0) return Number.NaN;
  const source = normalizeUnit(sourceUnit || productUnit);
  const target = normalizeUnit(productUnit);
  if (!source || !target || source === target) return quantity;
  if (source === "KL" && target === "L") return quantity * 1_000;
  if (source === "L" && target === "KL") return quantity / 1_000;
  if (source === "MT" && target === "KG") return quantity * 1_000;
  if (source === "KG" && target === "MT") return quantity / 1_000;
  return Number.NaN;
}

function normalizeUnit(value: string) {
  const unit = value.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (["L", "LTR", "LTRS", "LITRE", "LITRES", "LITER", "LITERS"].includes(unit)) return "L";
  if (["KL", "KILOLITRE", "KILOLITRES", "KILOLITER", "KILOLITERS"].includes(unit)) return "KL";
  if (["KG", "KGS", "KILOGRAM", "KILOGRAMS"].includes(unit)) return "KG";
  if (["MT", "TONNE", "TONNES", "METRICTON", "METRICTONS"].includes(unit)) return "MT";
  return unit;
}

function finite(value: number) { return Number.isFinite(value); }
