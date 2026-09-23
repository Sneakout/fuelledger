import SwiftUI

struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Group {
            switch session.state {
            case .restoring:
                ZStack { FuelNerveTheme.forest.ignoresSafeArea(); ProgressView("Restoring your secure session…").tint(.white).foregroundStyle(.white) }
            case .offline: OfflineSessionView()
            case .signedOut: SignInView()
            case .passwordChangeRequired: ChangePasswordView()
            case .signedIn: OwnerTabView()
            }
        }
        .task {
            if session.state == .restoring { await session.restoreSession() }
            guard session.state == .signedIn, !session.isDemoReadOnly, session.capabilities.pushRegistration else { return }
            await requestPushNotifications()
            if let token = UserDefaults.standard.string(forKey: "fuelNervePushToken") {
                try? await session.alertService.registerDevice(token: token)
            }
            for await notification in NotificationCenter.default.notifications(named: .fuelNervePushToken) {
                guard let token = notification.object as? String else { continue }
                try? await session.alertService.registerDevice(token: token)
            }
        }
        .task {
            for await _ in NotificationCenter.default.notifications(named: .fuelNerveUnauthenticated) {
                session.authenticationDidExpire()
            }
        }
        .task {
            for await _ in NotificationCenter.default.notifications(named: .fuelNerveScopeRejected) {
                guard session.state == .signedIn else { continue }
                session.rejectCurrentScope()
            }
        }
        .alert("Fuel station access changed", isPresented: Binding(
            get: { session.scopeMessage != nil },
            set: { if !$0 { session.scopeMessage = nil } }
        )) {
            Button("OK") { session.scopeMessage = nil }
        } message: {
            Text(session.scopeMessage ?? "")
        }
    }
}

private struct OfflineSessionView: View {
    @Environment(AppSession.self) private var session
    @State private var retrying = false

    var body: some View {
        ZStack {
            FuelNerveTheme.forest.ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(FuelNerveTheme.forest)
                    .frame(width: 76, height: 76)
                    .background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 24))

                VStack(spacing: 9) {
                    Text("FuelNerve is offline")
                        .font(.largeTitle.bold())
                        .foregroundStyle(FuelNerveTheme.forest)
                    Text("Your session has not been signed out. Reconnect to the server and try again.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Button {
                    retrying = true
                    Task {
                        await session.retrySession()
                        retrying = false
                    }
                } label: {
                    HStack {
                        if retrying { ProgressView().tint(.white) }
                        Text(retrying ? "Reconnecting…" : "Try again")
                    }
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(FuelNerveTheme.forest, in: RoundedRectangle(cornerRadius: 17))
                }
                .disabled(retrying)

                Button("Sign out") { Task { await session.logout() } }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .disabled(retrying)
            }
            .padding(28)
            .background(.white, in: RoundedRectangle(cornerRadius: 30))
            .padding(24)
        }
    }
}

private struct OwnerTabView: View {
    @Environment(AppSession.self) private var session
    @State private var selectedTab = OwnerTab.today
    @State private var popupCoordinator = OwnerPopupCoordinator()
    @State private var decisionMessage: String?

    private enum OwnerTab: Hashable { case today, briefing, alerts, ask, settings }

    var body: some View {
        TabView(selection: $selectedTab) {
            TodayView().tabItem { Label("Today", systemImage: "gauge.with.dots.needle.50percent") }.tag(OwnerTab.today)
            BriefingView().tabItem { Label("Briefing", systemImage: "sparkles") }.tag(OwnerTab.briefing)
            AlertsView().tabItem { Label("Alerts", systemImage: "bell.badge") }.tag(OwnerTab.alerts)
            AskView().tabItem { Label("Ask", systemImage: "bubble.left.and.text.bubble.right") }.tag(OwnerTab.ask)
            NavigationStack { SettingsView() }.tabItem { Label("Settings", systemImage: "gearshape") }.tag(OwnerTab.settings)
        }
        .tint(FuelNerveTheme.green)
        .task(id: session.selectedStationId) { await popupCoordinator.refresh(using: session) }
        .fullScreenCover(item: Binding(
            get: { popupCoordinator.active },
            set: { if $0 == nil { popupCoordinator.deferActive() } }
        )) { popup in
            popupView(popup)
        }
        .alert("Decision not saved", isPresented: Binding(
            get: { decisionMessage != nil },
            set: { if !$0 { decisionMessage = nil } }
        )) { Button("OK") { decisionMessage = nil } } message: { Text(decisionMessage ?? "") }
        .task {
            if UserDefaults.standard.string(forKey: PushNavigation.pendingApprovalKey) != nil {
                selectedTab = .alerts
            }
            for await _ in NotificationCenter.default.notifications(named: .fuelNerveOpenApproval) {
                selectedTab = .alerts
                await popupCoordinator.refresh(using: session)
            }
        }
        .task {
            for await _ in NotificationCenter.default.notifications(named: .fuelNerveOpenBriefing) {
                selectedTab = .briefing
            }
        }
    }

    @ViewBuilder
    private func popupView(_ popup: OwnerPopupPresentation) -> some View {
        switch popup {
        case .approval(let approval):
            ApprovalDecisionSheet(approval: approval, intelligenceEnabled: session.hasIntelligence, dismiss: { popupCoordinator.deferActive() }) { sellingPrice, effectiveFrom in
                await approve(approval, sellingPrice: sellingPrice, effectiveFrom: effectiveFrom)
            }
        case .notification(let alert):
            if session.hasIntelligence && alert.hasKnownIntelligenceAgent {
                IntelligenceNotificationPopup(alert: alert, acknowledge: { await acknowledge(alert) }) { popupCoordinator.deferActive() }
            } else {
                CoreNotificationPopup(alert: alert, acknowledge: { await acknowledge(alert) }) { popupCoordinator.deferActive() }
            }
        case .loadPlanning(let alert, let recommendation):
            LoadPlanningNotificationPopup(alert: alert, recommendation: recommendation, acknowledge: { await acknowledge(alert) }) {
                popupCoordinator.deferActive()
            }
        case .dailyBrief(let briefing, let stationName, _):
            DailyBriefPopup(briefing: briefing, stationName: stationName, dismiss: { popupCoordinator.completeActive() }, openFullBrief: {
                popupCoordinator.completeActive()
                selectedTab = .briefing
            })
        }
    }

    private func acknowledge(_ alert: OwnerAlert) async -> Bool {
        do {
            try await session.alertService.acknowledge(id: alert.id)
            popupCoordinator.completeActive()
            return true
        } catch {
            session.handleAuthenticationFailure(error)
            return false
        }
    }

    private func approve(_ approval: OwnerApproval, sellingPrice: Double?, effectiveFrom: Date?) async -> Bool {
        do {
            _ = try await session.approvalService.decide(id: approval.id, approve: true, note: "", version: approval.version, sellingPrice: sellingPrice, sellingPriceEffectiveFrom: effectiveFrom)
            popupCoordinator.completeActive()
            NotificationCenter.default.post(name: .fuelNerveRecordsChanged, object: nil)
            return true
        } catch APIError.server(let status, _, _) where status == 409 {
            popupCoordinator.completeActive()
            decisionMessage = "This request changed after it was created. No records were changed. Review the refreshed request in Alerts."
            return false
        } catch {
            session.handleAuthenticationFailure(error)
            decisionMessage = "FuelNerve could not save this decision. No records were changed."
            return false
        }
    }
}
