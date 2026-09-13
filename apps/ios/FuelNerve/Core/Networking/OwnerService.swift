import Foundation

protocol OwnerService: Sendable { func snapshot(stationId: String?) async throws -> OwnerSnapshot }

struct LiveOwnerService: OwnerService {
    let client: APIClient
    func snapshot(stationId: String?) async throws -> OwnerSnapshot {
        let response = try await client.get("dashboard/bootstrap", query: stationId.map { [URLQueryItem(name: "stationId", value: $0)] } ?? [], as: DashboardResponse.self)
        return response.ownerSnapshot(selectedStationId: stationId)
    }
}

struct PreviewOwnerService: OwnerService {
    func snapshot(stationId: String?) async throws -> OwnerSnapshot {
        let stations = [OwnerStation(id: "greenway", name: "Greenway Fuel Point", code: "GFP-01", openShifts: 1, status: "RUNNING"), OwnerStation(id: "highway", name: "Highway Service Station", code: "HSS-02", openShifts: 0, status: "CALM")]
        let selected = stations.first(where: { $0.id == stationId }) ?? stations[0], first = selected.id == "greenway"
        let alerts = first ? [OwnerAlert(id: "shift-open", title: "One shift is still open", detail: "Expected close was 10:00 PM. Review the handover before closing.", severity: .urgent, evidence: "Shift and collection records", evidencePath: "/operations", stationName: selected.name, createdAt: .now.addingTimeInterval(-900), readAt: nil, acknowledgedAt: nil), OwnerAlert(id: "stock-watch", title: "MS Tank 1 is trending low", detail: "6,240 L remains, approximately 1.4 days of cover.", severity: .attention, evidence: "Tank, dip and sales records", evidencePath: "/inventory", stationName: selected.name, createdAt: .now.addingTimeInterval(-3600), readAt: .now, acknowledgedAt: nil)] : []
        return OwnerSnapshot(asOf: .now, stationName: selected.name, salesToday: first ? 387_633 : 214_820, transactions: first ? 148 : 91, collectedToday: first ? 379_400 : 210_300, netProfitToday: first ? 28_740 : 17_640, meteredVolume: first ? 4_010 : 2_230, openShifts: selected.openShifts, pendingReconciliations: first ? 1 : 0, stations: stations, tanks: first ? [OwnerTank(id: "ms-1", code: "T-1", productCode: "MS", bookStock: 6_240, workingCapacity: 19_000, fillPercent: 32.8, status: "HEALTHY"), OwnerTank(id: "hsd-1", code: "T-2", productCode: "HSD", bookStock: 11_850, workingCapacity: 19_000, fillPercent: 62.4, status: "HEALTHY")] : [OwnerTank(id: "ms-2", code: "T-1", productCode: "MS", bookStock: 2_900, workingCapacity: 15_000, fillPercent: 19.3, status: "LOW"), OwnerTank(id: "hsd-2", code: "T-2", productCode: "HSD", bookStock: 8_100, workingCapacity: 20_000, fillPercent: 40.5, status: "HEALTHY")], collections: [OwnerCollection(method: "CASH", amount: first ? 174_400 : 98_300), OwnerCollection(method: "UPI", amount: first ? 145_000 : 82_000), OwnerCollection(method: "CARD", amount: first ? 60_000 : 30_000)], alerts: alerts)
    }
}

private extension DashboardResponse {
    func ownerSnapshot(selectedStationId: String?) -> OwnerSnapshot {
        let selected = stationHealth.first(where: { $0.id == selectedStationId })
        return OwnerSnapshot(asOf: asOf, stationName: selected?.name ?? (stationHealth.count == 1 ? stationHealth[0].name : "All fuel stations"), salesToday: today.grossSales, transactions: today.transactions, collectedToday: collections.reduce(0) { $0 + $1.amount }, netProfitToday: today.netProfit, meteredVolume: today.meteredVolume, openShifts: operations.openShifts, pendingReconciliations: operations.pendingReconciliations, stations: stationHealth.map { OwnerStation(id: $0.id, name: $0.name, code: $0.code, openShifts: $0.openShifts, status: $0.status) }, tanks: tankStocks.filter { selectedStationId == nil || $0.station.id == selectedStationId }.map { OwnerTank(id: $0.id, code: $0.code, productCode: $0.productCode, bookStock: $0.bookStock, workingCapacity: $0.workingCapacity, fillPercent: $0.fillPercent, status: $0.status) }, collections: collections.map { OwnerCollection(method: $0.method, amount: $0.amount) }, alerts: actions.map { OwnerAlert(id: $0.id, title: $0.title, detail: $0.detail, severity: $0.severity == "HIGH" ? .urgent : .attention, evidence: "Verified FuelNerve records", evidencePath: "/dashboard", stationName: selected?.name, createdAt: asOf, readAt: nil, acknowledgedAt: nil) })
    }
}
