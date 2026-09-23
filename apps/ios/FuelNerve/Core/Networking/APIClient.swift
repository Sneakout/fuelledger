import Foundation
import OSLog
import Security

enum APIError: Error {
    case invalidResponse
    case unauthenticated
    case actionDisabled
    case server(status: Int, code: String?, message: String?)
}

private struct APIErrorEnvelope: Decodable {
    struct Payload: Decodable { let code: String?; let message: String? }
    let error: Payload
}

actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let cookieStorage: HTTPCookieStorage
    private let persistsSessionCookie: Bool

    init(baseURL: URL, session: URLSession? = nil, cookieStorage: HTTPCookieStorage? = nil) {
        self.baseURL = baseURL
        // The app sandbox already isolates the shared cookie store from other apps.
        // A group-container cookie store is only persistent when a matching App Group
        // entitlement exists; without it, a real process restart loses the session.
        let storage = cookieStorage ?? .shared
        self.cookieStorage = storage
        self.persistsSessionCookie = cookieStorage == nil
        if cookieStorage == nil { SessionCookieVault.restore(into: storage, for: baseURL) }
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.httpCookieStorage = storage
            configuration.httpShouldSetCookies = true
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.timeoutIntervalForRequest = 20
            configuration.timeoutIntervalForResource = 45
            configuration.urlCache = nil
            self.session = URLSession(configuration: configuration)
        }
    }

    func get<Response: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = [], as type: Response.Type) async throws -> Response {
        guard var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false) else { throw APIError.invalidResponse }
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("ios", forHTTPHeaderField: "X-FuelNerve-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        applySessionCookies(to: &request, for: url)
        let (data, response) = try await session.data(for: request)
        captureSessionCookies(from: response)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveUnauthenticated, object: nil) }
            throw APIError.unauthenticated
        }
        let serverError = decodeServerError(data)
        if http.statusCode == 403, serverError?.code == "STATION_ACCESS_DENIED" {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveScopeRejected, object: nil) }
        }
        guard 200..<300 ~= http.statusCode else { throw APIError.server(status: http.statusCode, code: serverError?.code, message: serverError?.message) }
        return try JSONDecoder.fuelNerve.decode(Response.self, from: data)
    }

    func send<Response: Decodable & Sendable, Body: Encodable & Sendable>(_ path: String, method: String = "POST", body: Body, idempotencyKey: String = UUID().uuidString, as type: Response.Type) async throws -> Response {
        guard Self.allowedMutation(path) else { throw APIError.actionDisabled }
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("ios", forHTTPHeaderField: "X-FuelNerve-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(body)
        applySessionCookies(to: &request, for: url)
        let (data, response) = try await session.data(for: request)
        captureSessionCookies(from: response)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveUnauthenticated, object: nil) }
            throw APIError.unauthenticated
        }
        let serverError = decodeServerError(data)
        if http.statusCode == 403, serverError?.code == "STATION_ACCESS_DENIED" {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveScopeRejected, object: nil) }
        }
        guard 200..<300 ~= http.statusCode else { throw APIError.server(status: http.statusCode, code: serverError?.code, message: serverError?.message) }
        return try JSONDecoder.fuelNerve.decode(Response.self, from: data)
    }

    func sendWithoutResponse<Body: Encodable & Sendable>(_ path: String, method: String = "POST", body: Body) async throws {
        guard Self.allowedMutation(path) else { throw APIError.actionDisabled }
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("ios", forHTTPHeaderField: "X-FuelNerve-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(body)
        applySessionCookies(to: &request, for: url)
        let (data, response) = try await session.data(for: request)
        captureSessionCookies(from: response)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveUnauthenticated, object: nil) }
            throw APIError.unauthenticated
        }
        let serverError = decodeServerError(data)
        if http.statusCode == 403, serverError?.code == "STATION_ACCESS_DENIED" {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveScopeRejected, object: nil) }
        }
        guard 200..<300 ~= http.statusCode else { throw APIError.server(status: http.statusCode, code: serverError?.code, message: serverError?.message) }
    }

    func clearSessionCookies() {
        guard let host = baseURL.host else { return }
        for cookie in cookieStorage.cookies ?? [] where cookie.domain == host || cookie.domain == ".\(host)" {
            cookieStorage.deleteCookie(cookie)
        }
        if persistsSessionCookie { SessionCookieVault.clear(for: baseURL) }
        session.reset { }
    }

    private func captureSessionCookies(from response: URLResponse) {
        if let http = response as? HTTPURLResponse, let url = http.url {
            let headers = http.allHeaderFields.reduce(into: [String: String]()) { result, entry in
                guard let key = entry.key as? String, let value = entry.value as? String else { return }
                result[key] = value
            }
            for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: url) {
                cookieStorage.setCookie(cookie)
            }
        }
        if persistsSessionCookie { SessionCookieVault.store(cookieStorage.cookies(for: baseURL) ?? [], for: baseURL) }
    }

    private func applySessionCookies(to request: inout URLRequest, for url: URL) {
        let cookies = cookieStorage.cookies(for: url) ?? []
        guard !cookies.isEmpty else { return }
        for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) {
            request.setValue(value, forHTTPHeaderField: field)
        }
    }

    private func decodeServerError(_ data: Data) -> APIErrorEnvelope.Payload? {
        try? JSONDecoder().decode(APIErrorEnvelope.self, from: data).error
    }

    private static let allowedReadOnlyWrites: Set<String> = [
        "auth/login", "auth/google", "auth/change-password", "auth/logout", "intelligence/ask",
        "notifications/devices", "purchases/invoices", "purchases/suppliers",
    ]

    private static func allowedMutation(_ path: String) -> Bool {
        if allowedReadOnlyWrites.contains(path) { return true }
        let parts = path.split(separator: "/")
        return parts.count == 3 && parts[0] == "approvals" && parts[2] == "decision"
    }
}

