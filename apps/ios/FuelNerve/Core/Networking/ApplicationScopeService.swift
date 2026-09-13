import Foundation

struct ApplicationScope: Sendable {
    struct Capabilities: Decodable, Sendable {
        let version: Int
        let readOnly: Bool
        let approvals: Bool
        let alertAcknowledgement: Bool
        let pushRegistration: Bool
        let proposals: Bool
        let execution: Bool
        let invoiceCapture: Bool?

        var canCaptureInvoices: Bool { invoiceCapture == true }

        static let disabled = Capabilities(version: 1, readOnly: true, approvals: false, alertAcknowledgement: false, pushRegistration: false, proposals: false, execution: false, invoiceCapture: false)
    }
    struct Station: Decodable, Identifiable, Sendable {
        let id: String
        let name: String
        let code: String
        let city: String
        let state: String
    }

    struct IntelligenceEntitlement: Sendable {
        let enabledAt: Date?
        let expiresAt: Date?

        func isActive(at date: Date = .now) -> Bool {
            enabledAt != nil && (expiresAt == nil || expiresAt! > date)
        }
    }

    let allStations: Bool
    let stations: [Station]
    let intelligence: IntelligenceEntitlement
    let capabilities: Capabilities
}

protocol ApplicationScopeService: Sendable {
    func load() async throws -> ApplicationScope
}

struct LiveApplicationScopeService: ApplicationScopeService {
    private struct StationContext: Decodable, Sendable {
        let allStations: Bool
        let stations: [ApplicationScope.Station]
    }
    private struct Subscription: Decodable, Sendable {
        let intelligenceEnabledAt: Date?
        let intelligenceExpiresAt: Date?
    }

    let client: APIClient

    func load() async throws -> ApplicationScope {
        async let context = client.get("access/context", as: StationContext.self)
        async let subscription = client.get("platform/subscription", as: Subscription.self)
        async let capabilities = client.get("platform/capabilities", as: ApplicationScope.Capabilities.self)
        let (stationContext, plan, serverCapabilities) = try await (context, subscription, capabilities)
        return ApplicationScope(
            allStations: stationContext.allStations,
            stations: stationContext.stations,
            intelligence: .init(enabledAt: plan.intelligenceEnabledAt, expiresAt: plan.intelligenceExpiresAt),
            capabilities: serverCapabilities
        )
    }
}

struct PreviewApplicationScopeService: ApplicationScopeService {
    func load() async throws -> ApplicationScope {
        ApplicationScope(
            allStations: true,
            stations: [
                .init(id: "greenway", name: "Greenway Fuel Point", code: "GFP-01", city: "Kochi", state: "Kerala"),
                .init(id: "highway", name: "Highway Service Station", code: "HSS-02", city: "Kochi", state: "Kerala"),
            ],
            intelligence: .init(enabledAt: .now, expiresAt: nil),
            capabilities: .disabled
        )
    }
}
