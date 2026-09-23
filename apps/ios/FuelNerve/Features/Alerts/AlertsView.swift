import SwiftUI

struct AlertsView: View {
    @Environment(AppSession.self) private var session
    @State private var alerts: [OwnerAlert] = []
    @State private var dashboardAlertIds: Set<String> = []
    @State private var approvals: [OwnerApproval] = []
    @State private var reviewedApprovals: [OwnerApproval] = []
    @State private var selectedApproval: OwnerApproval?
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var loadedStationId: String?
    @State private var lastUpdated: Date?
    @State private var stale = false

    var body: some View {
        NavigationStack {
            ZStack {
                FuelNerveTheme.canvas.ignoresSafeArea()
                if loading { ProgressView("Reviewing station signals…") }
                else if alerts.isEmpty && approvals.isEmpty && reviewedApprovals.isEmpty && stale { VStack(spacing: 12) { ContentUnavailableView("Alerts unavailable", systemImage: "wifi.exclamationmark", description: Text("FuelNerve could not load verified alerts for this station.")); Button("Try again") { Task { await load() } }.buttonStyle(.borderedProminent).tint(FuelNerveTheme.forest) } }
                else if alerts.isEmpty && approvals.isEmpty && reviewedApprovals.isEmpty { ContentUnavailableView("All clear", systemImage: "checkmark.shield", description: Text("There are no alerts or decisions needing your attention.")) }
                else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            if stale, let lastUpdated { StaleDataNotice(updatedAt: lastUpdated) { Task { await load() } } }
                            if !approvals.isEmpty || !alerts.isEmpty { Text("NEEDS YOUR ATTENTION").font(.caption.bold()).tracking(1.1).foregroundStyle(FuelNerveTheme.gold) }
                            ForEach(approvals) { approval in
                                ApprovalAlertCard(approval: approval, intelligenceEnabled: session.hasIntelligence) { selectedApproval = approval }
                            }
                            ForEach(alerts) { alert in
                                AlertCard(alert: alert, acknowledgementEnabled: session.capabilities.alertAcknowledgement && !dashboardAlertIds.contains(alert.id), isLiveSignal: dashboardAlertIds.contains(alert.id)) { acknowledge(alert) }
                            }
                            if !reviewedApprovals.isEmpty {
                                Text("RECENTLY REVIEWED").font(.caption.bold()).tracking(1.1).foregroundStyle(.secondary).padding(.top, 10)
                                ForEach(reviewedApprovals) { approval in ReviewedApprovalCard(approval: approval) }
                            }
                        }.padding()
                    }.refreshable { await load() }
                }
            }
            .navigationTitle("Alerts")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Text("\(alerts.filter { $0.acknowledgedAt == nil }.count + approvals.count) active").font(.caption.weight(.semibold)).foregroundStyle(FuelNerveTheme.green) }
                ToolbarItem(placement: .topBarTrailing) { StationScopePicker() }
            }
            .task(id: session.selectedStationId) { await load() }
            .task {
                for await _ in NotificationCenter.default.notifications(named: .fuelNerveOpenApproval) {
                    await load()
                    openPendingApprovalIfAvailable()
                }
            }
            .task {
                for await _ in NotificationCenter.default.notifications(named: .fuelNerveRecordsChanged) {
                    await load()
                }
            }
            .sheet(item: $selectedApproval) { approval in
                ApprovalDecisionSheet(approval: approval, intelligenceEnabled: session.hasIntelligence, dismiss: { selectedApproval = nil }) { sellingPrice, effectiveFrom in
                    await approve(approval, sellingPrice: sellingPrice, effectiveFrom: effectiveFrom)
                }
            }
            .alert("Alerts unavailable", isPresented: .constant(errorMessage != nil)) { Button("OK") { errorMessage = nil } } message: { Text(errorMessage ?? "") }
        }
    }

    private func load() async {
        let stationId = session.selectedStationId
        if loadedStationId != stationId { alerts = []; dashboardAlertIds = []; approvals = []; reviewedApprovals = []; lastUpdated = nil; stale = false }
        loading = alerts.isEmpty && approvals.isEmpty && reviewedApprovals.isEmpty
        do {
            async let notificationRequest = session.alertService.alerts(stationId: stationId)
            async let dashboardRequest = session.ownerService.snapshot(stationId: stationId)
            let (notifications, dashboard) = try await (notificationRequest, dashboardRequest)
            var merged = notifications
            var derivedIds = Set<String>()
            for alert in dashboard.alerts where !merged.contains(where: { $0.title == alert.title && $0.evidencePath == alert.evidencePath }) {
                merged.append(alert)
                derivedIds.insert(alert.id)
            }
            alerts = merged.sorted { $0.createdAt > $1.createdAt }
            dashboardAlertIds = derivedIds
            if session.capabilities.approvals {
                let allApprovals = try await session.approvalService.approvals(status: nil).filter { stationId == nil || $0.station.id == stationId }
                approvals = allApprovals.filter { $0.status == "PENDING" }
                reviewedApprovals = Array(allApprovals.filter { $0.status != "PENDING" }.prefix(10))
            } else {
                approvals = []
                reviewedApprovals = []
            }
            loadedStationId = stationId; lastUpdated = .now; stale = false; errorMessage = nil
            openPendingApprovalIfAvailable()
        }
        catch { session.handleAuthenticationFailure(error); stale = true; errorMessage = alerts.isEmpty ? nil : "FuelNerve could not refresh alerts. The previous update remains visible." }
        loading = false
    }

    private func openPendingApprovalIfAvailable() {
        guard let approvalId = UserDefaults.standard.string(forKey: PushNavigation.pendingApprovalKey),
              let approval = approvals.first(where: { $0.id == approvalId }) else { return }
        UserDefaults.standard.removeObject(forKey: PushNavigation.pendingApprovalKey)
        selectedApproval = approval
    }

    private func acknowledge(_ alert: OwnerAlert) {
        Task {
            do { try await session.alertService.acknowledge(id: alert.id); alerts.removeAll { $0.id == alert.id } }
            catch { session.handleAuthenticationFailure(error); errorMessage = "The alert could not be acknowledged. Please try again." }
        }
    }

    private func approve(_ approval: OwnerApproval, sellingPrice: Double?, effectiveFrom: Date?) async -> Bool {
        do {
            _ = try await session.approvalService.decide(id: approval.id, approve: true, note: "", version: approval.version, sellingPrice: sellingPrice, sellingPriceEffectiveFrom: effectiveFrom)
            await load()
            NotificationCenter.default.post(name: .fuelNerveRecordsChanged, object: nil)
            return true
        } catch APIError.server(let status, _, _) where status == 409 {
            errorMessage = "This request changed or was already reviewed. Refresh to see its latest status."
            await load()
            return false
        } catch {
            session.handleAuthenticationFailure(error)
            errorMessage = "The decision was not saved. No records were changed."
            return false
        }
    }
}

