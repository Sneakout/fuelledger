import Foundation

struct OwnerApproval: Decodable, Identifiable, Sendable {
    struct Person: Decodable, Sendable { let id: String; let name: String; let role: String }
    struct Station: Decodable, Sendable { let id: String; let name: String; let code: String }
    struct Payload: Decodable, Sendable {
        let stationId: String; let productId: String; let tankId: String?; let quantityDelta: Double?; let notes: String?
        let invoiceId: String?; let invoiceNumber: String?; let proposedPurchasePrice: Double?
        let suggestedSellingPrice: Double?; let purchaseEffectiveFrom: Date?
    }
    struct Evidence: Decodable, Sendable {
        struct Product: Decodable, Sendable { let id: String; let name: String; let code: String; let unit: String }
        struct Tank: Decodable, Sendable { let id: String; let code: String }
        struct Invoice: Decodable, Sendable { let id: String; let invoiceNumber: String; let totalAmount: Double; let quantity: Double; let sourceUnit: String }
        let product: Product; let tank: Tank?; let bookStockBefore: Double?; let proposedBookStock: Double?
        let invoice: Invoice?; let currentPurchasePrice: Double?; let proposedPurchasePrice: Double?
        let currentSellingPrice: Double?; let suggestedSellingPrice: Double?
        let purchaseEffectiveFrom: Date?; let checkedAt: String; let evidencePath: String
    }
    struct Execution: Decodable, Sendable { let type: String?; let id: String; let executedAt: Date? }
    let id: String; let actionType: String; let status: String; let reason: String
    let payload: Payload; let evidence: Evidence; let requestedAt: Date
    let requestedBy: Person; let station: Station; let decidedAt: Date?
    let decidedBy: Person?; let decisionNote: String?; let execution: Execution?; let version: Int

    var isPriceChange: Bool { actionType == "PRODUCT_PRICE_CHANGE" }
}

protocol ApprovalService: Sendable {
    func approvals(status: String?) async throws -> [OwnerApproval]
    func decide(id: String, approve: Bool, note: String, version: Int, sellingPrice: Double?, sellingPriceEffectiveFrom: Date?) async throws -> OwnerApproval
}

extension ApprovalService {
    func approvals() async throws -> [OwnerApproval] { try await approvals(status: "PENDING") }
}

struct LiveApprovalService: ApprovalService {
    let client: APIClient
    func approvals(status: String?) async throws -> [OwnerApproval] {
        struct Response: Decodable, Sendable { let approvals: [OwnerApproval] }
        let query = status.map { [URLQueryItem(name: "status", value: $0)] } ?? []
        return try await client.get("approvals", query: query, as: Response.self).approvals
    }
    func decide(id: String, approve: Bool, note: String, version: Int, sellingPrice: Double? = nil, sellingPriceEffectiveFrom: Date? = nil) async throws -> OwnerApproval {
        struct Body: Encodable, Sendable { let decision: String; let note: String; let version: Int; let sellingPrice: Double?; let sellingPriceEffectiveFrom: String? }
        struct Response: Decodable, Sendable { let approval: OwnerApproval }
        return try await client.send("approvals/\(id)/decision", body: Body(decision: approve ? "APPROVE" : "REJECT", note: note, version: version, sellingPrice: sellingPrice, sellingPriceEffectiveFrom: sellingPriceEffectiveFrom.map { ISO8601DateFormatter().string(from: $0) }), as: Response.self).approval
    }
}

struct PreviewApprovalService: ApprovalService {
    func approvals(status: String?) async throws -> [OwnerApproval] {
        [.init(id: "approval-1", actionType: "INVENTORY_ADJUSTMENT", status: "PENDING", reason: "Verified dip shortage after delivery reconciliation", payload: .init(stationId: "station", productId: "ms", tankId: "tank", quantityDelta: -42, notes: "Verified dip shortage after delivery reconciliation", invoiceId: nil, invoiceNumber: nil, proposedPurchasePrice: nil, suggestedSellingPrice: nil, purchaseEffectiveFrom: nil), evidence: .init(product: .init(id: "ms", name: "Motor Spirit", code: "MS", unit: "LITRE"), tank: .init(id: "tank", code: "T-1"), bookStockBefore: 6240, proposedBookStock: 6198, invoice: nil, currentPurchasePrice: nil, proposedPurchasePrice: nil, currentSellingPrice: nil, suggestedSellingPrice: nil, purchaseEffectiveFrom: nil, checkedAt: ISO8601DateFormatter().string(from: .now), evidencePath: "/inventory"), requestedAt: .now.addingTimeInterval(-900), requestedBy: .init(id: "manager", name: "Station Manager", role: "MANAGER"), station: .init(id: "station", name: "Greenway Fuel Point", code: "GFP"), decidedAt: nil, decidedBy: nil, decisionNote: nil, execution: nil, version: 1)]
    }
    func decide(id: String, approve: Bool, note: String, version: Int, sellingPrice: Double? = nil, sellingPriceEffectiveFrom: Date? = nil) async throws -> OwnerApproval { try await approvals(status: "PENDING")[0] }
}
