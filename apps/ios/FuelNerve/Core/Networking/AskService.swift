import Foundation

struct FuelNerveAnswer: Decodable, Sendable {
    struct SupportingRecord: Decodable, Identifiable, Sendable { var id: String { evidenceId }; let evidenceId: String; let evidenceType: String; let label: String; let resolverPath: String }
    struct Fact: Decodable, Identifiable, Sendable { let id: String; let label: String; let value: String; let context: String; let evidenceLabel: String; let evidencePath: String; let priorityRank: Int?; let priorityReason: String?; let supportingRecords: [SupportingRecord]? }
    struct Answer: Decodable, Sendable { let title: String; let explanation: String; let action: String; let facts: [Fact] }
    struct Usage: Decodable, Sendable { let used: Int; let limit: Int; let remaining: Int }
    let id: String; let intent: String; let answer: Answer; let answerMode: String; let usage: Usage
    let stationId: String?; let snapshotDate: String?; let stale: Bool?; let inconsistentSnapshot: Bool?; let missingInformation: [String]?; let supportedFollowUps: [String]?
}

protocol AskService: Sendable { func ask(_ question: String, stationId: String?, requestId: UUID, asOf: String?) async throws -> FuelNerveAnswer }

struct LiveAskService: AskService {
    let client: APIClient
    func ask(_ question: String, stationId: String?, requestId: UUID, asOf: String?) async throws -> FuelNerveAnswer {
        struct Body: Encodable, Sendable { let requestId: String; let question: String; let stationId: String?; let asOf: String? }
        return try await client.send("intelligence/ask", body: Body(requestId: requestId.uuidString, question: question, stationId: stationId, asOf: asOf), as: FuelNerveAnswer.self)
    }
}

struct PreviewAskService: AskService {
    func ask(_ question: String, stationId: String?, requestId: UUID, asOf: String?) async throws -> FuelNerveAnswer {
        .init(id: UUID().uuidString, intent: "STOCK_POSITION", answer: .init(title: "MS Tank 1 needs attention first", explanation: "Recorded stock is low.", action: "Review its supporting records before deciding what to do.", facts: [.init(id: "ms", label: "MS Tank 1", value: "6,240 L", context: "Recorded stock is low", evidenceLabel: "Tank stock timeline", evidencePath: "/inventory", priorityRank: 1, priorityReason: "Recorded stock is low", supportingRecords: nil)]), answerMode: "AI_EXPLAINED", usage: .init(used: 4, limit: 25, remaining: 21), stationId: stationId, snapshotDate: asOf ?? ISO8601DateFormatter().string(from: .now), stale: false, inconsistentSnapshot: false, missingInformation: [], supportedFollowUps: ["Give me details", "Why first?", "Show the records"])
    }
}
