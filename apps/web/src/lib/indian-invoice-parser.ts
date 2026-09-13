export type InvoiceCandidate<T> = {
  value: T;
  sourceLine: string;
  lineNumber: number;
  needsReview: boolean;
};

export type IndianInvoiceLine = {
  description: string;
  product: "HSD" | "MS" | "PETROL" | "DIESEL" | "CNG" | "DEF" | "LUBRICANT" | "ETHANOL" | "AUTO_LPG" | "LNG" | "AVIATION_FUEL" | "OTHER";
  hsnCode: string | null;
  quantity: number;
  unit: string | null;
  unitRate: number;
  amount: number | null;
  sourceLine: string;
  lineNumber: number;
};

export type ParsedIndianInvoice = {
  status: "READY_FOR_REVIEW" | "NEEDS_REVIEW";
  supplierName: InvoiceCandidate<string> | null;
  supplierGSTIN: InvoiceCandidate<string> | null;
  consigneeName: InvoiceCandidate<string> | null;
  consigneeCode: InvoiceCandidate<string> | null;
  buyerGSTIN: InvoiceCandidate<string> | null;
  invoiceNumber: InvoiceCandidate<string> | null;
  invoiceDate: InvoiceCandidate<string> | null;
  dueDate: InvoiceCandidate<string> | null;
  subtotal: InvoiceCandidate<number> | null;
  totalAmount: InvoiceCandidate<number> | null;
  tax: {
    cgst: InvoiceCandidate<number> | null;
    sgst: InvoiceCandidate<number> | null;
    igst: InvoiceCandidate<number> | null;
    cess: InvoiceCandidate<number> | null;
    total: number | null;
  };
  lines: IndianInvoiceLine[];
  missingFields: string[];
  warnings: string[];
};

type SourceLine = { text: string; number: number };

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/gi;
const PRODUCT_RULES: Array<{ pattern: RegExp; product: IndianInvoiceLine["product"] }> = [
  { pattern: /\b(?:HSD|HIGH\s+SPEED\s+DIESEL)(?:[-\s]?(?:BS)?[-\s]?(?:VI|V1))?\b/i, product: "HSD" },
  { pattern: /\b(?:XTRA\s*GREEN|XTRA\s*MILE)(?:\s+(?:DIESEL|HSD))?\b/i, product: "HSD" },
  { pattern: /\bV[-\s]?POWER\s+(?:DIESEL|HSD)\b/i, product: "HSD" },
  { pattern: /\b(?:MS|MOTOR\s+SPIRIT)(?:[-\s]?(?:BS)?[-\s]?(?:VI|V1))?\b/i, product: "MS" },
  { pattern: /\b(?:XP\s*(?:95|100)|XTRA\s*PREMIUM|SPEED(?:\s*(?:95|97))?|(?:HP\s*)?POWER\s*(?:95|99))\b/i, product: "MS" },
  { pattern: /\bV[-\s]?POWER\s+(?:PETROL|MS)\b/i, product: "MS" },
  { pattern: /\bPETROL\b/i, product: "PETROL" },
  { pattern: /\bDIESEL\b/i, product: "DIESEL" },
  { pattern: /\bCNG\b/i, product: "CNG" },
  { pattern: /\b(?:DEF|ADBLUE)\b/i, product: "DEF" },
  { pattern: /\b(?:LUBRICANT|ENGINE\s+OIL|SERVO|MAK\s+LUBRICANTS?)\b/i, product: "LUBRICANT" },
  { pattern: /\b(?:ETHANOL\s*100|E100)\b/i, product: "ETHANOL" },
  { pattern: /\b(?:AUTO\s*LPG|AUTOGAS)\b/i, product: "AUTO_LPG" },
  { pattern: /\bLNG\b/i, product: "LNG" },
  { pattern: /\b(?:ATF|JET\s*A[-\s]?1|AVIATION\s+TURBINE\s+FUEL)\b/i, product: "AVIATION_FUEL" },
  { pattern: /\b(?:V[-\s]?POWER|STORM(?:[-\s]?X)?)\b/i, product: "OTHER" },
];
const PRODUCT_PATTERN = new RegExp(PRODUCT_RULES.map(rule => `(?:${rule.pattern.source})`).join("|"), "i");
const GENERIC_SUPPLIER_LINE = /\b(?:tax\s+invoice|invoice|original|duplicate|triplicate|gstin|gst\s+no|bill\s+to|ship\s+to|buyer|consignee|payer|date|phone|mobile|email|grand\s+total|total|amount|page\s+\d|invoice\s+under|government\s+of\s+india)\b/i;

