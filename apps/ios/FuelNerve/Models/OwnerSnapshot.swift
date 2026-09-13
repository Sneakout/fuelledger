import Foundation

struct OwnerSnapshot: Sendable {
    let asOf: Date
    let stationName: String
    let salesToday: Double
    let transactions: Int
    let collectedToday: Double
    let netProfitToday: Double
    let meteredVolume: Double
    let openShifts: Int
    let pendingReconciliations: Int
    let stations: [OwnerStation]
    let tanks: [OwnerTank]
    let collections: [OwnerCollection]
    let alerts: [OwnerAlert]
}

struct OwnerStation: Codable, Identifiable, Sendable {
    let id: String; let name: String; let code: String; let openShifts: Int; let status: String
}

struct OwnerTank: Codable, Identifiable, Sendable {
    let id: String; let code: String; let productCode: String
    let bookStock: Double; let workingCapacity: Double; let fillPercent: Double; let status: String
}

struct OwnerCollection: Codable, Identifiable, Sendable {
    var id: String { method }
    let method: String; let amount: Double
}

struct OwnerAlert: Codable, Identifiable, Sendable {
    struct NotificationPacket: Codable, Sendable {
        struct Product: Codable, Sendable { let name: String; let code: String }
        struct Value: Codable, Sendable { let value: Double; let currency: String?; let unit: String? }
        struct Station: Codable, Sendable { let id: String?; let name: String }
        struct Evidence: Codable, Sendable { let label: String; let path: String; let recordType: String; let recordId: String? }
        struct Agent: Codable, Sendable { let key: String; let name: String; let responsibility: String }
        let schemaVersion: Int; let subjectName: String; let recordType: String; let product: Product?
        let eventDate: String; let dueDate: String?; let amount: Value?; let quantity: Value?
        let status: String; let daysOverdueOrWaiting: Int?; let station: Station
        let evidence: [Evidence]; let availableActions: [String]; let responsibleAgent: Agent?
    }
    enum Severity: String, Codable, Sendable { case information, attention, urgent }
    let id: String; let title: String; let detail: String; let severity: Severity
    let evidence: String; let evidencePath: String; let stationName: String?
    let createdAt: Date; let readAt: Date?; let acknowledgedAt: Date?; var packet: NotificationPacket? = nil
}

struct DashboardResponse: Decodable, Sendable {
    struct Summary: Decodable, Sendable { let grossSales: Double; let transactions: Int; let meteredVolume: Double; let netProfit: Double }
    struct Operations: Decodable, Sendable { let openShifts: Int; let pendingReconciliations: Int }
    struct Collection: Decodable, Sendable { let method: String; let amount: Double }
    struct Station: Decodable, Sendable { let id: String; let name: String; let code: String; let openShifts: Int; let status: String }
    struct Tank: Decodable, Sendable {
        struct StationReference: Decodable, Sendable { let id: String }
        let id: String; let code: String; let productCode: String; let bookStock: Double
        let workingCapacity: Double; let fillPercent: Double; let status: String; let station: StationReference
    }
    struct Action: Decodable, Sendable { let id: String; let severity: String; let title: String; let detail: String }
    let asOf: Date; let today: Summary; let collections: [Collection]; let operations: Operations
    let actions: [Action]; let stationHealth: [Station]; let tankStocks: [Tank]
}

extension Double {
    var rupees: String {
        let formatter = NumberFormatter(); formatter.numberStyle = .currency; formatter.currencyCode = "INR"; formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: self)) ?? "₹0"
    }
    var litres: String { formatted(.number.precision(.fractionLength(0...1))) + " L" }
}