private enum SessionCookieVault {
    private static let service = "tech.mindvector.fuelnerve.session-cookie"
    private static let legacyAccount = "fuelnerve-api"
    private static let logger = Logger(subsystem: "tech.mindvector.fuelnerve", category: "session")

    private struct StoredCookie: Codable {
        let name: String
        let value: String
        let domain: String
        let path: String
        let expiresAt: Date?
        let secure: Bool
    }

    static func store(_ cookies: [HTTPCookie], for baseURL: URL) {
        guard let cookie = cookies.first(where: { $0.name == "__Host-fuelledger_session" })
                ?? cookies.first(where: { $0.name == "fuelledger_session" }) else {
            clear(for: baseURL)
            return
        }
        let stored = StoredCookie(
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expiresAt: cookie.expiresDate,
            secure: cookie.isSecure
        )
        guard let data = try? JSONEncoder().encode(stored) else {
            logger.error("Could not encode the saved session.")
            return
        }
        let account = account(for: baseURL)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let match: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ]
            let update: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            let updateStatus = SecItemUpdate(match as CFDictionary, update as CFDictionary)
            if updateStatus != errSecSuccess { logger.error("Could not update the saved session. Keychain status: \(updateStatus, privacy: .public)") }
        } else if status != errSecSuccess {
            logger.error("Could not save the session. Keychain status: \(status, privacy: .public)")
        }
    }

    static func restore(into storage: HTTPCookieStorage, for baseURL: URL) {
        let scopedAccount = account(for: baseURL)
        let scoped = savedData(account: scopedAccount)
        let sourceAccount: String
        let data: Data
        if let scoped {
            sourceAccount = scopedAccount
            data = scoped
        } else if let legacy = savedData(account: legacyAccount) {
            sourceAccount = legacyAccount
            data = legacy
        } else {
            return
        }
        guard
              let saved = try? JSONDecoder().decode(StoredCookie.self, from: data),
              let host = baseURL.host,
              saved.domain == host || saved.domain == ".\(host)" else {
            if sourceAccount == scopedAccount { remove(account: sourceAccount) }
            return
        }
        guard saved.expiresAt.map({ $0 > .now }) != false else {
            remove(account: sourceAccount)
            return
        }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: saved.name,
            .value: saved.value,
            .domain: saved.domain,
            .path: saved.path,
            .secure: saved.secure ? "TRUE" : "FALSE",
        ]
        if let expiresAt = saved.expiresAt { properties[.expires] = expiresAt }
        guard let cookie = HTTPCookie(properties: properties) else {
            logger.error("Could not rebuild the saved session cookie.")
            remove(account: sourceAccount)
            return
        }
        storage.setCookie(cookie)
        if sourceAccount == legacyAccount {
            store([cookie], for: baseURL)
            remove(account: legacyAccount)
        }
    }

    static func clear(for baseURL: URL) {
        remove(account: account(for: baseURL))
        remove(account: legacyAccount)
    }

    private static func account(for baseURL: URL) -> String {
        let scheme = baseURL.scheme?.lowercased() ?? "unknown"
        let host = baseURL.host?.lowercased() ?? "unknown"
        let port = baseURL.port.map { ":\($0)" } ?? ""
        return "fuelnerve-api|\(scheme)://\(host)\(port)"
    }

    private static func savedData(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status != errSecSuccess && status != errSecItemNotFound {
            logger.error("Could not read the saved session. Keychain status: \(status, privacy: .public)")
        }
        return status == errSecSuccess ? result as? Data : nil
    }

    private static func remove(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            logger.error("Could not remove the saved session. Keychain status: \(status, privacy: .public)")
        }
    }
}

extension Notification.Name {
    static let fuelNerveUnauthenticated = Notification.Name("tech.mindvector.fuelnerve.unauthenticated")
    static let fuelNerveScopeRejected = Notification.Name("tech.mindvector.fuelnerve.scope-rejected")
}

extension JSONDecoder {
    static var fuelNerve: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let standard = ISO8601DateFormatter()
            guard let date = standard.date(from: value) else {
                throw DecodingError.dataCorruptedError(in: try decoder.singleValueContainer(), debugDescription: "Expected an ISO 8601 date.")
            }
            return date
        }
        return decoder
    }
}
