import Foundation

struct ParsedInvoice: Sendable {
    struct Line: Sendable {
        let description: String
        let product: String
        let quantity: Double
        let unit: String?
        let unitCost: Double
        let amount: Double?
        let grossAmount: Double?
        let hsnCode: String?
    }

    let supplierName: String?
    let supplierGSTIN: String?
    let consigneeName: String?
    let consigneeCode: String?
    let buyerGSTIN: String?
    let invoiceNumber: String?
    let invoiceDate: Date?
    let total: Double?
    let tax: Double
    let lines: [Line]
    let missingFields: [String]
    let warnings: [String]
}

enum InvoiceTextParser {
    private struct SourceLine { let text: String; let number: Int }
    private struct NumericToken { let raw: String; let value: Double }
    private struct Measure { let quantity: Double; let unit: String; let unitRate: Double; let amount: Double }
    private struct ProductRule { let pattern: String; let product: String }

    private static let productRules = [
        ProductRule(pattern: #"\b(?:EBMS|E[-\s]?\d{1,2}\s*(?:MS|PETROL)|ETHANOL[-\s]+BLENDED\s+(?:MS|MOTOR\s+SPIRIT|PETROL))\b"#, product: "MS"),
        ProductRule(pattern: #"\b(?:HSD|HIGH\s+SPEED\s+DIESEL)(?:[-\s]?(?:BS)?[-\s]?(?:VI|V1))?\b"#, product: "HSD"),
        ProductRule(pattern: #"\b(?:XTRA\s*GREEN|XTRA\s*MILE)(?:\s+(?:DIESEL|HSD))?\b"#, product: "HSD"),
        ProductRule(pattern: #"\bV[-\s]?POWER\s+(?:DIESEL|HSD)\b"#, product: "HSD"),
        ProductRule(pattern: #"\b(?:MS|MOTOR\s+SPIRIT)(?:[-\s]?(?:BS)?[-\s]?(?:VI|V1))?\b"#, product: "MS"),
        ProductRule(pattern: #"\b(?:XP\s*(?:95|100)|XTRA\s*PREMIUM|SPEED(?:\s*(?:95|97))?|(?:HP\s*)?POWER\s*(?:95|99))\b"#, product: "MS"),
        ProductRule(pattern: #"\bV[-\s]?POWER\s+(?:PETROL|MS)\b"#, product: "MS"),
        ProductRule(pattern: #"\bPETROL\b"#, product: "PETROL"),
        ProductRule(pattern: #"\bDIESEL\b"#, product: "DIESEL"),
        ProductRule(pattern: #"\bCNG\b"#, product: "CNG"),
        ProductRule(pattern: #"\b(?:DEF|ADBLUE)\b"#, product: "DEF"),
        ProductRule(pattern: #"\b(?:LUBRICANT|ENGINE\s+OIL|SERVO|MAK\s+LUBRICANTS?)\b"#, product: "LUBRICANT"),
        ProductRule(pattern: #"\b(?:ETHANOL\s*100|E100)\b"#, product: "ETHANOL"),
        ProductRule(pattern: #"\b(?:AUTO\s*LPG|AUTOGAS)\b"#, product: "AUTO_LPG"),
        ProductRule(pattern: #"\bLNG\b"#, product: "LNG"),
        ProductRule(pattern: #"\b(?:ATF|JET\s*A[-\s]?1|AVIATION\s+TURBINE\s+FUEL)\b"#, product: "AVIATION_FUEL"),
        ProductRule(pattern: #"\b(?:V[-\s]?POWER|STORM(?:[-\s]?X)?)\b"#, product: "OTHER"),
    ]

    static func parse(_ text: String) -> ParsedInvoice {
        let lines = sourceLines(text)
        var warnings: [String] = []
        let invoiceNumber = findInvoiceNumber(lines)
        let invoiceDate = findDate(lines, label: #"\b(?:invoice\s+date|dated|date)\b"#, fieldName: "invoice date", warnings: &warnings)
        let gstins = findGSTINs(lines)
        let supplierGSTIN = chooseGSTIN(gstins, party: .supplier)
        let buyerGSTIN = chooseGSTIN(gstins, party: .buyer)
        let consignee = findConsignee(lines)
        let supplierName = findSupplierName(lines)
        let itemLines = parseItemLines(lines)
        let total = findInvoiceTotal(lines, itemLines: itemLines, warnings: &warnings)
        let subtotal = findAmount(lines, label: #"\b(?:taxable\s+(?:amount|value)|sub\s*total|basic\s+amount)\b"#)
        let components = [
            findTaxComponent(lines, label: #"\bCGST\b"#),
            findTaxComponent(lines, label: #"\bSGST\b"#),
            findTaxComponent(lines, label: #"\bIGST\b"#),
            findTaxComponent(lines, label: #"\b(?:CESS|TCS)\b"#),
        ]
        let explicitTax = findAmount(lines, label: #"\b(?:total\s+tax|tax\s+amount)\b"#)
        let componentTax = components.compactMap { $0 }.reduce(0, +)
        // Use the same line basis as the editable review. A tiny disagreement is
        // normally one damaged OCR digit in the printed amount; a larger one is
        // more likely to be a damaged rate, so preserve the printed value then.
        let productSubtotal = itemLines.reduce(0) { subtotal, line in
            subtotal + reconciledLineAmount(line)
        }
        let derivedCharges = total.flatMap { productSubtotal > 0 ? $0 - productSubtotal : nil }
        var tax = explicitTax ?? (componentTax > 0 ? componentTax : 0)
        if let derivedCharges, derivedCharges >= 0, explicitTax == nil || abs(tax - derivedCharges) > 1 {
            tax = roundMoney(derivedCharges)
            warnings.append("Taxes and charges were recovered from the invoice total. Check their classification before continuing.")
        }

        var missing: [String] = []
        if supplierName == nil { missing.append("supplier name") }
        if invoiceNumber == nil { missing.append("invoice number") }
        if invoiceDate == nil { missing.append("invoice date") }
        if total == nil { missing.append("invoice total") }
        if itemLines.isEmpty { missing.append("product lines") }
        if let subtotal, let total, abs(subtotal + tax - total) > 1 {
            warnings.append("The taxable amount and tax do not add up to the invoice total. Check the figures against the document.")
        }
        for line in itemLines {
            if let amount = line.amount, abs(line.quantity * line.unitCost - amount) > 1 {
                warnings.append("The quantity and rate do not match the amount shown for \(line.description).")
            }
        }
        if !missing.isEmpty { warnings.insert("Could not safely read: \(humanList(missing)).", at: 0) }

        return .init(
            supplierName: supplierName,
            supplierGSTIN: supplierGSTIN,
            consigneeName: consignee.name,
            consigneeCode: consignee.code,
            buyerGSTIN: buyerGSTIN,
            invoiceNumber: invoiceNumber?.value,
            invoiceDate: invoiceDate,
            total: total,
            tax: tax,
            lines: itemLines,
            missingFields: missing,
            warnings: unique(warnings + (invoiceNumber?.needsReview == true ? ["Check the invoice number against the document before continuing."] : []))
        )
    }

    private struct InvoiceNumber { let value: String; let needsReview: Bool }

    private static func reconciledLineAmount(_ line: ParsedInvoice.Line) -> Double {
        let calculated = line.quantity * line.unitCost
        guard let amount = line.amount else { return calculated }
        let difference = abs(calculated - amount)
        let relativeDifference = difference / max(1, abs(calculated), abs(amount))
        return difference > 1 && relativeDifference <= 0.001 ? calculated : amount
    }

    private static func findInvoiceNumber(_ lines: [SourceLine]) -> InvoiceNumber? {
        let patterns = [
            #"\b(?:tax\s+)?invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})\b"#,
            #"\b(?:bill|document|doc)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})\b"#,
            #"\binv(?:\.|\s+(?:no\.?|number|#))\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})\b"#,
        ]
        for line in lines {
            if let value = firstCapture(line.text, patterns: patterns), !matches(value, #"^\d{1,2}$"#) { return .init(value: value, needsReview: false) }
        }
        for line in lines {
            if let value = firstCapture(line.text, patterns: [#"\bTAX\s+INVOICE\s+([A-Z0-9][A-Z0-9/\-]{7,})\b"#]), !matches(value, #"^(?:UNDER|RULE|NO|NUMBER)$"#) {
                return .init(value: value, needsReview: true)
            }
        }
        if let heading = lines.firstIndex(where: { matches($0.text, #"\b(?:DOC\.?\s*NAME\s+)?TAX\s+INVOICE\b"#) }) {
            for line in lines.dropFirst(heading + 1).prefix(5) {
                if let value = firstCapture(line.text, patterns: [#"^([A-Z0-9][A-Z0-9/\-]{7,})$"#]), !matches(value, #"^(?:UNDER|RULE|NUMBER)$"#) {
                    return .init(value: value, needsReview: true)
                }
            }
        }
        return nil
    }

    private enum GSTParty { case supplier, buyer }
    private static func findGSTINs(_ lines: [SourceLine]) -> [(value: String, line: SourceLine)] {
        lines.flatMap { line in captures(line.text, pattern: #"\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b"#).map { ($0.uppercased(), line) } }
    }
    private static func chooseGSTIN(_ items: [(value: String, line: SourceLine)], party: GSTParty) -> String? {
        let marker = party == .supplier ? #"\b(?:supplier|seller|vendor|from)\b"# : #"\b(?:buyer|recipient|payer|consignee|bill\s+to|ship\s+to)\b"#
        let opposite = party == .supplier ? #"\b(?:buyer|recipient|payer|consignee|bill\s+to|ship\s+to)\b"# : #"\b(?:supplier|seller|vendor|from)\b"#
        if let item = items.first(where: { matches($0.line.text, marker) }) { return item.value }
        if party == .supplier, items.count == 1, !matches(items[0].line.text, opposite) { return items[0].value }
        return nil
    }

    private static func findSupplierName(_ lines: [SourceLine]) -> String? {
        let known = #"\b(Indian\s+Oil\s+Corporation\s+Limited|Bharat\s+Petroleum\s+Corporation\s+Limited|Hindustan\s+Petroleum\s+Corporation\s+Limited|Nayara\s+Energy(?:\s+Limited)?|Reliance\s+Industries(?:\s+Limited)?|Shell(?:\s+India)?)\b"#
        for line in lines.prefix(40) { if let value = firstCapture(line.text, patterns: [known]) { return condensed(value) } }
        for line in lines where matches(line.text, #"\b(?:supplier|seller|vendor)\s*(?:name)?\s*[:\-]"#) {
            let value = replacing(line.text, #"^.*?\b(?:supplier|seller|vendor)\s*(?:name)?\s*[:\-]\s*"#, "").trimmingCharacters(in: .whitespaces)
            if looksLikeName(value) { return value }
        }
        let legalEntity = #"\b(?:LIMITED|LTD\.?|LLP|PVT\.?\s*LTD\.?|CORPORATION|COMPANY|CO\.?|ENTERPRISES?|TRADERS?)\b"#
        if let candidate = lines.prefix(20).first(where: {
            looksLikeName($0.text) && matches($0.text, legalEntity) && !matches($0.text, #"\b(?:CONSIGNEE|BUYER|PAYER|SHIP\s+TO|DELIVERED\s+TO)\b"#)
        }) { return cleanPartyName(candidate.text) }
        return lines.prefix(12).first(where: { looksLikeName($0.text) })?.text
    }

    private static func findConsignee(_ lines: [SourceLine]) -> (name: String?, code: String?) {
        let payerPattern = #"\bPAYER\s*[-:]\s*(\d{3,})?\s*([A-Z][A-Z0-9&.'() /-]{1,80}?\b(?:PETROLEUM|PETROL(?:\s+PUMP)?|FUELS?|SERVICE\s+STATION|FILLING\s+STATION|ENERGY|ENTERPRISES?|TRADERS?|AGENC(?:Y|IES))\b)"#
        for line in lines {
            let groups = captureGroups(line.text, pattern: payerPattern)
            if groups.count >= 2, let rawName = groups[1] {
                let name = cleanPartyName(rawName)
                if looksLikePartyName(name) { return (name, groups[0]) }
            }
        }
        guard let index = lines.firstIndex(where: { matches($0.text, #"\b(?:CONSIGNEE|SHIP\s+TO|DELIVER(?:ED)?\s+TO)\b"#) }) else { return (nil, nil) }
        let nearby = Array(lines[index..<min(lines.count, index + 10)])
        let name = nearby.first { looksLikePartyName($0.text) && !matches($0.text, #"\b(?:SUPPLIER|CONSIGNEE|SHIP\s+TO|NAME\s*&\s*ADDRESS|INDIAN\s+OIL\s+DEALER)\b"#) }
        let code = nearby.compactMap { firstCapture($0.text, patterns: [#"\b(\d{4,})\b"#]) }.first
        return (name.map { cleanPartyName($0.text) }, code)
    }

    private static func findDate(_ lines: [SourceLine], label: String, fieldName: String, warnings: inout [String]) -> Date? {
        let patterns = [
            #"\b(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4}))\b"#,
            #"\b(\d{1,2}[\s\-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s\-](?:\d{2}|\d{4}))\b"#,
            #"\b(\d{4}-\d{2}-\d{2})\b"#,
        ]
        for line in lines where matches(line.text, label) {
            for pattern in patterns where firstCapture(line.text, patterns: [pattern]) != nil {
                let value = firstCapture(line.text, patterns: [pattern])!
                if let date = parseDate(value) { return date }
                warnings.append("The \(fieldName) “\(value)” is not a valid calendar date and was not used.")
            }
        }
        if fieldName == "invoice date" {
            for line in lines.prefix(30) {
                for pattern in patterns {
                    guard let value = firstCapture(line.text, patterns: [pattern]), let date = parseDate(value) else { continue }
                    warnings.append("The invoice date was recovered without a clear label. Check it against the document before continuing.")
                    return date
                }
            }
        }
        return nil
    }

    private static func findInvoiceTotal(_ lines: [SourceLine], itemLines: [ParsedInvoice.Line], warnings: inout [String]) -> Double? {
        let labels = [
            #"\bgrand\s+total\b"#,
            #"\binvoice\s+total\b"#,
            #"\b(?:net\s+(?:amount|payable)|amount\s+payable|total\s+invoice\s+value)\b"#,
            #"^[^A-Z0-9₹]{0,8}total\b(?!.*\b(?:for\s+material|material|tax|gst|cgst|sgst|igst|cess)\b)"#,
        ]
        for label in labels { if let amount = findAmount(lines, label: label) { return amount } }
        let grossSum = itemLines.compactMap(\.grossAmount).reduce(0, +)
        for index in lines.indices.reversed() where matches(lines[index].text, #"^total\s*:?$"#) {
            let following = lines.dropFirst(index + 1).prefix(4)
            let candidates = following.flatMap { numericValues($0.text) }.filter { $0 >= 1_000 }
            let plausible = grossSum > 0 ? candidates.filter { abs($0 - grossSum) <= max(10, grossSum * 0.001) } : candidates
            if plausible.count == 1 { return plausible[0] }
        }
        for line in lines.reversed() {
            let groups = captures(line.text, pattern: #"\btotal(?!\s+(?:for\s+)?material|\s+tax)\s*[^A-Z0-9]{0,8}(\d[\d,]*(?:\.\d{1,3})?)"#)
            if let raw = groups.last, let value = number(raw) { return value }
        }
        let totalHeadingIndexes = lines.indices.filter { matches(lines[$0].text, #"\btotal(?:\s+for\s+material)?\b"#) }
        if let firstTotal = totalHeadingIndexes.first {
            let values = lines.dropFirst(firstTotal + 1).prefix(30).compactMap { numericOnlyValue($0.text) }.filter { $0 >= 100 }
            for rightIndex in values.indices.reversed() {
                for leftIndex in values.indices where leftIndex < rightIndex {
                    let tolerance = max(10, values[rightIndex] * 0.001)
                    if abs(values[leftIndex] - values[rightIndex]) <= tolerance { return values[rightIndex] }
                }
            }
        }
        if itemLines.count > 1, itemLines.allSatisfy({ $0.grossAmount != nil }) {
            let materialSum = roundMoney(itemLines.compactMap(\.grossAmount).reduce(0, +))
            let expectedRounding = roundMoney(materialSum.rounded() - materialSum)
            if let roundingLine = lines.reversed().first(where: { matches($0.text, #"\b(?:ZRND|ROUNDING\s+(?:DIFFERENCE|OFF)|ROUND\s+OFF)\b"#) }),
               let raw = firstCapture(roundingLine.text, patterns: [#"(-?\d+(?:\.\d{1,2})?)\s*$"#]),
               let stated = number(raw), abs(expectedRounding) <= 0.5 {
                let alternatives = raw.contains(".") ? [stated] : [stated, stated / 100]
                if alternatives.contains(where: { abs($0 - expectedRounding) < 0.011 }) {
                    warnings.append("The invoice total was reconstructed from all product totals and the rounding line. Check it against the document before continuing.")
                    return materialSum.rounded()
                }
            }
        }
        guard itemLines.count == 1,
              let materialIndex = lines.lastIndex(where: { matches($0.text, #"\btotal\s+for\s+material\b"#) }),
              let materialTotal = numericValues(lines[materialIndex].text).last, materialTotal > 0 else { return nil }
        let tolerance = max(10, materialTotal * 0.001)
        let followingLines = Array(lines.dropFirst(materialIndex + 1).prefix(13))
        let nearbyValues: [Double] = followingLines.flatMap { numericValues($0.text) }
        let candidates = nearbyValues.filter { value in value >= materialTotal - tolerance && value <= materialTotal + tolerance }
        return candidates.min { left, right in abs(left - materialTotal) < abs(right - materialTotal) }
    }

    private static func findAmount(_ lines: [SourceLine], label: String) -> Double? {
        for line in lines.reversed() where matches(line.text, label) && !matches(line.text, #"\b(?:GSTIN|tax\s+invoice|invoice\s+(?:no|number))\b"#) {
            if let amount = numericValues(line.text).last { return amount }
        }
        return nil
    }

    private static func findTaxComponent(_ lines: [SourceLine], label: String) -> Double? {
        for line in lines.reversed() where matches(line.text, label) && !matches(line.text, #"\b(?:GSTIN|tax\s+invoice|invoice\s+(?:no|number))\b"#) {
            let values = numericValues(line.text)
            if line.text.contains("%"), values.count == 1 { continue }
            if let amount = values.last { return amount }
        }
        return nil
    }

    private static func parseItemLines(_ lines: [SourceLine]) -> [ParsedInvoice.Line] {
        var parsed: [ParsedInvoice.Line] = []
        for (index, line) in lines.enumerated() {
            guard let product = findProduct(line.text), !matches(line.text, #"\b(?:CGST|SGST|IGST|CESS|TOTAL|GSTIN)\b"#) else { continue }
            let nearby = lines[index..<min(lines.count, index + 6)].filter { !matches($0.text, #"\b(?:CGST|SGST|IGST|CESS|TOTAL|GSTIN)\b"#) }
            let measures = nearby.compactMap { row in parseMeasureRow(row.text).map { (row, $0) } }
            guard let measured = measures.first(where: { matches($0.0.text, #"\b(?:BASIC|DESTINATION\s+PRICE|PRODUCT\s+VALUE)\b"#) }) ?? measures.first else { continue }
            let nextProduct = lines.indices.first { candidate in
                candidate > index && findProduct(lines[candidate].text) != nil && matches(lines[candidate].text, #"^\s*(?:\d{1,3}\s+\d{4,6}\s+)?(?:EBMS|HSD|MS|PETROL|DIESEL)\b"#)
            } ?? min(lines.count, index + 28)
            let section = lines[index..<nextProduct]
            let materialIndex = section.firstIndex { matches($0.text, #"\btotal\s+for\s+material\b"#) }
            var grossAmount: Double?
            if let materialIndex {
                let stated = numericValues(lines[materialIndex].text).last
                grossAmount = stated.flatMap { $0 >= measured.1.amount ? $0 : nil }
                if grossAmount == nil {
                    grossAmount = lines.dropFirst(materialIndex + 1).prefix(3)
                        .filter { matches($0.text, #"^\s*[₹]?[\d,]+(?:\.\d{1,2})?\s*$"#) }
                        .flatMap { numericValues($0.text) }
                        .first { $0 >= measured.1.amount }
                }
            }
            parsed.append(.init(description: product.description, product: product.product, quantity: measured.1.quantity, unit: measured.1.unit, unitCost: measured.1.unitRate, amount: measured.1.amount, grossAmount: grossAmount, hsnCode: findHSN(line.text)))
        }
        if parsed.isEmpty { parsed = parseColumnarItemLines(lines) }
        var chosen: [String: ParsedInvoice.Line] = [:]
        for line in parsed {
            let key = "\(line.product)|\(line.hsnCode ?? "")|\(line.quantity)|\(line.unit ?? "")|\(line.unitCost)"
            let error = line.amount.map { abs(line.quantity * line.unitCost - $0) } ?? .infinity
            let existingError = chosen[key]?.amount.map { abs((chosen[key]?.quantity ?? 0) * (chosen[key]?.unitCost ?? 0) - $0) } ?? .infinity
            if chosen[key] == nil || error < existingError { chosen[key] = line }
        }
        return parsed.compactMap { line in
            let key = "\(line.product)|\(line.hsnCode ?? "")|\(line.quantity)|\(line.unit ?? "")|\(line.unitCost)"
            guard let selected = chosen.removeValue(forKey: key) else { return nil }
            return selected
        }
    }

    private static func parseColumnarItemLines(_ lines: [SourceLine]) -> [ParsedInvoice.Line] {
        let products = lines.compactMap { line -> (description: String, product: String)? in
            guard !matches(line.text, #"\b(?:CGST|SGST|IGST|CESS|TOTAL|GSTIN)\b"#) else { return nil }
            return findProduct(line.text)
        }
        guard !products.isEmpty,
              let quantityHeading = lines.firstIndex(where: { matches($0.text, #"^QUANTITY[\s.:_-]+UNIT\b"#) }),
              let rateHeading = lines[quantityHeading...].firstIndex(where: { matches($0.text, #"^RATE[\s.:_-]+UNIT\b"#) }),
              let hsnHeading = lines[rateHeading...].firstIndex(where: { matches($0.text, #"^HSN[\s.:_-]+CODE\b"#) }) else { return [] }

        var measures: [(quantity: Double, unit: String)] = []
        var index = quantityHeading + 1
        while index < rateHeading {
            if let quantity = numericOnlyValue(lines[index].text), index + 1 < rateHeading, let unit = normalizedUnit(lines[index + 1].text) {
                if !measures.contains(where: { $0.quantity == quantity && $0.unit == unit }) { measures.append((quantity, unit)) }
                index += 2
            } else { index += 1 }
        }
        guard !measures.isEmpty else { return [] }

        let rateValues = lines[(rateHeading + 1)..<hsnHeading].compactMap { numericOnlyValue($0.text) }
        let hsnEnd = lines[hsnHeading...].firstIndex(where: { matches($0.text, #"^TOTAL(?:\s+FOR\s+MATERIAL)?$"#) }) ?? lines.endIndex
        let hsnValues = lines[(hsnHeading + 1)..<hsnEnd].compactMap { findHSN($0.text) }
        let amountValues = lines.dropFirst(hsnHeading + 1).compactMap { numericOnlyValue($0.text) }.filter { $0 >= 100 }

        return products.enumerated().compactMap { productIndex, product in
            guard productIndex < measures.count else { return nil }
            let measure = measures[productIndex]
            let plausibleRates = rateValues.filter { rate in
                measure.unit == "KL" ? (10_000...500_000).contains(rate) : (1...100_000).contains(rate)
            }
            guard productIndex < plausibleRates.count else { return nil }
            let rate = plausibleRates[productIndex]
            let expected = measure.quantity * rate
            let amount = amountValues.min { abs($0 - expected) < abs($1 - expected) }
            guard let amount, abs(amount - expected) / max(1, amount) <= 0.03 else { return nil }
            return .init(
                description: product.description,
                product: product.product,
                quantity: measure.quantity,
                unit: measure.unit,
                unitCost: rate,
                amount: amount,
                grossAmount: nil,
                hsnCode: productIndex < hsnValues.count ? hsnValues[productIndex] : nil
            )
        }
    }

    private static func findProduct(_ value: String) -> (description: String, product: String)? {
        for rule in productRules {
            if let match = firstMatch(value, pattern: rule.pattern) { return (condensed(match), rule.product) }
        }
        if findHSN(value) != nil {
            let cleaned = replacing(replacing(replacing(value, #"\b2710\s*\d{2}\s*\d{2}\b|\b2710\d{4}\b"#, " "), #"\b\d+(?:[.,]\d+)?\b"#, " "), #"\b(?:ITEM|MATERIAL|CODE|DESCRIPTION|HSN|KL|LTRS?|LITRES?|LITERS?|KG|MT|NOS?|EA|PCS?)\b"#, " ")
            let description = condensed(replacing(cleaned, #"[^A-Z0-9&+./ -]"#, " "))
            if matches(description, #"[A-Z]{3}"#) { return (description, "OTHER") }
        }
        return nil
    }

    private static func parseMeasureRow(_ value: String) -> Measure? {
        guard let range = regex(#"\b(KL|ML|L|LTRS?|LITRES?|LITERS?|KG|MT|NOS?|EA|PCS?)\b"#)?.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              let whole = Range(range.range(at: 0), in: value), let unitRange = Range(range.range(at: 1), in: value),
              !matches(value, #"\b(?:TAX|CESS)\b"#) else { return nil }
        let before = numericTokens(String(value[..<whole.lowerBound]))
        let after = numericTokens(String(value[whole.upperBound...]))
        guard let quantity = before.last, let rate = after.first, let amount = after.last, after.count >= 2 else { return nil }
        let recognisedUnit = String(value[unitRange]).uppercased()
        let unit = recognisedUnit == "ML" && matches(value, #"\b(?:BASIC|DESTINATION\s+PRICE)\b"#) ? "KL" : recognisedUnit
        return normalizeMeasure(quantity.raw, rate.raw, amount.raw, unit: unit)
    }

    private static func normalizeMeasure(_ quantityRaw: String, _ rateRaw: String, _ amountRaw: String, unit: String) -> Measure? {
        guard let quantityBase = number(quantityRaw), let rateBase = number(rateRaw), let amountBase = number(amountRaw), quantityBase > 0 else { return nil }
        let quantityScales = quantityRaw.contains(".") || unit != "KL" ? [0] : [0, 1, 2, 3]
        let rateScales = rateRaw.contains(".") ? [0] : [0, 1, 2, 3]
        let amountScales = amountRaw.contains(".") ? [0] : [0, 1, 2, 3]
        var best: (measure: Measure, score: Double)?
        for quantityScale in quantityScales { for rateScale in rateScales { for amountScale in amountScales {
            let quantity = quantityBase / pow(10, Double(quantityScale))
            let rate = rateBase / pow(10, Double(rateScale))
            let amount = amountBase / pow(10, Double(amountScale))
            let relative = abs(quantity * rate - amount) / max(1, amount)
            let plausibleQuantity = unit == "KL" ? (0.1...100).contains(quantity) : (0.001...200_000).contains(quantity)
            let plausibleRate = unit == "KL" ? (10_000...500_000).contains(rate) : (1...100_000).contains(rate)
            let score = relative + (plausibleQuantity ? 0 : 1) + (plausibleRate ? 0 : 1)
            if best == nil || score < best!.score { best = (.init(quantity: quantity, unit: unit, unitRate: rate, amount: amount), score) }
        } } }
        return best?.score ?? .infinity <= 0.03 ? best?.measure : nil
    }

    private static func findHSN(_ value: String) -> String? {
        let groups = captureGroups(value, pattern: #"\b(2710)\s*(\d{2})\s*(\d{2})\b"#)
        if groups.count == 3 { return groups.compactMap { $0 }.joined() }
        return firstCapture(value, patterns: [#"\b(2710\d{4})\b"#])
    }

    private static func sourceLines(_ text: String) -> [SourceLine] {
        text.components(separatedBy: .newlines).enumerated().compactMap { index, value in
            let cleaned = condensed(value)
            return cleaned.isEmpty ? nil : .init(text: cleaned, number: index + 1)
        }
    }
    private static func looksLikeName(_ value: String) -> Bool {
        value.count >= 4 && value.count <= 100 && matches(value, #"[A-Z]{3}"#) &&
        !matches(value, #"\b(?:tax\s+invoice|invoice|original|duplicate|triplicate|gstin|gst\s+no|bill\s+to|ship\s+to|buyer|consignee|payer|date|phone|mobile|email|grand\s+total|total|amount|page\s+\d|invoice\s+under|government\s+of\s+india)\b"#) && findProduct(value) == nil
    }
    private static func looksLikePartyName(_ value: String) -> Bool {
        matches(value, #"\b(?:PETROLEUM|PETROL|FUELS?|SERVICE\s+STATION|ENERGY|FILLING\s+STATION|ENTERPRISES?)\b"#) && !matches(value, #"\b(?:SUPPLIER\s+TAN|TOTAL|INVOICE)\b"#)
    }
    private static func cleanPartyName(_ value: String) -> String {
        replacing(replacing(value, #"\b(?:INDIAN\s+OIL\s+DEALER|DEALER)\b.*$"#, ""), #"^[^A-Z0-9]+|[^A-Z0-9)&.'-]+$"#, "").trimmingCharacters(in: .whitespaces)
    }
    private static func parseDate(_ value: String) -> Date? {
        let cleaned = condensed(value).replacingOccurrences(of: " ", with: "-")
        let formats = ["d/M/yyyy", "d-M-yyyy", "d.M.yyyy", "d/M/yy", "d-M-yy", "d.M.yy", "d-MMM-yy", "d-MMMM-yy", "d-MMM-yyyy", "yyyy-MM-dd"]
        for format in formats {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = format
            formatter.isLenient = false
            if let date = formatter.date(from: cleaned), (2000...2100).contains(Calendar(identifier: .gregorian).component(.year, from: date)) { return date }
        }
        return nil
    }
    private static func numericValues(_ value: String) -> [Double] { numericTokens(value).map(\.value) }
    private static func numericOnlyValue(_ value: String) -> Double? {
        firstCapture(value, patterns: [#"^\s*-?\s*(?:₹|RS\.?\s*)?(\d[\d,]*(?:\.\d{1,3})?)\s*$"#]).flatMap(number)
    }
    private static func normalizedUnit(_ value: String) -> String? {
        guard let unit = firstCapture(value, patterns: [#"^\s*(KL|L|LTRS?|LITRES?|LITERS?|KG|MT|NOS?|EA|PCS?)\s*$"#]) else { return nil }
        return unit.uppercased()
    }
    private static func numericTokens(_ value: String) -> [NumericToken] {
        captures(value, pattern: #"(?:₹|RS\.?\s*)?(\d[\d,]*(?:\.\d{1,3})?)"#).compactMap { raw in number(raw).map { .init(raw: raw, value: $0) } }
    }
    private static func number(_ value: String) -> Double? { Double(value.replacingOccurrences(of: ",", with: "")) }
    private static func firstCapture(_ value: String, patterns: [String]) -> String? { patterns.lazy.compactMap { captures(value, pattern: $0).first }.first }
    private static func captures(_ value: String, pattern: String) -> [String] { captureGroupsAll(value, pattern: pattern).compactMap { $0.first ?? nil } }
    private static func captureGroups(_ value: String, pattern: String) -> [String?] { captureGroupsAll(value, pattern: pattern).first ?? [] }
    private static func captureGroupsAll(_ value: String, pattern: String) -> [[String?]] {
        guard let expression = regex(pattern) else { return [] }
        return expression.matches(in: value, range: NSRange(value.startIndex..., in: value)).map { match in
            (1..<match.numberOfRanges).map { group in
                guard let range = Range(match.range(at: group), in: value) else { return nil }
                return String(value[range])
            }
        }
    }
    private static func firstMatch(_ value: String, pattern: String) -> String? {
        guard let match = regex(pattern)?.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)), let range = Range(match.range, in: value) else { return nil }
        return String(value[range])
    }
    private static func matches(_ value: String, _ pattern: String) -> Bool { regex(pattern)?.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil }
    private static func replacing(_ value: String, _ pattern: String, _ replacement: String) -> String {
        regex(pattern)?.stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: replacement) ?? value
    }
    private static func regex(_ pattern: String) -> NSRegularExpression? { try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) }
    private static func condensed(_ value: String) -> String { value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines) }
    private static func roundMoney(_ value: Double) -> Double { (value * 100).rounded() / 100 }
    private static func unique(_ values: [String]) -> [String] { values.reduce(into: []) { if !$0.contains($1) { $0.append($1) } } }
    private static func humanList(_ values: [String]) -> String {
        guard values.count > 1 else { return values.first ?? "required details" }
        return values.dropLast().joined(separator: ", ") + " and " + values.last!
    }
}
