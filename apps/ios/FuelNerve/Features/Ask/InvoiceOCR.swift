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
            let pageRange = 0..<min(pdf.pageCount, 8)
            let embeddedText = pageRange.compactMap { pdf.page(at: $0)?.string }.joined(separator: "\n\n")
            if embeddedText.trimmingCharacters(in: .whitespacesAndNewlines).count >= 50 {
                return .init(text: embeddedText, pageCount: pageRange.count)
            }
            images = pageRange.compactMap { index in
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
            guard let source = UIImage(data: document.data), let image = normalizedImage(source) else { throw InvoiceOCRError.unsupportedDocument }
            images = [image]
        }
        var pages: [String] = []
        for image in images { pages.append(try await recognize(image)) }
        let text = pages.joined(separator: "\n\n")
        guard text.trimmingCharacters(in: .whitespacesAndNewlines).count > 12 else { throw InvoiceOCRError.unreadableDocument }
        return .init(text: text, pageCount: images.count)
    }

    private static func normalizedImage(_ image: UIImage) -> CGImage? {
        if image.imageOrientation == .up, let cgImage = image.cgImage { return cgImage }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = image.scale
        format.opaque = true
        return UIGraphicsImageRenderer(size: image.size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: image.size))
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }.cgImage
    }

    private static func recognize(_ image: CGImage) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error { continuation.resume(throwing: error); return }
                let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
                continuation.resume(returning: textInReadingOrder(observations))
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

    private struct RecognizedFragment {
        let text: String
        let box: CGRect
    }

    /// Vision may return table cells column-by-column. Rebuild visual rows so a
    /// product, its quantity, rate and amount reach the parser on the same line.
    private static func textInReadingOrder(_ observations: [VNRecognizedTextObservation]) -> String {
        let fragments = observations.compactMap { observation -> RecognizedFragment? in
            guard let text = observation.topCandidates(1).first?.string,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return .init(text: text, box: observation.boundingBox)
        }
        .sorted { $0.box.midY > $1.box.midY }

        var rows: [[RecognizedFragment]] = []
        for fragment in fragments {
            if let index = rows.lastIndex(where: { row in
                guard let first = row.first else { return false }
                let rowMidY = row.map(\.box.midY).reduce(0, +) / CGFloat(row.count)
                let rowHeight = row.map(\.box.height).max() ?? first.box.height
                return abs(rowMidY - fragment.box.midY) <= max(rowHeight, fragment.box.height) * 0.45
            }) {
                rows[index].append(fragment)
            } else {
                rows.append([fragment])
            }
        }

        return rows
            .sorted { ($0.first?.box.midY ?? 0) > ($1.first?.box.midY ?? 0) }
            .map { row in row.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: " ") }
            .joined(separator: "\n")
    }
}
