import Foundation

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

protocol BriefingService: Sendable { func daily(stationId: String?) async throws -> DailyBriefing }

struct LiveBriefingService: BriefingService {
    let client: APIClient
    func daily(stationId: String?) async throws -> DailyBriefing {
        try await client.get("intelligence/daily-briefing", query: stationId.map { [URLQueryItem(name: "stationId", value: $0)] } ?? [], as: DailyBriefing.self)
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
}