private struct ReviewedApprovalCard: View {
    let approval: OwnerApproval

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: approval.status == "APPROVED" ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.title3).foregroundStyle(approval.status == "APPROVED" ? FuelNerveTheme.green : .secondary)
                .frame(width: 38, height: 38).background(Color.gray.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) {
                Text(approval.isPriceChange ? "\(approval.evidence.product.code) price decision" : "\(approval.evidence.product.code) stock decision")
                    .font(.subheadline.weight(.bold)).foregroundStyle(FuelNerveTheme.forest)
                Text(approval.status == "APPROVED" ? "Approved and records updated" : "Not approved")
                    .font(.caption).foregroundStyle(.secondary)
                if approval.isPriceChange, let invoiceNumber = approval.evidence.invoice?.invoiceNumber ?? approval.payload.invoiceNumber {
                    Text("Invoice \(invoiceNumber)").font(.caption2.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest.opacity(0.72))
                }
                Text(approval.station.name).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if let decidedAt = approval.decidedAt { Text(decidedAt, style: .relative).font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(14).background(.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct ApprovalAlertCard: View {
    let approval: OwnerApproval
    let intelligenceEnabled: Bool
    let review: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: approval.isPriceChange ? "indianrupeesign" : "cylinder.split.1x2.fill")
                    .font(.title3).foregroundStyle(FuelNerveTheme.forest)
                    .frame(width: 42, height: 42)
                    .background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 13))
                VStack(alignment: .leading, spacing: 4) {
                    Text(intelligenceEnabled ? "\(approval.isPriceChange ? "Purchase Agent" : "Stock Agent") · Decision needed" : "Owner decision needed")
                        .font(.caption.bold()).foregroundStyle(FuelNerveTheme.gold)
                    Text(title).font(.headline).foregroundStyle(FuelNerveTheme.forest)
                    Text(approval.station.name).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(approval.requestedAt, style: .relative).font(.caption2).foregroundStyle(.secondary)
            }
            Text(approval.reason).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            Button("Review decision", action: review)
                .buttonStyle(.borderedProminent).tint(FuelNerveTheme.forest)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(16).background(.white, in: RoundedRectangle(cornerRadius: 20))
        .overlay(alignment: .leading) { Capsule().fill(FuelNerveTheme.gold).frame(width: 4).padding(.vertical, 16) }
    }

    private var title: String {
        if approval.isPriceChange {
            let price = approval.evidence.proposedPurchasePrice ?? approval.payload.proposedPurchasePrice ?? 0
            return "Confirm \(approval.evidence.product.code) price at \(price.formatted(.currency(code: "INR")))"
        }
        let amount = (approval.payload.quantityDelta ?? 0).formatted(.number.precision(.fractionLength(0...2)))
        return "Adjust \(approval.evidence.product.code) by \(amount) L"
    }
}

private struct AlertCard: View {
    let alert: OwnerAlert
    let acknowledgementEnabled: Bool
    let isLiveSignal: Bool
    let acknowledge: () -> Void
    private var accent: Color { alert.severity == .urgent ? .red : alert.severity == .attention ? FuelNerveTheme.gold : FuelNerveTheme.green }
    private var symbol: String { alert.severity == .urgent ? "exclamationmark.triangle.fill" : alert.severity == .attention ? "gauge.with.dots.needle.33percent" : "sparkles" }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol).font(.title3).foregroundStyle(accent).frame(width: 42, height: 42).background(accent.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 5) {
                    Text(alert.title).font(.headline).foregroundStyle(FuelNerveTheme.forest)
                    if let station = alert.stationName { Text(station).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                    Text(alert.detail).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                Text(alert.createdAt, style: .relative).font(.caption2).foregroundStyle(.secondary)
            }
            Divider()
            HStack {
                EvidenceLink(label: alert.evidence, path: alert.evidencePath)
                Spacer()
                if alert.acknowledgedAt != nil {
                    Label("Reviewed", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(FuelNerveTheme.green)
                } else if acknowledgementEnabled {
                    Button("Acknowledge", action: acknowledge).buttonStyle(.borderedProminent).tint(FuelNerveTheme.forest).controlSize(.small)
                } else if isLiveSignal {
                    Label("Live status", systemImage: "arrow.triangle.2.circlepath").font(.caption).foregroundStyle(FuelNerveTheme.green)
                } else {
                    Label("Read-only", systemImage: "eye").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(16).background(.white, in: RoundedRectangle(cornerRadius: 20)).overlay(alignment: .leading) { Capsule().fill(accent).frame(width: 4).padding(.vertical, 16) }
    }
}
