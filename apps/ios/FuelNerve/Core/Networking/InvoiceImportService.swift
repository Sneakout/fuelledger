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
    init(_ value: Double) { self.value = value }
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
    let purchasePriceExcludedAmount: Double?
    let notes: String?
    let receiveNow: Bool
    let paidNow: Bool
    let paymentMethod: String?
    let paymentReferenceNo: String?
    let attachment: Attachment?
    let lines: [Line]
}

struct NewSupplierSubmission: Encodable, Sendable {
    let name: String
    let code: String
    let phone: String
    let email: String
    let taxId: String
    let address: String
    let paymentTerms: Int
    let active: Bool
}

struct PostedPurchaseInvoice: Decodable, Sendable {
    let id: String
    let invoiceNumber: String
}

struct PostedPurchaseInvoiceResult: Decodable, Sendable {
    let invoice: PostedPurchaseInvoice
    let priceApprovals: [OwnerApproval]?
}

protocol InvoiceImportService: Sendable {
    func bootstrap() async throws -> InvoiceImportBootstrap
    func createSupplier(_ supplier: NewSupplierSubmission, idempotencyKey: String) async throws -> InvoiceImportBootstrap.Supplier
    func post(_ invoice: PurchaseInvoiceSubmission, idempotencyKey: String) async throws -> PostedPurchaseInvoiceResult
}

struct LiveInvoiceImportService: InvoiceImportService {
    let client: APIClient
    func bootstrap() async throws -> InvoiceImportBootstrap {
        try await client.get("purchases/bootstrap", as: InvoiceImportBootstrap.self)
    }
    func createSupplier(_ supplier: NewSupplierSubmission, idempotencyKey: String) async throws -> InvoiceImportBootstrap.Supplier {
        struct Response: Decodable, Sendable { let supplier: InvoiceImportBootstrap.Supplier }
        return try await client.send("purchases/suppliers", body: supplier, idempotencyKey: idempotencyKey, as: Response.self).supplier
    }
    func post(_ invoice: PurchaseInvoiceSubmission, idempotencyKey: String) async throws -> PostedPurchaseInvoiceResult {
        try await client.send("purchases/invoices", body: invoice, idempotencyKey: idempotencyKey, as: PostedPurchaseInvoiceResult.self)
    }
}

struct PreviewInvoiceImportService: InvoiceImportService {
    func bootstrap() async throws -> InvoiceImportBootstrap { .init(suppliers: [], stations: [], products: []) }
    func createSupplier(_ supplier: NewSupplierSubmission, idempotencyKey: String) async throws -> InvoiceImportBootstrap.Supplier { throw APIError.actionDisabled }
    func post(_ invoice: PurchaseInvoiceSubmission, idempotencyKey: String) async throws -> PostedPurchaseInvoiceResult { throw APIError.actionDisabled }
}