export function parseIndianInvoice(text: string): ParsedIndianInvoice {
  const lines = sourceLines(text);
  const warnings: string[] = [];
  const invoiceNumber = findInvoiceNumber(lines);
  const invoiceDate = findDate(lines, /\b(?:invoice\s+date|dated|date)\b/i, "invoice date", warnings);
  const dueDate = findDate(lines, /\b(?:due\s+date|payment\s+due|payable\s+by)\b/i, "due date", warnings);
  const gstins = findGSTINs(lines);
  const supplierGSTIN = chooseGSTIN(gstins, "supplier");
  const buyerGSTIN = chooseGSTIN(gstins, "buyer");
  const supplierName = findSupplierName(lines);
  const consignee = findConsignee(lines);
  const totalAmount = findInvoiceTotal(lines);
  const subtotal = findAmount(lines, /\b(?:taxable\s+(?:amount|value)|sub\s*total|basic\s+amount)\b/i);
  const cgst = findAmount(lines, /\bCGST\b/i);
  const sgst = findAmount(lines, /\bSGST\b/i);
  const igst = findAmount(lines, /\bIGST\b/i);
  const cess = findAmount(lines, /\b(?:CESS|TCS)\b/i);
  const explicitTax = findAmount(lines, /\b(?:total\s+tax|tax\s+amount)\b/i);
  const componentTax = [cgst, sgst, igst, cess].reduce((sum, item) => sum + (item?.value ?? 0), 0);
  const itemLines = parseItemLines(lines);
  const productSubtotal = itemLines.reduce((sum, line) => sum + line.quantity * line.unitRate, 0);
  const derivedCharges = totalAmount && productSubtotal > 0 ? totalAmount.value - productSubtotal : null;
  let taxTotal = explicitTax?.value ?? (componentTax > 0 ? componentTax : null);
  if (derivedCharges !== null && derivedCharges >= 0 && (taxTotal === null || Math.abs(taxTotal - derivedCharges) > 1)) {
    taxTotal = Number(derivedCharges.toFixed(2));
    warnings.push("Taxes and charges were recovered from the invoice total. Check their classification before continuing.");
  }

  const missingFields: string[] = [];
  if (!supplierName) missingFields.push("supplier name");
  if (!invoiceNumber) missingFields.push("invoice number");
  if (!invoiceDate) missingFields.push("invoice date");
  if (!totalAmount) missingFields.push("invoice total");
  if (!itemLines.length) missingFields.push("product lines");

  if (invoiceNumber?.needsReview) warnings.push("Check the invoice number against the document before continuing.");
  if (gstins.length > 1 && !supplierGSTIN) warnings.push("More than one GST number was found, but the supplier’s GST number was not clear.");
  if (subtotal && taxTotal !== null && totalAmount) {
    const difference = Math.abs(subtotal.value + taxTotal - totalAmount.value);
    if (difference > 1) warnings.push("The taxable amount and tax do not add up to the invoice total. Check the figures against the document.");
  }
  for (const line of itemLines) {
    if (line.amount !== null && Math.abs(line.quantity * line.unitRate - line.amount) > 1) {
      warnings.push(`The quantity and rate do not match the amount shown for ${line.description}.`);
    }
  }
  if (missingFields.length) warnings.unshift(`Could not safely read: ${humanList(missingFields)}.`);

  return {
    status: missingFields.length === 0 && warnings.length === 0 ? "READY_FOR_REVIEW" : "NEEDS_REVIEW",
    supplierName,
    supplierGSTIN,
    consigneeName: consignee.name,
    consigneeCode: consignee.code,
    buyerGSTIN,
    invoiceNumber,
    invoiceDate,
    dueDate,
    subtotal,
    totalAmount,
    tax: { cgst, sgst, igst, cess, total: taxTotal },
    lines: itemLines,
    missingFields,
    warnings: unique(warnings),
  };
}

