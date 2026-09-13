import Foundation

struct InvoiceImportBootstrap: Decodable, Sendable {
    struct Supplier: Decodable, Identifiable, Sendable {
        let id: String
        let name: String
        let code: String
        let taxId: String?
        let paymentTerms: Int
        let active: Bool
    }
    struct Product: Decodable, Identifiable, Sendable {
        let id: String
        let name: String
        let code: String
        let unit: String
        let hsnCode: String?
        let tankLinked: Bool
        let purchasePrice: FlexibleNumber
        let sellingPrice: FlexibleNumber
        let taxCategory: TaxCategory?
        struct TaxCategory: Decodable, Sendable { let rate: FlexibleNumber }
    }
    struct Station: Decodable, Identifiable, Sendable {
        let id: String
        let name: String
        let code: String
        let configurations: [Configuration]
        struct Configuration: Decodable, Sendable {
            let tanks: [Tank]
            struct Tank: Decodable, Identifiable, Sendable { let id: String; let code: String; let productId: String }
        }
        var tanks: [Configuration.Tank] { configurations.first?.tanks ?? [] }
    }
    let suppliers: [Supplier]
    let stations: [Station]
    let products: [Product]
}

struct FlexibleNumber: Decodable, Sendable {
    let value: Double
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) { value = number; return }
        let text = try container.decode(String.self)
        guard let number = Double(text) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Expected a number.")
        }
        value = number
    }
}

struct PurchaseInvoiceSubmission: Encodable, Sendable {
    struct Line: Encodable, Sendable {
        let productId: String?
        let tankId: String?
        let description: String
        let quantity: Double
        let sourceUnit: String?
        let unitCost: Double
        let taxRate: Double
        let hsnCode: String?
    }
    struct Attachment: Encodable, Sendable {
        let fileName: String
        let mimeType: String
        let size: Int
        let contentBase64: String
    }
    let stationId: String
    let supplierId: String
    let invoiceNumber: String
    let invoiceDate: String
    let dueDate: String
    let invoiceTotal: Double?
    let taxAmount: Double
    let notes: String?
    let receiveNow: Bool
    let paidNow: Bool
    let paymentMethod: String?
    let paymentReferenceNo: String?
    let attachment: Attachment?
    let lines: [Line]
}

struct PostedPurchaseInvoice: Decodable, Sendable {
    let id: String
    let invoiceNumber: String
}

protocol InvoiceImportService: Sendable {
    func bootstrap() async throws -> InvoiceImportBootstrap
    func post(_ invoice: PurchaseInvoiceSubmission, idempotencyKey: String) async throws -> PostedPurchaseInvoice
}

struct LiveInvoiceImportService: InvoiceImportService {
    let client: APIClient
    func bootstrap() async throws -> InvoiceImportBootstrap {
        try await client.get("purchases/bootstrap", as: InvoiceImportBootstrap.self)
    }
    func post(_ invoice: PurchaseInvoiceSubmission, idempotencyKey: String) async throws -> PostedPurchaseInvoice {
        struct Response: Decodable, Sendable { let invoice: PostedPurchaseInvoice }
        return try await client.send("purchases/invoices", body: invoice, idempotencyKey: idempotencyKey, as: Response.self).invoice
    }
}

struct PreviewInvoiceImportService: InvoiceImportService {
    func bootstrap() async throws -> InvoiceImportBootstrap { .init(suppliers: [], stations: [], products: []) }
    func post(_ invoice: PurchaseInvoiceSubmission, idempotencyKey: String) async throws -> PostedPurchaseInvoice { throw APIError.actionDisabled }
}
