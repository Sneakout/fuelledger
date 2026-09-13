import Testing
@testable import FuelNerve

struct OwnerSnapshotTests {
    @Test func previewSnapshotContainsActionableEvidence() async throws {
        let snapshot = try await PreviewOwnerService().snapshot(stationId: nil)
        #expect(snapshot.salesToday > 0)
        #expect(snapshot.tanks.count == 2)
        #expect(snapshot.stations.count == 2)
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
