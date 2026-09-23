import Foundation
import Testing
@testable import FuelNerve

@Suite(.serialized)
struct ContractSecurityTests {
    @Test func localKeychainCanPersistAndRestoreSessionData() throws {
        let store = KeychainStore()
        let account = "local-session-test-\(UUID().uuidString)"
        let expected = Data("opaque-session".utf8)
        defer { try? store.remove(account: account) }

        try store.save(token: expected, account: account)

        #expect(try KeychainStore().token(account: account) == expected)
    }

    @Test func sanitizedContractsDecodeAndIgnoreUnknownFields() throws {
        struct UserEnvelope: Decodable { let user: AuthenticatedUser }
        let user = try JSONDecoder.fuelNerve.decode(UserEnvelope.self, from: fixture("auth-me")).user
        let dashboard = try JSONDecoder.fuelNerve.decode(DashboardResponse.self, from: fixture("dashboard"))
        let briefing = try JSONDecoder.fuelNerve.decode(DailyBriefing.self, from: fixture("daily-briefing"))
        let capabilities = try JSONDecoder.fuelNerve.decode(ApplicationScope.Capabilities.self, from: fixture("capabilities-read-only"))

        #expect(user.organization.id == "sanitized-org-1")
        #expect(user.mustChangePassword == false)
        #expect(dashboard.today.grossSales == 387633)
        #expect(dashboard.stationHealth.first?.id == "station-c")
        #expect(briefing.facts.first?.evidencePath == "/operations")
        #expect(capabilities.readOnly && !capabilities.execution)
    }

    @Test func productionLoginCookieIsCapturedReusedAndRemovedOnLogout() async throws {
        let harness = NetworkHarness()
        let client = harness.client()
        let service = LiveAuthenticationService(client: client)
        nonisolated(unsafe) var restoredCookie: String?
        nonisolated(unsafe) var requestNumber = 0
        let lock = NSLock()
        MockURLProtocol.handler = { request in
            lock.lock(); defer { lock.unlock() }
            requestNumber += 1
            if requestNumber == 1 {
                #expect(request.value(forHTTPHeaderField: "X-FuelNerve-Client") == "ios")
                return .response(status: 200, headers: ["Set-Cookie": "__Host-fuelledger_session=opaque-test-session; Path=/; Secure; HttpOnly; SameSite=Strict"], data: fixture("auth-me"))
            }
            if requestNumber == 2 {
                restoredCookie = request.value(forHTTPHeaderField: "Cookie")
                return .response(status: 200, data: fixture("auth-me"))
            }
            return .response(status: 204, headers: ["Set-Cookie": "__Host-fuelledger_session=; Path=/; Max-Age=0; Secure; HttpOnly"], data: Data())
        }

        _ = try await service.login(email: "owner@example.invalid", password: "Sanitized1")
        _ = try await service.restoreSession()
        #expect(restoredCookie?.contains("__Host-fuelledger_session=opaque-test-session") == true)
        await service.logout()
        #expect(harness.cookies.cookies?.isEmpty != false)
    }

    @Test(arguments: ["SESSION_REVOKED", "DEMO_EXPIRED"])
    func expiredAndRevokedSessionsFailAsUnauthenticated(code: String) async throws {
        let harness = NetworkHarness()
        MockURLProtocol.handler = { _ in .response(status: 401, data: errorBody(code: code)) }
        let service = LiveAuthenticationService(client: harness.client())
        await #expect(throws: APIError.self) { try await service.restoreSession() }
    }

    @Test func coreAndIntelligenceEntitlementsComeFromServerContracts() async throws {
        for (fixtureName, expected) in [("subscription-core", false), ("subscription-intelligence", true)] {
            let harness = NetworkHarness()
            MockURLProtocol.handler = { request in
                switch request.url?.path {
                case "/api/access/context": return .response(status: 200, data: fixture("station-context"))
                case "/api/platform/subscription": return .response(status: 200, data: fixture(fixtureName))
                case "/api/platform/capabilities": return .response(status: 200, data: fixture("capabilities-read-only"))
                default: return .response(status: 404, data: errorBody(code: "NOT_FOUND"))
                }
            }
            let scope = try await LiveApplicationScopeService(client: harness.client()).load()
            #expect(scope.intelligence.isActive(at: Date(timeIntervalSince1970: 1_800_000_000)) == expected)
            #expect(scope.stations.map(\.id) == ["station-c"])
        }
    }