function findConsignee(lines: SourceLine[]): { name: InvoiceCandidate<string> | null; code: InvoiceCandidate<string> | null } {
  for (const line of lines) {
    const payer = line.text.match(/\bPAYER\s*[-:]\s*(\d{3,})?\s*([A-Z][A-Z0-9&.'() /-]{1,80}?\b(?:PETROLEUM|PETROL(?:\s+PUMP)?|FUELS?|SERVICE\s+STATION|FILLING\s+STATION|ENERGY|ENTERPRISES?|TRADERS?|AGENC(?:Y|IES))\b)/i);
    if (payer?.[2]) {
      const name = cleanPartyName(payer[2]);
      if (looksLikePartyName(name)) return { name: candidate(name, line), code: payer[1] ? candidate(payer[1], line) : null };
    }
  }

  const headingIndex = lines.findIndex(line => /\b(?:CONSIGNEE|SHIP\s+TO|DELIVER(?:ED)?\s+TO)\b/i.test(line.text));
  if (headingIndex < 0) return { name: null, code: null };
  const nearby = lines.slice(headingIndex, headingIndex + 10);
  const nameLine = nearby.find(line => looksLikePartyName(line.text) && !/\b(?:SUPPLIER|CONSIGNEE|SHIP\s+TO|NAME\s*&\s*ADDRESS|INDIAN\s+OIL\s+DEALER)\b/i.test(line.text));
  const codeLine = nearby.find(line => /\b\d{4,}\b/.test(line.text));
  const code = codeLine?.text.match(/\b(\d{4,})\b/)?.[1];
  return {
    name: nameLine ? candidate(cleanPartyName(nameLine.text), nameLine, true) : null,
    code: code && codeLine ? candidate(code, codeLine, true) : null,
  };
}

function cleanPartyName(value: string) {
  return value
    .replace(/\b(?:INDIAN\s+OIL\s+DEALER|DEALER)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[^A-Z0-9]+|[^A-Z0-9)&.'-]+$/gi, "")
    .trim();
}

function looksLikePartyName(value: string) {
  return /\b(?:PETROLEUM|PETROL|FUELS?|SERVICE\s+STATION|ENERGY|FILLING\s+STATION|ENTERPRISES?)\b/i.test(value) && !/\b(?:SUPPLIER\s+TAN|TOTAL|INVOICE)\b/i.test(value);
}

function sourceLines(text: string): SourceLine[] {
  return text.split(/\r?\n/).map((value, index) => ({ text: value.replace(/\s+/g, " ").trim(), number: index + 1 })).filter(line => line.text.length > 0);
}

function candidate<T>(value: T, line: SourceLine, needsReview = false): InvoiceCandidate<T> {
  return { value, sourceLine: line.text, lineNumber: line.number, needsReview };
}

function findInvoiceNumber(lines: SourceLine[]): InvoiceCandidate<string> | null {
  const labelled = [
    /\b(?:tax\s+)?invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})\b/i,
    /\b(?:bill|document|doc)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})\b/i,
    /\binv(?:\.|\s+(?:no\.?|number|#))\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})\b/i,
  ];
  for (const line of lines) {
    for (const pattern of labelled) {
      const match = line.text.match(pattern);
      if (match?.[1] && !/^\d{1,2}$/.test(match[1])) return candidate(match[1], line);
    }
  }
  for (const line of lines) {
    const match = line.text.match(/\bTAX\s+INVOICE\s+([A-Z0-9][A-Z0-9/\-]{7,})\b/i);
    if (match?.[1] && !/^(?:UNDER|RULE|NO|NUMBER)$/i.test(match[1])) return candidate(match[1], line, true);
  }
  return null;
}

function findDate(lines: SourceLine[], label: RegExp, fieldName: string, warnings: string[]): InvoiceCandidate<string> | null {
  const datePatterns = [
    /\b(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4}))\b/,
    /\b(\d{1,2}[\s\-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s\-](?:\d{2}|\d{4}))\b/i,
    /\b(\d{4}-\d{2}-\d{2})\b/,
  ];
  for (const line of lines.filter(line => label.test(line.text))) {
    for (const pattern of datePatterns) {
      const match = line.text.match(pattern);
      if (!match?.[1]) continue;
      const normalized = normalizeDate(match[1]);
      if (normalized) return candidate(normalized, line);
      warnings.push(`The ${fieldName} “${match[1]}” is not a valid calendar date and was not used.`);
    }
  }
  if (fieldName === "invoice date") {
    for (const line of lines.slice(0, 30)) {
      for (const pattern of datePatterns) {
        const match = line.text.match(pattern);
        if (!match?.[1]) continue;
        const normalized = normalizeDate(match[1]);
        if (!normalized) continue;
        warnings.push("The invoice date was recovered without a clear label. Check it against the document before continuing.");
        return candidate(normalized, line, true);
      }
    }
  }
  return null;
}

