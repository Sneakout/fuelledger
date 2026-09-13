import Foundation
import Observation

@MainActor
@Observable
final class AppSession {
    enum State { case restoring, offline, signedOut, passwordChangeRequired, signedIn }

    var state: State
    private(set) var user: AuthenticatedUser?
    private(set) var applicationScope: ApplicationScope?
    private(set) var selectedStationId: String?
    var scopeMessage: String?
    let environment: AppEnvironment
    let authenticationService: any AuthenticationService
    let applicationScopeService: any ApplicationScopeService
    let ownerService: any OwnerService
    let alertService: any AlertService
    let briefingService: any BriefingService
    let askService: any AskService
    let approvalService: any ApprovalService
    let invoiceImportService: any InvoiceImportService

    init(environment: AppEnvironment, authenticationService: (any AuthenticationService)? = nil, applicationScopeService: (any ApplicationScopeService)? = nil) {
        self.environment = environment
        self.state = .restoring
        let client = APIClient(baseURL: environment.apiBaseURL)
        self.authenticationService = authenticationService ?? (environment.usesPreviewData
            ? PreviewAuthenticationService()
            : LiveAuthenticationService(client: client))
        self.applicationScopeService = applicationScopeService ?? (environment.usesPreviewData
            ? PreviewApplicationScopeService()
            : LiveApplicationScopeService(client: client))
        self.ownerService = environment.usesPreviewData
            ? PreviewOwnerService()
            : LiveOwnerService(client: client)
        self.alertService = environment.usesPreviewData
            ? PreviewAlertService()
            : LiveAlertService(client: client)
        self.briefingService = environment.usesPreviewData
            ? PreviewBriefingService()
            : LiveBriefingService(client: client)
        self.askService = environment.usesPreviewData
            ? PreviewAskService()
            : LiveAskService(client: client)
        self.approvalService = environment.usesPreviewData
            ? PreviewApprovalService()
            : LiveApprovalService(client: client)
        self.invoiceImportService = environment.usesPreviewData
            ? PreviewInvoiceImportService()
            : LiveInvoiceImportService(client: client)
    }

    func restoreSession() async {
        do { try await apply(authenticationService.restoreSession()) }
        catch {
            if case APIError.unauthenticated = error {
                await authenticationService.logout()
                clearSession()
            } else {
                enterOfflineState()
            }
        }
    }

    func retrySession() async {
        state = .restoring
        await restoreSession()
    }

    func login(email: String, password: String) async throws {
        try await apply(authenticationService.login(email: email, password: password))
    }

    func loginWithGoogle(credential: String) async throws {
        try await apply(authenticationService.loginWithGoogle(credential: credential))
    }

    func changePassword(_ password: String) async throws {
        try await apply(authenticationService.changePassword(password))
    }

    func logout() async {
        await authenticationService.logout()
        clearSession()
    }

    func handleAuthenticationFailure(_ error: Error) {
        if case APIError.unauthenticated = error { clearSession() }
    }

    func authenticationDidExpire() { clearSession() }

    var organization: AuthenticatedUser.Organization? { user?.organization }
    var role: AuthenticatedUser.Role? { user?.role }
    var isDemoReadOnly: Bool { user?.demoExpiresAt != nil }
    var hasIntelligence: Bool { applicationScope?.intelligence.isActive() == true }
    var capabilities: ApplicationScope.Capabilities { applicationScope?.capabilities ?? .disabled }
    var permittedStations: [ApplicationScope.Station] { applicationScope?.stations ?? [] }
    var selectedStation: ApplicationScope.Station? { permittedStations.first { $0.id == selectedStationId } }

    func selectStation(_ stationId: String) {
        guard permittedStations.contains(where: { $0.id == stationId }) else {
            rejectCurrentScope()
            return
        }
        selectedStationId = stationId
        scopeMessage = nil
    }

    func rejectCurrentScope() {
        selectedStationId = permittedStations.first?.id
        scopeMessage = "That fuel station is no longer available to this account. FuelNerve returned to an authorized station."
    }

    private func apply(_ user: AuthenticatedUser) async throws {
        self.user = user
        guard !user.requiresPasswordChange else {
            applicationScope = nil
            selectedStationId = nil
            state = .passwordChangeRequired
            return
        }
        let scope = try await applicationScopeService.load()
        applicationScope = scope
        selectedStationId = scope.stations.first?.id
        scopeMessage = nil
        state = .signedIn
    }

    private func clearSession() {
        user = nil
        applicationScope = nil
        selectedStationId = nil
        scopeMessage = nil
        state = .signedOut
    }

    private func enterOfflineState() {
        // Do not clear cookies here. The backend has not rejected the session;
        // it is temporarily unavailable and must revalidate it on retry.
        user = nil
        applicationScope = nil
        selectedStationId = nil
        scopeMessage = nil
        state = .offline
    }
}