    @Test func selectedStationPropagatesToEveryReadOnlyService() async throws {
        let harness = NetworkHarness()
        nonisolated(unsafe) var requests: [URLRequest] = []
        nonisolated(unsafe) var askBody: Data?
        let lock = NSLock()
        MockURLProtocol.handler = { request in
            lock.lock()
            requests.append(request)
            if request.url?.path == "/api/intelligence/ask" { askBody = bodyData(from: request) }
            lock.unlock()
            switch request.url?.path {
            case "/api/dashboard/bootstrap": return .response(status: 200, data: fixture("dashboard"))
            case "/api/intelligence/daily-briefing": return .response(status: 200, data: fixture("daily-briefing"))
            case "/api/notifications/alerts": return .response(status: 200, data: Data(#"{"alerts":[]}"#.utf8))
            case "/api/intelligence/ask": return .response(status: 200, data: askResponse())
            default: return .response(status: 404, data: errorBody(code: "NOT_FOUND"))
            }
        }
        let client = harness.client()
        _ = try await LiveOwnerService(client: client).snapshot(stationId: "station-c")
        _ = try await LiveBriefingService(client: client).daily(stationId: "station-c")
        _ = try await LiveAlertService(client: client).alerts(stationId: "station-c")
        _ = try await LiveAskService(client: client).ask("What is today's profit?", stationId: "station-c", requestId: UUID(), asOf: nil)

        let stationQueries = requests.prefix(3).compactMap { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "stationId" })?.value }
        #expect(stationQueries == ["station-c", "station-c", "station-c"])
        let askStation = try #require(askBody)
        #expect(String(decoding: askStation, as: UTF8.self).contains(#""stationId":"station-c""#))
    }