function normalizeDate(value: string): string | null {
  const cleaned = value.trim().replace(/\s+/g, "-");
  let day: number; let month: number; let year: number;
  const numeric = cleaned.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/);
  if (numeric) {
    if (numeric[1]!.length === 4) {
      year = Number(numeric[1]); month = Number(numeric[2]); day = Number(numeric[3]);
    } else {
      day = Number(numeric[1]); month = Number(numeric[2]); year = Number(numeric[3]);
    }
  } else {
    const named = cleaned.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2}|\d{4})$/);
    if (!named) return null;
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[2]!.slice(0, 3).toLowerCase());
    if (monthIndex < 0) return null;
    day = Number(named[1]); month = monthIndex + 1; year = Number(named[3]);
  }
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function findGSTINs(lines: SourceLine[]) {
  return lines.flatMap(line => Array.from(line.text.matchAll(GSTIN_PATTERN), match => ({ value: match[0]!.toUpperCase(), line })));
}

function chooseGSTIN(items: Array<{ value: string; line: SourceLine }>, party: "supplier" | "buyer"): InvoiceCandidate<string> | null {
  const marker = party === "supplier" ? /\b(?:supplier|seller|vendor|from)\b/i : /\b(?:buyer|recipient|payer|consignee|bill\s+to|ship\s+to)\b/i;
  const opposite = party === "supplier" ? /\b(?:buyer|recipient|payer|consignee|bill\s+to|ship\s+to)\b/i : /\b(?:supplier|seller|vendor|from)\b/i;
  const explicit = items.find(item => marker.test(item.line.text));
  if (explicit) return candidate(explicit.value, explicit.line);
  if (party === "supplier" && items.length === 1 && !opposite.test(items[0]!.line.text)) return candidate(items[0]!.value, items[0]!.line, true);
  return null;
}

function findSupplierName(lines: SourceLine[]): InvoiceCandidate<string> | null {
  const knownOilCompany = lines.slice(0, 15).flatMap(line => {
    const match = line.text.match(/\b(Indian\s+Oil\s+Corporation\s+Limited|Bharat\s+Petroleum\s+Corporation\s+Limited|Hindustan\s+Petroleum\s+Corporation\s+Limited|Nayara\s+Energy(?:\s+Limited)?|Reliance\s+Industries(?:\s+Limited)?|Shell(?:\s+India)?)\b/i);
    return match?.[1] ? [{ line, value: match[1].replace(/\s+/g, " ") }] : [];
  })[0];
  if (knownOilCompany) return candidate(knownOilCompany.value, knownOilCompany.line);
  const labelled = lines.find(line => /\b(?:supplier|seller|vendor)\s*(?:name)?\s*[:\-]/i.test(line.text));
  if (labelled) {
    const value = labelled.text.replace(/^.*?\b(?:supplier|seller|vendor)\s*(?:name)?\s*[:\-]\s*/i, "").trim();
    if (looksLikeName(value)) return candidate(value, labelled);
  }
  const likely = lines.slice(0, 12).find(line => looksLikeName(line.text));
  return likely ? candidate(likely.text, likely, true) : null;
}

function looksLikeName(value: string) {
  return value.length >= 4 && value.length <= 100 && /[A-Za-z]{3}/.test(value) && !GENERIC_SUPPLIER_LINE.test(value) && !/^\W*$/.test(value) && !PRODUCT_PATTERN.test(value);
}

function findAmount(lines: SourceLine[], label: RegExp): InvoiceCandidate<number> | null {
  for (const line of [...lines].reverse()) {
    if (!label.test(line.text) || /\b(?:GSTIN|tax\s+invoice|invoice\s+(?:no|number))\b/i.test(line.text)) continue;
    const amounts = numericValues(line.text);
    if (amounts.length) return candidate(amounts[amounts.length - 1]!, line);
  }
  return null;
}

