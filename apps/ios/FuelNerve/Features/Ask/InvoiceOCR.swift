import Foundation
import PDFKit
import UIKit
@preconcurrency import Vision

struct InvoiceSourceDocument: Sendable {
    let fileName: String
    let mimeType: String
    let data: Data

    var attachment: PurchaseInvoiceSubmission.Attachment? {
        guard data.count <= 500_000 else { return nil }
        return .init(fileName: fileName, mimeType: mimeType, size: data.count, contentBase64: data.base64EncodedString())
    }
}

struct InvoiceOCRResult: Sendable {
    let text: String
    let pageCount: Int
}

enum InvoiceOCRError: LocalizedError {
    case unsupportedDocument
    case unreadableDocument
    var errorDescription: String? {
        switch self {
        case .unsupportedDocument: "Choose a PDF, PNG, HEIC, or JPEG invoice."
        case .unreadableDocument: "No readable text was found. Try a clearer, straighter image."
        }
    }
}

enum InvoiceOCRService {
    static func recognize(_ document: InvoiceSourceDocument) async throws -> InvoiceOCRResult {
        let images: [CGImage]
        if document.mimeType == "application/pdf" || document.fileName.lowercased().hasSuffix(".pdf") {
            guard let pdf = PDFDocument(data: document.data), pdf.pageCount > 0 else { throw InvoiceOCRError.unsupportedDocument }
            images = (0..<min(pdf.pageCount, 8)).compactMap { index in
                guard let page = pdf.page(at: index) else { return nil }
                let bounds = page.bounds(for: .mediaBox)
                let scale = min(2.2, 2600 / max(bounds.width, bounds.height))
                let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
                let renderer = UIGraphicsImageRenderer(size: size)
                return renderer.image { context in
                    UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
                    context.cgContext.translateBy(x: 0, y: size.height)
                    context.cgContext.scaleBy(x: scale, y: -scale)
                    page.draw(with: .mediaBox, to: context.cgContext)
                }.cgImage
            }
        } else {
            guard let image = UIImage(data: document.data)?.cgImage else { throw InvoiceOCRError.unsupportedDocument }
            images = [image]
        }
        var pages: [String] = []
        for image in images { pages.append(try await recognize(image)) }
        let text = pages.joined(separator: "\n\n")
        guard text.trimmingCharacters(in: .whitespacesAndNewlines).count > 12 else { throw InvoiceOCRError.unreadableDocument }
        return .init(text: text, pageCount: images.count)
    }

    private static func recognize(_ image: CGImage) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error { continuation.resume(throwing: error); return }
                let lines = (request.results as? [VNRecognizedTextObservation])?.compactMap { $0.topCandidates(1).first?.string } ?? []
                continuation.resume(returning: lines.joined(separator: "\n"))
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-IN", "en-US"]
            DispatchQueue.global(qos: .userInitiated).async {
                do { try VNImageRequestHandler(cgImage: image).perform([request]) }
                catch { continuation.resume(throwing: error) }
            }
        }
    }
}

struct ParsedInvoice: Sendable {
    struct Line: Sendable {
        let description: String
        let quantity: Double
        let unit: String?
        let unitCost: Double
        let hsnCode: String?
    }
    let supplierName: String?
    let supplierGSTIN: String?
    let invoiceNumber: String?
    let invoiceDate: Date?
    let total: Double?
    let tax: Double
    let lines: [Line]
}