    @Test(arguments: [(403, "STATION_ACCESS_DENIED"), (403, "ORGANIZATION_ACCESS_DENIED")])
    func accessDenialsFailClosed(status: Int, code: String) async throws {
        let harness = NetworkHarness()
        MockURLProtocol.handler = { _ in .response(status: status, data: errorBody(code: code)) }
        do {
            let _: DashboardResponse = try await harness.client().get("dashboard/bootstrap", query: [URLQueryItem(name: "stationId", value: "foreign-station")], as: DashboardResponse.self)
            Issue.record("A denied scope unexpectedly returned data.")
        } catch APIError.server(let receivedStatus, let receivedCode, _) {
            #expect(receivedStatus == 403)
            #expect(receivedCode == code)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test(arguments: [URLError.Code.notConnectedToInternet, .timedOut])
    func offlineAndTimeoutErrorsNeverReturnPreviewData(code: URLError.Code) async throws {
        let harness = NetworkHarness()
        MockURLProtocol.handler = { _ in .failure(URLError(code)) }
        do {
            _ = try await LiveOwnerService(client: harness.client()).snapshot(stationId: "station-c")
            Issue.record("Live service unexpectedly substituted data.")
        } catch let error as URLError {
            #expect(error.code == code)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test func serverSecretsAreNotReflectedByClientErrors() async throws {
        let harness = NetworkHarness()
        let secret = "sensitive-session-value"
        let responseData = try JSONSerialization.data(withJSONObject: ["error": ["code": "INTERNAL_ERROR", "message": "failed", "token": secret]])
        MockURLProtocol.handler = { _ in .response(status: 500, data: responseData) }
        do {
            let _: DashboardResponse = try await harness.client().get("dashboard/bootstrap", as: DashboardResponse.self)
        } catch {
            #expect(!String(describing: error).contains(secret))
        }
    }

    @Test func priceApprovalSendsTheOwnerConfirmedSellingPriceAndDate() async throws {
        let harness = NetworkHarness()
        nonisolated(unsafe) var capturedBody: Data?
        MockURLProtocol.handler = { request in
            capturedBody = bodyData(from: request)
            return .response(status: 200, data: priceApprovalResponse())
        }
        let effectiveDate = try #require(ISO8601DateFormatter().date(from: "2026-09-13T00:00:00Z"))

        let approval = try await LiveApprovalService(client: harness.client()).decide(
            id: "approval-price", approve: true, note: "Owner confirmed", version: 1,
            sellingPrice: 99.25, sellingPriceEffectiveFrom: effectiveDate
        )

        let body = try #require(capturedBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["decision"] as? String == "APPROVE")
        #expect(json["sellingPrice"] as? Double == 99.25)
        #expect((json["sellingPriceEffectiveFrom"] as? String)?.hasPrefix("2026-09-13T00:00:00") == true)
        #expect(approval.isPriceChange)
    }
}

private final class FixtureBundleToken { }

private func fixture(_ name: String) -> Data {
    let bundle = Bundle(for: FixtureBundleToken.self)
    guard let url = bundle.url(forResource: name, withExtension: "json"), let data = try? Data(contentsOf: url) else {
        fatalError("Missing sanitized fixture \(name).json")
    }
    return data
}

private func errorBody(code: String) -> Data {
    try! JSONSerialization.data(withJSONObject: ["error": ["code": code, "message": "Request denied."]])
}

private func askResponse() -> Data {
    Data(#"{"id":"answer-1","intent":"PROFIT","answer":{"title":"Profit","explanation":"Posted result.","action":"Review the report.","facts":[]},"answerMode":"DETERMINISTIC","usage":{"used":1,"limit":25,"remaining":24}}"#.utf8)
}

private func priceApprovalResponse() -> Data {
    Data(#"{"approval":{"id":"approval-price","actionType":"PRODUCT_PRICE_CHANGE","status":"APPROVED","reason":"HSD purchase price changed.","payload":{"stationId":"station-c","productId":"hsd","invoiceId":"invoice-1","invoiceNumber":"INV-1","proposedPurchasePrice":82.5,"suggestedSellingPrice":98.5,"purchaseEffectiveFrom":"2026-09-13T00:00:00.000Z"},"evidence":{"product":{"id":"hsd","name":"High Speed Diesel","code":"HSD","unit":"LITRE"},"invoice":{"id":"invoice-1","invoiceNumber":"INV-1","totalAmount":990000,"quantity":12000,"sourceUnit":"KL"},"currentPurchasePrice":80,"proposedPurchasePrice":82.5,"currentSellingPrice":96,"suggestedSellingPrice":98.5,"purchaseEffectiveFrom":"2026-09-13T00:00:00.000Z","checkedAt":"2026-09-13T01:00:00.000Z","evidencePath":"/purchases?invoiceId=invoice-1"},"requestedAt":"2026-09-13T01:00:00.000Z","requestedBy":{"id":"manager","name":"Manager","role":"MANAGER"},"station":{"id":"station-c","name":"Station C","code":"C"},"decidedAt":"2026-09-13T02:00:00.000Z","decidedBy":{"id":"owner","name":"Owner","role":"OWNER"},"decisionNote":"Owner confirmed","execution":{"type":"PRODUCT_PRICE_CHANGE","id":"hsd","executedAt":"2026-09-13T02:00:00.000Z"},"version":2}}"#.utf8)
}

private func bodyData(from request: URLRequest) -> Data? {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 1_024)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count < 0 { return nil }
        if count == 0 { break }
        data.append(buffer, count: count)
    }
    return data
}

private struct NetworkHarness {
    let cookies: HTTPCookieStorage
    private let session: URLSession

    init() {
        let identifier = "tech.mindvector.fuelnerve.tests.\(UUID().uuidString)"
        cookies = .sharedCookieStorage(forGroupContainerIdentifier: identifier)
        cookies.cookies?.forEach(cookies.deleteCookie)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        configuration.httpCookieStorage = cookies
        configuration.httpShouldSetCookies = true
        session = URLSession(configuration: configuration)
    }

    func client() -> APIClient {
        APIClient(baseURL: URL(string: "https://fuelnerve.example/api")!, session: session, cookieStorage: cookies)
    }
}

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    enum Result {
        case response(status: Int, headers: [String: String] = [:], data: Data)
        case failure(Error)
    }
    nonisolated(unsafe) static var handler: ((URLRequest) -> Result)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let result = Self.handler?(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        switch result {
        case .response(let status, let headers, let data):
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if !data.isEmpty { client?.urlProtocol(self, didLoad: data) }
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let error):
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() { }
}