function findInvoiceTotal(lines: SourceLine[]): InvoiceCandidate<number> | null {
  const labels = [
    /\bgrand\s+total\b/i,
    /\binvoice\s+total\b/i,
    /\b(?:net\s+(?:amount|payable)|amount\s+payable|total\s+invoice\s+value)\b/i,
    /^[^A-Z0-9₹]{0,8}total\b(?!.*\b(?:for\s+material|material|tax|gst|cgst|sgst|igst|cess)\b)/i,
  ];
  for (const label of labels) {
    const amount = findAmount(lines, label);
    if (amount) return amount;
  }
  for (const line of [...lines].reverse()) {
    const matches = Array.from(line.text.matchAll(/\btotal(?!\s+(?:for\s+)?material|\s+tax)\s*[^A-Z0-9]{0,8}(\d[\d,]*(?:\.\d{1,3})?)/gi));
    const match = matches[matches.length - 1];
    if (match?.[1]) return candidate(Number(match[1].replace(/,/g, "")), line, true);
  }
  let materialTotalIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/\btotal\s+for\s+material\b/i.test(lines[index]!.text)) {
      materialTotalIndex = index;
      break;
    }
  }
  if (materialTotalIndex >= 0) {
    const materialValues = numericValues(lines[materialTotalIndex]!.text);
    const materialTotal = materialValues[materialValues.length - 1];
    if (materialTotal && materialTotal > 0) {
      const nearby = lines.slice(materialTotalIndex + 1, materialTotalIndex + 14).flatMap(line => numericValues(line.text).map(value => ({ line, value })));
      const tolerance = Math.max(10, materialTotal * 0.001);
      const finalTotal = nearby
        .filter(item => item.value >= materialTotal - tolerance && item.value <= materialTotal + tolerance)
        .sort((left, right) => Math.abs(left.value - materialTotal) - Math.abs(right.value - materialTotal))[0];
      if (finalTotal) return candidate(finalTotal.value, finalTotal.line, true);
    }
  }
  return null;
}

function parseItemLines(lines: SourceLine[]): IndianInvoiceLine[] {
  const parsed: IndianInvoiceLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const recognised = findProduct(line.text);
    if (!recognised || /\b(?:CGST|SGST|IGST|CESS|TOTAL|GSTIN)\b/i.test(line.text)) continue;
    const nearby = lines.slice(index, index + 6).filter(item => !/\b(?:CGST|SGST|IGST|CESS|TOTAL|GSTIN)\b/i.test(item.text));
    const measuredRows = nearby.flatMap(row => {
      const value = parseMeasureRow(row.text);
      return value ? [{ row, value }] : [];
    });
    const measured = measuredRows.find(item => /\b(?:BASIC|DESTINATION\s+PRICE|PRODUCT\s+VALUE)\b/i.test(item.row.text)) ?? measuredRows[0];
    if (!measured) continue;
    parsed.push(buildItemLine(line, recognised, measured.row, measured.value));
  }
  return deduplicateItemLines(parsed);
}

function deduplicateItemLines(lines: IndianInvoiceLine[]) {
  const deduplicated = new Map<string, IndianInvoiceLine>();
  for (const line of lines) {
    const key = [line.product, line.hsnCode ?? "", line.quantity.toFixed(3), line.unit ?? "", line.unitRate.toFixed(2)].join("|");
    const existing = deduplicated.get(key);
    if (!existing || itemArithmeticError(line) < itemArithmeticError(existing)) deduplicated.set(key, line);
  }
  return [...deduplicated.values()];
}

function itemArithmeticError(line: IndianInvoiceLine) {
  if (line.amount === null) return Number.POSITIVE_INFINITY;
  return Math.abs(line.quantity * line.unitRate - line.amount);
}

function buildItemLine(productLine: SourceLine, recognised: { description: string; product: IndianInvoiceLine["product"] }, measuredLine: SourceLine, measured: { quantity: number; unit: string; unitRate: number; amount: number }): IndianInvoiceLine {
  return {
    description: recognised.description,
    product: recognised.product,
    hsnCode: findHsnCode(productLine.text),
    quantity: measured.quantity,
    unit: measured.unit,
    unitRate: measured.unitRate,
    amount: measured.amount,
    sourceLine: productLine.number === measuredLine.number ? productLine.text : `${productLine.text} | ${measuredLine.text}`,
    lineNumber: productLine.number,
  };
}