enum InvoiceTextParser {
    static func parse(_ text: String, now: Date = .now) -> ParsedInvoice {
        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let invoiceNumber = firstCapture(in: text, patterns: [
            #"(?i)(?:invoice|bill)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})"#,
            #"(?i)inv\.?\s*(?:no\.?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-]{2,})"#,
        ])
        let gstin = firstCapture(in: text, patterns: [#"(?i)(?:GSTIN|GST No\.?)\s*[:\-]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])"#])
        let dateText = firstCapture(in: text, patterns: [
            #"(?i)(?:invoice\s*date|dated|date)\s*[:\-]?\s*([0-3]?\d[./\-][01]?\d[./\-](?:20)?\d{2})"#,
            #"\b([0-3]?\d[./\-][01]?\d[./\-]20\d{2})\b"#,
        ])
        let total = amount(on: lines.last(where: { $0.range(of: #"(?i)grand\s*total|invoice\s*total|net\s*amount|amount\s*payable"#, options: .regularExpression) != nil }))
            ?? lines.reversed().compactMap(amount(on:)).first
        let taxLines = lines.filter {
            $0.range(of: #"(?i)\b(?:CGST|SGST|IGST|GST|tax)\b"#, options: .regularExpression) != nil &&
            $0.range(of: #"(?i)GSTIN|tax\s+invoice|invoice\s+(?:no|number)"#, options: .regularExpression) == nil
        }
        let tax = taxLines.compactMap(amount(on:)).reduce(0, +)
        let itemLines = lines.compactMap(parseItem)
        let supplier = lines.prefix(8).first { line in
            line.count > 2 && line.count < 100 && line.range(of: #"(?i)invoice|tax|gstin|original|duplicate|phone|date|bill\s+to"#, options: .regularExpression) == nil && line.rangeOfCharacter(from: .letters) != nil
        }
        let parsedDate = dateText.flatMap(parseDate) ?? now
        let fallbackLines = itemLines.isEmpty && (total ?? 0) > tax ? [.init(description: "Invoice purchase", quantity: 1, unit: nil, unitCost: max(0, (total ?? 0) - tax), hsnCode: nil)] : itemLines
        return .init(supplierName: supplier, supplierGSTIN: gstin, invoiceNumber: invoiceNumber, invoiceDate: parsedDate, total: total, tax: tax, lines: fallbackLines)
    }

    private static func parseItem(_ line: String) -> ParsedInvoice.Line? {
        guard line.range(of: #"(?i)\b(MS|HSD|petrol|diesel|lubricant|oil|CNG|DEF|adblue)\b"#, options: .regularExpression) != nil else { return nil }
        let values = numericValues(line)
        guard values.count >= 2 else { return nil }
        let quantity = values.count >= 3 ? values[values.count - 3] : values[0]
        let unitCost = values.count >= 3 ? values[values.count - 2] : values[1]
        guard quantity > 0, unitCost >= 0 else { return nil }
        let hsn = firstCapture(in: line, patterns: [#"\b(\d{4,8})\b"#])
        let description = line.replacingOccurrences(of: #"[\d,]+(?:\.\d+)?"#, with: " ", options: .regularExpression).split(separator: " ").prefix(8).joined(separator: " ")
        let unit = firstCapture(in: line, patterns: [#"(?i)\b(KL|KILOLITRE|L|LTR|LITRE|LITER)\b"#])?.uppercased()
        return .init(description: description.isEmpty ? "Invoice item" : description, quantity: quantity, unit: unit, unitCost: unitCost, hsnCode: hsn)
    }

    private static func amount(on line: String?) -> Double? { line.flatMap { numericValues($0).last } }
    private static func numericValues(_ text: String) -> [Double] {
        matches(in: text, pattern: #"(?<![A-Z0-9])(?:₹|Rs\.?\s*)?([0-9][0-9,]*(?:\.\d{1,3})?)"#, group: 1).compactMap { Double($0.replacingOccurrences(of: ",", with: "")) }
    }
    private static func firstCapture(in text: String, patterns: [String]) -> String? {
        patterns.lazy.compactMap { matches(in: text, pattern: $0, group: 1).first }.first
    }
    private static func matches(in text: String, pattern: String, group: Int) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > group, let range = Range(match.range(at: group), in: text) else { return nil }
            return String(text[range])
        }
    }
    private static func parseDate(_ value: String) -> Date? {
        for format in ["dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "d.M.yyyy", "dd/MM/yy", "d/M/yy"] {
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_IN"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = format
            if let date = formatter.date(from: value) { return date }
        }
        return nil
    }
}
