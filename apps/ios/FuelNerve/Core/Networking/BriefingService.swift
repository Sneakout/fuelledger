import Foundation

struct IntelligenceOwnerView: Decodable, Sendable {
    struct Summary: Decodable, Sendable {
        let sales: Double; let transactions: Int; let meteredVolume: Double
        let collections: Double; let netProfit: Double; let openShifts: Int; let pendingReconciliations: Int
    }
    struct Collection: Decodable, Identifiable, Sendable { var id: String { method }; let method: String; let amount: Double }
    struct Customer: Decodable, Identifiable, Sendable { let id: String; let name: String; let code: String; let outstanding: Double; let availableCredit: Double }
    let asOf: Date; let stationId: String; let summary: Summary; let collections: [Collection]; let customers: [Customer]
}

struct DailyBriefing: Decodable, Sendable {
    struct Fact: Decodable, Identifiable, Sendable {
        let id: String; let category: String; let severity: String; let label: String
        let value: String; let context: String; let evidenceLabel: String; let evidencePath: String
    }
    struct Narrative: Decodable, Sendable {
        struct Item: Decodable, Identifiable, Sendable { var id: String { factId }; let factId: String; let explanation: String; let action: String }
        let headline: String; let summary: String; let items: [Item]
    }
    let date: String; let calculatedAt: Date; let facts: [Fact]; let narrative: Narrative; let narrativeMode: String; let model: String?
}

protocol BriefingService: Sendable {
    func daily(stationId: String?) async throws -> DailyBriefing
    func ownerView(stationId: String) async throws -> IntelligenceOwnerView
}

struct LiveBriefingService: BriefingService {
    let client: APIClient
    func daily(stationId: String?) async throws -> DailyBriefing {
        try await client.get("intelligence/daily-briefing", query: stationId.map { [URLQueryItem(name: "stationId", value: $0)] } ?? [], as: DailyBriefing.self)
    }
    func ownerView(stationId: String) async throws -> IntelligenceOwnerView {
        try await client.get("intelligence/owner-view", query: [URLQueryItem(name: "stationId", value: stationId)], as: IntelligenceOwnerView.self)
    }
}

struct PreviewBriefingService: BriefingService {
    func daily(stationId: String?) async throws -> DailyBriefing {
        DailyBriefing(date: "2026-09-07", calculatedAt: .now, facts: [
            .init(id: "open-shifts", category: "SHIFT", severity: "ATTENTION", label: "Open shifts", value: "1", context: "This shift remains operational and requires a proper handover before closing.", evidenceLabel: "Open shift records", evidencePath: "/operations"),
            .init(id: "sales-today", category: "SALES", severity: "POSITIVE", label: "Sales today", value: "₹3,87,633", context: "Compared with yesterday: +8.4%.", evidenceLabel: "Sales records", evidencePath: "/sales"),
            .init(id: "profit-today", category: "PROFIT", severity: "INFORMATION", label: "Net profit today", value: "₹28,740", context: "Calculated from posted revenue, cost of sales and operating expenses.", evidenceLabel: "Profit report", evidencePath: "/reports"),
        ], narrative: .init(headline: "One action deserves your attention", summary: "The outlet is performing well, while an open shift should be reviewed before the day is complete.", items: [
            .init(factId: "open-shifts", explanation: "The operational handover is the clearest immediate priority.", action: "Review the shift and complete the handover."),
            .init(factId: "sales-today", explanation: "Sales momentum is healthy against the recent baseline.", action: "Keep monitoring collections alongside sales."),
        ]), narrativeMode: "AI_EXPLAINED", model: "preview")
    }
    func ownerView(stationId: String) async throws -> IntelligenceOwnerView {
        .init(asOf: .now, stationId: stationId, summary: .init(sales: 387_633, transactions: 148, meteredVolume: 4_010, collections: 379_400, netProfit: 28_740, openShifts: 1, pendingReconciliations: 0), collections: [.init(method: "CASH", amount: 174_400), .init(method: "UPI", amount: 145_000), .init(method: "CARD", amount: 60_000)], customers: [.init(id: "customer-1", name: "ABC Transport", code: "CUS-0001", outstanding: 3_954, availableCredit: 46_046)])
    }
}
