import Foundation
import GoogleSignIn

struct AuthenticatedUser: Decodable, Identifiable, Sendable {
    enum Role: String, Decodable, Sendable { case owner = "OWNER", manager = "MANAGER", accountant = "ACCOUNTANT", staff = "STAFF" }
    struct Organization: Decodable, Sendable { let id: String; let name: String }
    struct Station: Decodable, Identifiable, Sendable { let id: String; let name: String; let code: String }

    let id: String
    let email: String
    let name: String
    let role: Role
    let organization: Organization
    let allStations: Bool
    let stations: [Station]
    let isPlatformAdmin: Bool?
    let mustChangePassword: Bool?
    let demoExpiresAt: Date?

    var requiresPasswordChange: Bool { mustChangePassword == true }
}

protocol AuthenticationService: Sendable {
    func restoreSession() async throws -> AuthenticatedUser
    func login(email: String, password: String) async throws -> AuthenticatedUser
    func loginWithGoogle(credential: String) async throws -> AuthenticatedUser
    func changePassword(_ password: String) async throws -> AuthenticatedUser
    func logout() async
}

struct LiveAuthenticationService: AuthenticationService {
    private struct UserResponse: Decodable, Sendable { let user: AuthenticatedUser }
    private struct LoginBody: Encodable, Sendable { let email: String; let password: String }
    private struct PasswordBody: Encodable, Sendable { let password: String }
    private struct GoogleBody: Encodable, Sendable { let credential: String }
    private struct EmptyBody: Encodable, Sendable { }
    private struct PasswordResponse: Decodable, Sendable { let ok: Bool }

    let client: APIClient

    func restoreSession() async throws -> AuthenticatedUser {
        try await client.get("auth/me", as: UserResponse.self).user
    }

    func login(email: String, password: String) async throws -> AuthenticatedUser {
        try await client.send("auth/login", body: LoginBody(email: email, password: password), as: UserResponse.self).user
    }

    func loginWithGoogle(credential: String) async throws -> AuthenticatedUser {
        try await client.send("auth/google", body: GoogleBody(credential: credential), as: UserResponse.self).user
    }

    func changePassword(_ password: String) async throws -> AuthenticatedUser {
        let response = try await client.send("auth/change-password", body: PasswordBody(password: password), as: PasswordResponse.self)
        guard response.ok else { throw APIError.invalidResponse }
        return try await restoreSession()
    }

    func logout() async {
        GIDSignIn.sharedInstance.signOut()
        try? await client.sendWithoutResponse("auth/logout", body: EmptyBody())
        await client.clearSessionCookies()
    }
}

struct PreviewAuthenticationService: AuthenticationService {
    private let user = AuthenticatedUser(
        id: "preview-owner", email: "owner@example.com", name: "Preview Owner", role: .owner,
        organization: .init(id: "preview-organization", name: "Preview FuelNerve"), allStations: true,
        stations: [], isPlatformAdmin: false, mustChangePassword: false, demoExpiresAt: nil
    )
    func restoreSession() async throws -> AuthenticatedUser { user }
    func login(email: String, password: String) async throws -> AuthenticatedUser { user }
    func loginWithGoogle(credential: String) async throws -> AuthenticatedUser { user }
    func changePassword(_ password: String) async throws -> AuthenticatedUser { user }
    func logout() async { }
}
