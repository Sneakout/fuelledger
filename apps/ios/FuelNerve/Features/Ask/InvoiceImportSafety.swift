import Foundation

enum InvoiceStationStatus: Sendable { case match, mismatch, unknown }

struct InvoiceStationAssessment: Sendable {
    let status: InvoiceStationStatus
    let message: String
    var permitsSubmission: Bool { status == .match }
}

struct InvoicePriceAssessment: Sendable {
    enum Direction: Sendable { case increase, decrease, unchanged }
    let productName: String
    let unit: String
    let previousPrice: Double
    let invoicePrice: Double
    let direction: Direction
}

enum InvoiceImportSafety {
    static func assessStation(consigneeName: String?, stationName: String?) -> InvoiceStationAssessment {
        let consignee = consigneeName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let station = stationName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !consignee.isEmpty, !station.isEmpty else {
            return .init(status: .unknown, message: "I could not verify which fuel station this invoice was delivered to. Check the consignee before continuing.")
        }
        if sameStationName(consignee, station) {
            return .init(status: .match, message: "\(consignee) matches the selected fuel station.")
        }
        return .init(status: .mismatch, message: "This invoice is for \(consignee), not \(station). It will stay on this device and cannot be submitted.")
    }

    static func assessSingleProductPrice(
        invoiceTotal: Double,
        excludedAmount: Double = 0,
        productId: String,
        description: String,
        quantity: Double,
        sourceUnit: String,
        baseAmount: Double? = nil,
        taxRate: Double = 0,
        products: [InvoiceImportBootstrap.Product]
    ) -> InvoicePriceAssessment? {
        guard invoiceTotal > 0, excludedAmount >= 0, invoiceTotal > excludedAmount, quantity > 0,
              let product = products.first(where: { $0.id == productId }) ?? matchProduct(description: description, products: products) else { return nil }
        guard let normalizedQuantity = quantityInUnit(quantity, from: sourceUnit, to: product.unit), normalizedQuantity > 0 else { return nil }
        let base = baseAmount ?? quantity * product.purchasePrice.value
        guard base >= 0, taxRate >= 0, taxRate <= 100, invoiceTotal - excludedAmount + 0.02 >= base else { return nil }
        // For a single product every landed invoice charge belongs to that product.
        // Deposits and unrelated adjustments are removed before division.
        let invoicePrice = (invoiceTotal - excludedAmount) / normalizedQuantity
        guard invoicePrice > 0 else { return nil }
        let previousPrice = product.purchasePrice.value
        guard previousPrice > 0 else { return nil }
        let difference = roundMoney(invoicePrice - previousPrice)
        return .init(
            productName: product.name,
            unit: product.unit.isEmpty ? (sourceUnit.isEmpty ? "unit" : sourceUnit) : product.unit,
            previousPrice: roundMoney(previousPrice),
            invoicePrice: roundMoney(invoicePrice),
            direction: abs(difference) < 0.01 ? .unchanged : (difference > 0 ? .increase : .decrease)
        )
    }

    private static func matchProduct(description: String, products: [InvoiceImportBootstrap.Product]) -> InvoiceImportBootstrap.Product? {
        let value = normalize(description)
        let exact = products.filter { value == normalize($0.code) || value == normalize($0.name) }
        if exact.count == 1 { return exact[0] }
        let family = normalizeFuelFamily(value)
        let familyMatches = products.filter { normalizeFuelFamily(normalize($0.code)) == family || normalizeFuelFamily(normalize($0.name)) == family }
        return familyMatches.count == 1 ? familyMatches[0] : nil
    }

    private static func sameStationName(_ left: String, _ right: String) -> Bool {
        if normalize(left) == normalize(right) { return true }
        let leftCore = stationCore(left)
        let rightCore = stationCore(right)
        return leftCore.count >= 4 && leftCore == rightCore
    }
    private static func stationCore(_ value: String) -> String {
        normalize(value.replacingOccurrences(
            of: #"\b(?:PETROLEUM|PETROL|FUELS?|FUEL\s+STATION|PETROL\s+PUMP|SERVICE\s+STATION|INDIAN\s+OIL\s+DEALER|DEALER)\b"#,
            with: " ", options: [.regularExpression, .caseInsensitive]
        ))
    }
    private static func normalizeFuelFamily(_ value: String) -> String {
        if value.hasPrefix("HSD") || value.hasPrefix("HIGHSPEEDDIESEL") { return "HSD" }
        if value.hasPrefix("MS") || value.hasPrefix("MOTORSPIRIT") { return "MS" }
        return value
    }
    private static func quantityInUnit(_ value: Double, from: String, to: String) -> Double? {
        let source = normalize(from)
        let destination = normalize(to)
        if source.isEmpty || destination.isEmpty || source == destination { return value }
        let litres = ["L", "LTR", "LTRS", "LITRE", "LITRES", "LITER", "LITERS"]
        let kilolitres = ["KL", "KILOLITRE", "KILOLITRES", "KILOLITER", "KILOLITERS"]
        let kilograms = ["KG", "KGS", "KILOGRAM", "KILOGRAMS"]
        let tonnes = ["MT", "TONNE", "TONNES", "METRICTON", "METRICTONS"]
        if kilolitres.contains(source), litres.contains(destination) { return value * 1_000 }
        if litres.contains(source), kilolitres.contains(destination) { return value / 1_000 }
        if tonnes.contains(source), kilograms.contains(destination) { return value * 1_000 }
        if kilograms.contains(source), tonnes.contains(destination) { return value / 1_000 }
        return nil
    }
    private static func normalize(_ value: String) -> String { value.uppercased().filter { $0.isLetter || $0.isNumber } }
    private static func roundMoney(_ value: Double) -> Double { (value * 100).rounded() / 100 }
}