function findProduct(value: string) {
  for (const rule of PRODUCT_RULES) {
    const match = value.match(rule.pattern);
    if (match) return { description: match[0].replace(/\s+/g, " ").trim(), product: rule.product };
  }
  if (findHsnCode(value)) {
    const description = value
      .replace(/\b2710\s*\d{2}\s*\d{2}\b|\b2710\d{4}\b/g, " ")
      .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
      .replace(/\b(?:ITEM|MATERIAL|CODE|DESCRIPTION|HSN|KL|LTRS?|LITRES?|LITERS?|KG|MT|NOS?|EA|PCS?)\b/gi, " ")
      .replace(/[^A-Z0-9&+./ -]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/[A-Z]{3}/i.test(description)) return { description, product: "OTHER" as const };
  }
  return null;
}

function parseMeasureRow(value: string): { quantity: number; unit: string; unitRate: number; amount: number } | null {
  const unitMatch = value.match(/\b(KL|L|LTRS?|LITRES?|LITERS?|KG|MT|NOS?|EA|PCS?)\b/i);
  if (!unitMatch || unitMatch.index === undefined || /\b(?:TAX|CESS)\b/i.test(value)) return null;
  const before = numericTokens(value.slice(0, unitMatch.index));
  const after = numericTokens(value.slice(unitMatch.index + unitMatch[0].length));
  const quantityToken = before[before.length - 1];
  if (!quantityToken || after.length < 2) return null;
  const rateToken = after[0]!;
  const amountToken = after[after.length - 1]!;
  const normalized = normalizeQuantityRateAndAmount(quantityToken.raw, rateToken.raw, amountToken.raw, unitMatch[1]!.toUpperCase());
  if (!normalized) return null;
  return { unit: unitMatch[1]!.toUpperCase(), ...normalized };
}

function normalizeQuantityRateAndAmount(quantityRaw: string, rateRaw: string, amountRaw: string, unit: string) {
  const quantityBase = Number(quantityRaw.replace(/,/g, ""));
  const rateBase = Number(rateRaw.replace(/,/g, ""));
  const amountBase = Number(amountRaw.replace(/,/g, ""));
  if (!(quantityBase > 0) || !Number.isFinite(rateBase) || !Number.isFinite(amountBase)) return null;
  const quantityScales = quantityRaw.includes(".") || unit !== "KL" ? [0] : [0, 1, 2, 3];
  const rateScales = rateRaw.includes(".") ? [0] : [0, 1, 2, 3];
  const amountScales = amountRaw.includes(".") ? [0] : [0, 1, 2, 3];
  let best: { quantity: number; unitRate: number; amount: number; score: number } | null = null;
  for (const quantityScale of quantityScales) for (const rateScale of rateScales) for (const amountScale of amountScales) {
    const quantity = quantityBase / (10 ** quantityScale);
    const unitRate = rateBase / (10 ** rateScale);
    const amount = amountBase / (10 ** amountScale);
    const expected = quantity * unitRate;
    const relativeDifference = Math.abs(expected - amount) / Math.max(1, amount);
    const plausibleQuantity = unit === "KL" ? quantity >= 0.1 && quantity <= 100 : quantity >= 0.001 && quantity <= 200_000;
    const plausibleRate = unit === "KL" ? unitRate >= 10_000 && unitRate <= 500_000 : unitRate >= 1 && unitRate <= 100_000;
    const score = relativeDifference + (plausibleQuantity ? 0 : 1) + (plausibleRate ? 0 : 1);
    if (!best || score < best.score) best = { quantity, unitRate, amount, score };
  }
  return best && best.score <= 0.03 ? { quantity: best.quantity, unitRate: best.unitRate, amount: best.amount } : null;
}

function findHsnCode(value: string) {
  const compact = value.match(/\b(2710)\s*(\d{2})\s*(\d{2})\b/);
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}`;
  return value.match(/\b(2710\d{4})\b/)?.[1] ?? null;
}

function numericValues(value: string) {
  return numericTokens(value).map(item => item.value);
}

function numericTokens(value: string) {
  return Array.from(value.matchAll(/(?<![A-Z0-9])(?:₹|RS\.?\s*)?(\d[\d,]*(?:\.\d{1,3})?)(?![A-Z0-9])/gi), match => ({ raw: match[1]!, value: Number(match[1]!.replace(/,/g, "")) })).filter(item => Number.isFinite(item.value));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function humanList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "required details";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
