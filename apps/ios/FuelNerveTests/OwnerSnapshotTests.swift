import Foundation
import Testing
@testable import FuelNerve

struct OwnerSnapshotTests {
    @Test func previewSnapshotContainsActionableEvidence() async throws {
        let snapshot = try await PreviewOwnerService().snapshot(stationId: nil)
        #expect(snapshot.salesToday > 0)
        #expect(snapshot.tanks.count == 2)
        #expect(snapshot.stations.count == 2)
    }

    @Test func loadPlanUsesBookStockAndWorkingCapacityForExactUllage() {
        let snapshot = OwnerSnapshot(
            asOf: Date(timeIntervalSince1970: 1_800_000_000), stationName: "Station C",
            salesToday: 0, transactions: 0, collectedToday: 0, netProfitToday: 0, meteredVolume: 0,
            openShifts: 0, pendingReconciliations: 0, stations: [],
            tanks: [
                OwnerTank(id: "ms-1", code: "MS-1", productCode: "MS", bookStock: 11_000, workingCapacity: 19_000, fillPercent: 57.9, status: "HEALTHY", sellingPrice: 0, density: nil),
                OwnerTank(id: "hsd-1", code: "HSD-1", productCode: "HSD", bookStock: 15_000, workingCapacity: 19_000, fillPercent: 78.9, status: "HEALTHY", sellingPrice: 0, density: nil),
            ], collections: [], alerts: []
        )

        let plan = LoadPlanRecommendation(snapshot: snapshot)

        #expect(plan?.lines.first(where: { $0.productCode == "MS" })?.ullage == 8_000)
        #expect(plan?.lines.first(where: { $0.productCode == "HSD" })?.ullage == 4_000)
        #expect(plan?.checkedAt == snapshot.asOf)
    }

    @Test func loadPlanWithholdsQuantitiesWhenTankBalanceIsInvalid() {
        let snapshot = OwnerSnapshot(
            asOf: .now, stationName: "Station C", salesToday: 0, transactions: 0, collectedToday: 0,
            netProfitToday: 0, meteredVolume: 0, openShifts: 0, pendingReconciliations: 0, stations: [],
            tanks: [OwnerTank(id: "ms-1", code: "MS-1", productCode: "MS", bookStock: 20_000, workingCapacity: 19_000, fillPercent: 105.3, status: "OVER_CAPACITY", sellingPrice: 0, density: nil)],
            collections: [], alerts: []
        )

        #expect(LoadPlanRecommendation(snapshot: snapshot) == nil)
    }

    @Test func localEnvironmentAllowsExplicitPreviewData() throws {
        let environment = try AppEnvironment(infoDictionary: configuration(
            environment: "local",
            apiURL: "http://127.0.0.1:4000/api",
            webURL: "http://127.0.0.1:5173",
            preview: "YES"
        ))
        #expect(environment.name == .local)
        #expect(environment.usesPreviewData)
    }

    @Test func productionRequiresSecureURLs() {
        #expect(throws: AppEnvironment.ConfigurationError.insecureRemoteURL("http://fuel.example/api")) {
            try AppEnvironment(infoDictionary: configuration(
                environment: "production",
                apiURL: "http://fuel.example/api",
                webURL: "https://fuel.example",
                preview: "NO"
            ))
        }
    }

    @Test func previewDataCannotBeEnabledOutsideLocalDevelopment() {
        #expect(throws: AppEnvironment.ConfigurationError.previewOutsideLocal) {
            try AppEnvironment(infoDictionary: configuration(
                environment: "staging",
                apiURL: "https://staging.fuel.example/api",
                webURL: "https://staging.fuel.example",
                preview: "YES"
            ))
        }
    }

    private func configuration(environment: String, apiURL: String, webURL: String, preview: String) -> [String: Any] {
        [
            "FuelNerveEnvironment": environment,
            "FuelNerveAPIBaseURL": apiURL,
            "FuelNerveWebBaseURL": webURL,
            "FuelNerveUsePreviewData": preview,
        ]
    }
}
