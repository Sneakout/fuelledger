import Foundation
import Observation

enum OwnerPopupPresentation: Identifiable {
    case approval(OwnerApproval)
    case notification(OwnerAlert)
    case loadPlanning(OwnerAlert, LoadPlanRecommendation)
    case dailyBrief(DailyBriefing, stationName: String, seenKey: String)

    var id: String {
        switch self {
        case .approval(let value): "approval:\(value.id)"
        case .notification(let value): "notification:\(value.id)"
        case .loadPlanning(let value, _): "notification:\(value.id)"
        case .dailyBrief(_, _, let key): "brief:\(key)"
        }
    }
}

@MainActor
@Observable
final class OwnerPopupCoordinator {
    private(set) var active: OwnerPopupPresentation?
    private var deferredIds: Set<String> = []
    private var generation = 0

    func refresh(using session: AppSession) async {
        generation += 1
        let requestedGeneration = generation
        active = nil

        let stationId = session.selectedStationId
        var approvals: [OwnerApproval] = []
        var alerts: [OwnerAlert] = []
        var briefing: DailyBriefing?

        do {
            alerts = try await session.alertService.alerts(stationId: stationId)
                .filter { $0.acknowledgedAt == nil && $0.packet != nil && !deferredIds.contains("notification:\($0.id)") }
            if session.capabilities.approvals {
                approvals = try await session.approvalService.approvals()
                    .filter { stationId == nil || $0.station.id == stationId }
                    .filter { !deferredIds.contains("approval:\($0.id)") }
            }
            if session.hasIntelligence {
                briefing = try? await session.briefingService.daily(stationId: stationId)
            }
        } catch {
            session.handleAuthenticationFailure(error)
            return
        }

        guard requestedGeneration == generation else { return }

        // 1. Security and uncertain execution always interrupt first.
        if let alert = alerts.first(where: isSecurityOrUncertain) {
            active = .notification(alert); return
        }
        // A tapped or foreground push identifies the exact decision to open.
        if let pendingApprovalId = UserDefaults.standard.string(forKey: PushNavigation.pendingApprovalKey),
           let approval = approvals.first(where: { $0.id == pendingApprovalId }) {
            UserDefaults.standard.removeObject(forKey: PushNavigation.pendingApprovalKey)
            active = .approval(approval); return
        }
        // 2. A decision is more important than operational information.
        if let approval = approvals.first {
            active = .approval(approval); return
        }
        // 3. Conditions that can interrupt station operations.
        if let alert = alerts.first(where: isOperationalInterruption) {
            active = .notification(alert); return
        }
        // 4. A market outlook can suggest a draft only after refreshing live tank balances.
        if session.hasIntelligence,
           let alert = alerts.first(where: isMarketPriceOutlook),
           let snapshot = try? await session.ownerService.snapshot(stationId: stationId),
           let recommendation = LoadPlanRecommendation(snapshot: snapshot) {
            active = .loadPlanning(alert, recommendation); return
        }
        // 4. Other material items. Informational messages remain in Alerts.
        if let alert = alerts.first(where: { $0.severity == .urgent || $0.severity == .attention }) {
            active = .notification(alert); return
        }
        // 5. Daily Brief appears only when nothing more important is waiting.
        if let briefing {
            let scope = stationId ?? "all-stations"
            let key = "fuelNerve.dailyBrief.seen.\(scope).\(briefing.date)"
            if !UserDefaults.standard.bool(forKey: key) && !deferredIds.contains("brief:\(key)") {
                active = .dailyBrief(briefing, stationName: session.selectedStation?.name ?? "Your fuel station", seenKey: key)
            }
        }
    }

    func deferActive() {
        guard let active else { return }
        deferredIds.insert(active.id)
        self.active = nil
    }

    func completeActive() {
        guard let active else { return }
        deferredIds.insert(active.id)
        if case .dailyBrief(_, _, let key) = active { UserDefaults.standard.set(true, forKey: key) }
        self.active = nil
    }

    private func isSecurityOrUncertain(_ alert: OwnerAlert) -> Bool {
        guard let packet = alert.packet else { return false }
        return packet.recordType == "SECURITY_EVENT" || packet.status.contains("UNCERTAIN") || packet.status.contains("PARTIAL_EXECUTION")
    }

    private func isOperationalInterruption(_ alert: OwnerAlert) -> Bool {
        guard let packet = alert.packet else { return false }
        return packet.status == "OPEN" || packet.status == "EMPTY" || packet.status == "READING_MISSING"
            || (packet.recordType == "SHIFT_RECONCILIATION" && alert.severity == .urgent)
    }

    private func isMarketPriceOutlook(_ alert: OwnerAlert) -> Bool {
        alert.notificationType == "MARKET_PRICE_OUTLOOK" || alert.packet?.recordType == "MARKET_PRICE_OUTLOOK"
    }
}
