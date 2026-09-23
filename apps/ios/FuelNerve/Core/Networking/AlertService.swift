import Foundation

protocol AlertService: Sendable {
    func alerts(stationId: String?) async throws -> [OwnerAlert]
    func acknowledge(id: String) async throws
    func registerDevice(token: String) async throws
}

private struct AlertListResponse: Decodable, Sendable {
    struct Item: Decodable, Sendable {
        struct Station: Decodable, Sendable { let name: String }
        let id: String; let type: String?; let severity: String; let title: String; let message: String
        let evidenceLabel: String; let evidencePath: String; let createdAt: Date
        let readAt: Date?; let acknowledgedAt: Date?; let station: Station?; let packet: OwnerAlert.NotificationPacket?
    }
    let alerts: [Item]
}

struct LiveAlertService: AlertService {
    let client: APIClient
    func alerts(stationId: String?) async throws -> [OwnerAlert] {
        let response = try await client.get("notifications/alerts", query: stationId.map { [URLQueryItem(name: "stationId", value: $0)] } ?? [], as: AlertListResponse.self)
        return response.alerts.map { item in
            let severity: OwnerAlert.Severity = item.severity == "URGENT" ? .urgent : item.severity == "ATTENTION" ? .attention : .information
            return OwnerAlert(id: item.id, title: item.title, detail: item.message, severity: severity, evidence: item.evidenceLabel, evidencePath: item.evidencePath, stationName: item.station?.name, createdAt: item.createdAt, readAt: item.readAt, acknowledgedAt: item.acknowledgedAt, packet: item.packet, notificationType: item.type)
        }
    }
    func acknowledge(id: String) async throws {
        struct Empty: Encodable, Sendable {}
        struct Response: Decodable, Sendable { let alert: AcknowledgedAlert }
        struct AcknowledgedAlert: Decodable, Sendable { let id: String }
        _ = try await client.send("notifications/alerts/\(id)/acknowledge", body: Empty(), as: Response.self)
    }
    func registerDevice(token: String) async throws {
        struct Body: Encodable, Sendable { let token: String; let environment: String }
        struct Response: Decodable, Sendable { struct Device: Decodable, Sendable { let id: String }; let device: Device }
        #if DEBUG
        let environment = "DEVELOPMENT"
        #else
        let environment = "PRODUCTION"
        #endif
        _ = try await client.send("notifications/devices", body: Body(token: token, environment: environment), as: Response.self)
    }
}

struct PreviewAlertService: AlertService {
    func alerts(stationId: String?) async throws -> [OwnerAlert] {
        [
            OwnerAlert(id: "market-price-outlook", title: "Plan ahead of a possible price rise", detail: "Crude prices are rising amid conflict in the Middle East. Fuel purchase prices could rise next.", severity: .attention, evidence: "Live tank book stock and working capacity", evidencePath: "/inventory", stationName: "Greenway Fuel Point", createdAt: .now.addingTimeInterval(-300), readAt: nil, acknowledgedAt: nil, packet: .init(schemaVersion: 1, subjectName: "Fuel purchase price outlook", recordType: "MARKET_PRICE_OUTLOOK", product: nil, eventDate: ISO8601DateFormatter().string(from: .now), dueDate: nil, amount: nil, quantity: nil, status: "PRICE_INCREASE_POSSIBLE", daysOverdueOrWaiting: nil, station: .init(id: "greenway", name: "Greenway Fuel Point"), evidence: [.init(label: "Review live tank stock", path: "/inventory", recordType: "TANK_STOCK", recordId: nil)], availableActions: ["ACKNOWLEDGE", "REMIND_LATER", "VIEW_RECORD", "PREPARE_DRAFT"], responsibleAgent: .init(key: "purchase-check", name: "Purchase Agent", responsibility: "Supplier invoices, rates, quantities and receipts")), notificationType: "MARKET_PRICE_OUTLOOK"),
            OwnerAlert(id: "shift-open", title: "One shift is still open", detail: "Expected close was 10:00 PM. Review the handover and collection before closing.", severity: .urgent, evidence: "Open shift and collection records", evidencePath: "/operations", stationName: "Greenway Fuel Point", createdAt: .now.addingTimeInterval(-780), readAt: nil, acknowledgedAt: nil),
            OwnerAlert(id: "stock-watch", title: "MS Tank 1 is trending low", detail: "6,240 L remains, approximately 1.4 days of cover at the recent sales rate.", severity: .attention, evidence: "Tank, dip and sales records", evidencePath: "/inventory", stationName: "Greenway Fuel Point", createdAt: .now.addingTimeInterval(-3_600), readAt: .now, acknowledgedAt: nil),
            OwnerAlert(id: "owner-brief", title: "Sales are 8.4% above average", detail: "The increase is led by stronger HSD volume. Collections remain aligned.", severity: .information, evidence: "Sales and collection records", evidencePath: "/reports", stationName: "Greenway Fuel Point", createdAt: .now.addingTimeInterval(-7_200), readAt: .now, acknowledgedAt: .now),
        ]
    }
    func acknowledge(id: String) async throws {}
    func registerDevice(token: String) async throws {}
}
