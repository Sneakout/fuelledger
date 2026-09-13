import Foundation
import Testing
@testable import FuelNerve

@MainActor
@Suite(.serialized)
struct AuthenticationTests {
    @Test func restoringValidSessionSignsUserIn() async throws {
        let service = AuthenticationServiceStub(user: user())
        let session = AppSession(environment: try localEnvironment(), authenticationService: service, applicationScopeService: ApplicationScopeServiceStub())

        await session.restoreSession()

        #expect(session.state == .signedIn)
        #expect(session.user?.organization.id == "organization-1")
    }

    @Test func mandatoryPasswordChangeBlocksApplicationAccess() async throws {
        let service = AuthenticationServiceStub(user: user(mustChangePassword: true))
        let session = AppSession(environment: try localEnvironment(), authenticationService: service, applicationScopeService: ApplicationScopeServiceStub())

        await session.restoreSession()

        #expect(session.state == .passwordChangeRequired)
    }

    @Test func invalidRestoredSessionFailsClosedAndClearsCookies() async throws {
        let service = AuthenticationServiceStub(user: user(), restoreError: APIError.unauthenticated)
        let session = AppSession(environment: try localEnvironment(), authenticationService: service, applicationScopeService: ApplicationScopeServiceStub())

        await session.restoreSession()

        #expect(session.state == .signedOut)
        #expect(session.user == nil)
        #expect(await service.logoutCount == 1)
    }

    @Test func unavailableServerPreservesSessionForRetry() async throws {
        let service = AuthenticationServiceStub(user: user(), restoreError: URLError(.cannotConnectToHost))
        let session = AppSession(environment: try localEnvironment(), authenticationService: service, applicationScopeService: ApplicationScopeServiceStub())

        await session.restoreSession()

        #expect(session.state == .offline)
        #expect(session.user == nil)
        #expect(await service.logoutCount == 0)
    }

    @Test func logoutClearsCachedUser() async throws {
        let service = AuthenticationServiceStub(user: user())
        let session = AppSession(environment: try localEnvironment(), authenticationService: service, applicationScopeService: ApplicationScopeServiceStub())
        await session.restoreSession()

        await session.logout()

        #expect(session.state == .signedOut)
        #expect(session.user == nil)
        #expect(await service.logoutCount == 1)
    }

    @Test func stationSelectionAcceptsOnlyPermittedStations() async throws {
        let session = AppSession(environment: try localEnvironment(), authenticationService: AuthenticationServiceStub(user: user()), applicationScopeService: ApplicationScopeServiceStub())
        await session.restoreSession()
        #expect(session.selectedStationId == "station-c")

        session.selectStation("station-d")
        #expect(session.selectedStationId == "station-d")

        session.selectStation("another-organization-station")
        #expect(session.selectedStationId == "station-c")
        #expect(session.scopeMessage != nil)
    }

    @Test func authenticatedContextExposesTrustedScope() async throws {
        let session = AppSession(environment: try localEnvironment(), authenticationService: AuthenticationServiceStub(user: user()), applicationScopeService: ApplicationScopeServiceStub())
        await session.restoreSession()

        #expect(session.organization?.id == "organization-1")
        #expect(session.role == .owner)
        #expect(session.hasIntelligence)
        #expect(!session.isDemoReadOnly)
        #expect(session.permittedStations.count == 2)
    }

    @Test func evidenceLinksStayOnConfiguredFuelNerveHost() throws {
        let environment = try localEnvironment()
        let expectedPaths = ["/dashboard", "/operations", "/reconciliation", "/inventory", "/sales", "/reports", "/customers", "/purchases", "/notifications"]
        for path in expectedPaths {
            #expect(environment.evidenceURL(for: path)?.absoluteString == "http://127.0.0.1:5173\(path)")
        }
        #expect(environment.evidenceURL(for: "https://attacker.example/inventory") == nil)
        #expect(environment.evidenceURL(for: "//attacker.example/inventory") == nil)
        #expect(environment.evidenceURL(for: "/unknown-record") == nil)
        #expect(environment.evidenceURL(for: "/inventory?token=secret") == nil)
        #expect(environment.evidenceURL(for: "/inventory#session") == nil)
        #expect(environment.evidenceURL(for: "/inventory/../reports") == nil)
        #expect(environment.evidenceURL(for: "/inventory%2Freports") == nil)
    }

    @Test func dailyBriefingContractDecodesBackendDatesAndFacts() throws {
        let data = Data(#"{"date":"2026-09-08","calculatedAt":"2026-09-08T10:30:15.123Z","facts":[{"id":"open-shifts","category":"SHIFT","severity":"ATTENTION","label":"Open shifts","value":"1","context":"One shift remains open.","evidenceLabel":"Open shift records","evidencePath":"/operations"}],"narrative":{"headline":"One item deserves attention","summary":"Review the open shift.","items":[{"factId":"open-shifts","explanation":"The shift is still open.","action":"Review the handover."}]},"narrativeMode":"DETERMINISTIC","model":null}"#.utf8)
        let briefing = try JSONDecoder.fuelNerve.decode(DailyBriefing.self, from: data)
        #expect(briefing.facts.first?.id == "open-shifts")
        #expect(briefing.narrative.items.first?.factId == "open-shifts")
    }

    @Test func dashboardContractDecodesAuthoritativeTotalsAndStation() throws {
        let data = Data(#"{"asOf":"2026-09-08T10:30:15.123Z","today":{"grossSales":387633,"transactions":148,"meteredVolume":4010,"netProfit":28740},"collections":[{"method":"CASH","amount":174400}],"operations":{"openShifts":1,"pendingReconciliations":3},"actions":[],"stationHealth":[{"id":"station-c","name":"Station C","code":"C","openShifts":1,"status":"RUNNING"}],"tankStocks":[{"id":"tank-1","code":"T-1","productCode":"MS","bookStock":6240,"workingCapacity":19000,"fillPercent":32.8,"status":"HEALTHY","station":{"id":"station-c"}}]}"#.utf8)
        let dashboard = try JSONDecoder.fuelNerve.decode(DashboardResponse.self, from: data)
        #expect(dashboard.today.grossSales == 387633)
        #expect(dashboard.operations.pendingReconciliations == 3)
        #expect(dashboard.stationHealth.first?.name == "Station C")
        #expect(dashboard.tankStocks.first?.bookStock == 6240)
    }

    @Test func readOnlyNetworkBoundaryRejectsInventoryExecution() async throws {
        struct Body: Encodable, Sendable { let decision = "APPROVE" }
        struct Response: Decodable, Sendable { let id: String }
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:4000/api")!)

        await #expect(throws: APIError.self) {
            try await client.send("inventory/adjustments", body: Body(), as: Response.self)
        }
    }

    private func localEnvironment() throws -> AppEnvironment {
        try AppEnvironment(infoDictionary: [
            "FuelNerveEnvironment": "local",
            "FuelNerveAPIBaseURL": "http://127.0.0.1:4000/api",
            "FuelNerveWebBaseURL": "http://127.0.0.1:5173",
            "FuelNerveUsePreviewData": "NO",
        ])
    }

    private func user(mustChangePassword: Bool = false) -> AuthenticatedUser {
        AuthenticatedUser(
            id: "owner-1", email: "owner@example.com", name: "Owner", role: .owner,
            organization: .init(id: "organization-1", name: "Fuel Station"), allStations: true,
            stations: [], isPlatformAdmin: false, mustChangePassword: mustChangePassword, demoExpiresAt: nil
        )
    }
}

private actor AuthenticationServiceStub: AuthenticationService {
    let user: AuthenticatedUser
    let restoreError: Error?
    private(set) var logoutCount = 0

    init(user: AuthenticatedUser, restoreError: Error? = nil) {
        self.user = user
        self.restoreError = restoreError
    }

    func restoreSession() async throws -> AuthenticatedUser {
        if let restoreError { throw restoreError }
        return user
    }

    func login(email: String, password: String) async throws -> AuthenticatedUser { user }
    func loginWithGoogle(credential: String) async throws -> AuthenticatedUser { user }
    func changePassword(_ password: String) async throws -> AuthenticatedUser { user }
    func logout() async { logoutCount += 1 }
}

private struct ApplicationScopeServiceStub: ApplicationScopeService {
    func load() async throws -> ApplicationScope {
        ApplicationScope(
            allStations: true,
            stations: [
                .init(id: "station-c", name: "Station C", code: "C", city: "Kochi", state: "Kerala"),
                .init(id: "station-d", name: "Station D", code: "D", city: "Kochi", state: "Kerala"),
            ],
            intelligence: .init(enabledAt: .now, expiresAt: nil),
            capabilities: .disabled
        )
    }
}
