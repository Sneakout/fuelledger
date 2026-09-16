import SwiftUI

struct TodayView: View {
    @Environment(AppSession.self) private var session
    @State private var snapshot: OwnerSnapshot?
    @State private var error: String?
    @State private var loading = false
    @State private var loadedStationId: String?
    @State private var snapshotStale = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let snapshot {
                    VStack(spacing: 18) {
                        StationHero(snapshot: snapshot)
                        if snapshotStale { StaleDataNotice(updatedAt: snapshot.asOf) { Task { await load() } } }
                        DashboardActionSection(actions: snapshot.alerts)
                        MetricGrid(snapshot: snapshot)
                        ShiftStatusCard(open: snapshot.openShifts, pending: snapshot.pendingReconciliations)
                        TankStockSection(tanks: snapshot.tanks)
                        CollectionSection(collections: snapshot.collections, total: snapshot.collectedToday)
                    }.padding(.horizontal, 18).padding(.bottom, 28)
                } else if let error {
                    ContentUnavailableView("Unable to load today", systemImage: "wifi.exclamationmark", description: Text(error))
                        .padding(.top, 80)
                } else { ProgressView("Reviewing station records…").padding(.top, 80) }
            }
            .background(FuelNerveTheme.canvas)
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { if loading { ProgressView() } } }
            .refreshable { await load() }
            .task(id: session.selectedStationId) { await load() }
            .task {
                for await _ in NotificationCenter.default.notifications(named: .fuelNerveRecordsChanged) { await load() }
            }
        }
    }

    private func load() async {
        let stationId = session.selectedStationId
        if loadedStationId != stationId {
            snapshot = nil; snapshotStale = false; error = nil
        }
        loading = snapshot == nil; defer { loading = false }
        do {
            let result = try await session.ownerService.snapshot(stationId: stationId)
            snapshot = result
            loadedStationId = stationId
            snapshotStale = false
            error = nil
        } catch {
            session.handleAuthenticationFailure(error)
            snapshotStale = snapshot != nil
            if snapshot == nil { self.error = "Please check your connection and fuel station access, then try again." }
        }
    }
}

private struct DashboardActionSection: View {
    let actions: [OwnerAlert]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("What needs action").font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest)
                Spacer()
                Text("\(actions.count)").font(.caption.bold()).foregroundStyle(actions.isEmpty ? FuelNerveTheme.green : FuelNerveTheme.gold)
                    .frame(minWidth: 30, minHeight: 30).background((actions.isEmpty ? Color.green : Color.orange).opacity(0.1), in: Circle())
            }
            if actions.isEmpty {
                Label("Nothing urgent", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.green)
                    .frame(maxWidth: .infinity, alignment: .leading).padding().background(.white, in: RoundedRectangle(cornerRadius: 18))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: action.severity == .urgent ? "exclamationmark.triangle.fill" : "bell.badge.fill")
                                .foregroundStyle(action.severity == .urgent ? .red : FuelNerveTheme.gold).frame(width: 24)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(action.title).font(.subheadline.weight(.bold)).foregroundStyle(FuelNerveTheme.forest)
                                Text(action.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }.padding(.vertical, 13)
                        if index < actions.count - 1 { Divider() }
                    }
                }.padding(.horizontal, 16).background(.white, in: RoundedRectangle(cornerRadius: 18))
            }
        }
    }
}

struct DailyBriefPopup: View {
    let briefing: DailyBriefing
    let stationName: String
    let dismiss: () -> Void
    let openFullBrief: () -> Void

    private var signals: [(DailyBriefing.Narrative.Item, DailyBriefing.Fact)] {
        briefing.narrative.items.compactMap { item in
            briefing.facts.first(where: { $0.id == item.factId }).map { (item, $0) }
        }.prefix(3).map { $0 }
    }

    var body: some View {
        ZStack {
            FuelNerveTheme.forest.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text("FUELNERVE INTELLIGENCE").font(.caption.bold()).tracking(1.2)
                        Spacer()
                        Label("DAILY BRIEF", systemImage: "circle.fill").font(.caption.bold()).foregroundStyle(FuelNerveTheme.green)
                        Button(action: dismiss) {
                            Image(systemName: "xmark").font(.subheadline.bold())
                                .frame(width: 34, height: 34).background(FuelNerveTheme.canvas, in: Circle())
                        }
                        .foregroundStyle(FuelNerveTheme.forest)
                        .accessibilityLabel("Close daily brief")
                    }
                    Divider().padding(.vertical, 16)
                    Text("\(stationName.uppercased()) · \(briefing.calculatedAt.formatted(.dateTime.day().month(.abbreviated)))")
                        .font(.caption.bold()).tracking(1).foregroundStyle(.secondary)
                    Text(briefing.narrative.headline)
                        .font(.largeTitle.bold()).foregroundStyle(FuelNerveTheme.forest).padding(.top, 8)

                    ForEach(signals, id: \.0.id) { item, fact in
                        Divider().padding(.vertical, 14)
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: symbol(for: fact)).foregroundStyle(accent(for: fact))
                                .frame(width: 42, height: 42).background(accent(for: fact).opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(fact.label): \(fact.value)").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                                Text(item.explanation).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }

                    Divider().padding(.vertical, 16)
                    HStack {
                        Text("\(signals.count) signals reviewed").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Open daily brief", action: openFullBrief)
                            .font(.subheadline.bold()).foregroundStyle(FuelNerveTheme.green)
                    }
                }
                .padding(22)
                .background(.white, in: RoundedRectangle(cornerRadius: 28))
                .padding(.horizontal, 18)
                .padding(.vertical, 34)
            }
        }
        .interactiveDismissDisabled()
    }

    private func accent(for fact: DailyBriefing.Fact) -> Color {
        fact.severity == "URGENT" ? .red : fact.severity == "ATTENTION" ? FuelNerveTheme.gold : FuelNerveTheme.green
    }

    private func symbol(for fact: DailyBriefing.Fact) -> String {
        switch fact.category { case "SHIFT": "clock.badge.exclamationmark"; case "STOCK": "cylinder.split.1x2"; case "PROFIT": "chart.line.uptrend.xyaxis"; default: "sparkles" }
    }
}

private struct StationHero: View {
    let snapshot: OwnerSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(greeting.uppercased()).font(.caption2.bold()).tracking(1.4).foregroundStyle(FuelNerveTheme.lime)
                    Text(snapshot.stationName)
                        .font(.title.bold())
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Updated \(snapshot.asOf.formatted(date: .omitted, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.68))
                }
                Spacer()
                StationScopePicker(compact: true)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(.white.opacity(0.12), in: Capsule())
                    .foregroundStyle(.white)
            }
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: needsAttention ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline).font(.subheadline.weight(.bold))
                    Text(statusDetail).font(.caption).foregroundStyle(.white.opacity(0.68))
                }
            }
            .foregroundStyle(needsAttention ? FuelNerveTheme.lime : .white.opacity(0.9))
        }
        .padding(20)
        .background(LinearGradient(colors: [FuelNerveTheme.forest, Color(red: 0.06, green: 0.38, blue: 0.28)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
    }

    private var greeting: String { Calendar.current.component(.hour, from: .now) < 12 ? "Good morning" : Calendar.current.component(.hour, from: .now) < 17 ? "Good afternoon" : "Good evening" }
    private var needsAttention: Bool { snapshot.openShifts > 0 || snapshot.pendingReconciliations > 0 }
    private var headline: String {
        if snapshot.openShifts > 0 { return "\(snapshot.openShifts) open shift\(snapshot.openShifts == 1 ? "" : "s") needs attention" }
        if snapshot.pendingReconciliations > 0 { return "\(snapshot.pendingReconciliations) reconciliation\(snapshot.pendingReconciliations == 1 ? "" : "s") to review" }
        return "Your station is on track"
    }
    private var statusDetail: String {
        needsAttention ? "Open today’s priorities below." : "Everything recorded is up to date."
    }
}

private struct MetricGrid: View {
    let snapshot: OwnerSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Today at a glance").font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest); Spacer() }
            LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 10) {
            MetricCard(title: "Sales today", value: snapshot.salesToday.rupees, detail: "\(snapshot.transactions) transactions", symbol: "indianrupeesign")
            MetricCard(title: "Collected", value: snapshot.collectedToday.rupees, detail: "All payment methods", symbol: "banknote")
            MetricCard(title: "Fuel sold", value: snapshot.meteredVolume.litres, detail: "Metered volume", symbol: "drop.fill")
            MetricCard(title: "Net profit", value: snapshot.netProfitToday.rupees, detail: "After cost and expenses", symbol: "chart.line.uptrend.xyaxis")
            }
        }
    }
}

private struct ShiftStatusCard: View {
    let open: Int; let pending: Int
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: open > 0 ? "clock.badge" : "checkmark.shield.fill").font(.title2).foregroundStyle(open > 0 ? FuelNerveTheme.gold : FuelNerveTheme.green).frame(width: 46, height: 46).background((open > 0 ? Color.orange : Color.green).opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 3) { Text("Shift status").font(.caption.bold()).foregroundStyle(.secondary); Text(open > 0 ? "\(open) shift\(open == 1 ? "" : "s") open" : "All shifts closed").font(.headline); if pending > 0 { Text("\(pending) awaiting reconciliation").font(.caption).foregroundStyle(FuelNerveTheme.gold) } }
            Spacer()
        }.padding().background(.white, in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct TankStockSection: View {
    let tanks: [OwnerTank]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "Fuel stock", detail: "Live book balance", symbol: "cylinder.split.1x2")
            if tanks.isEmpty { Text("No MS or HSD tanks are available.").font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(24).background(.white, in: RoundedRectangle(cornerRadius: 18)) }
            ForEach(tanks) { tank in
                HStack(spacing: 14) {
                    ZStack { Circle().stroke(Color.gray.opacity(0.12), lineWidth: 7); Circle().trim(from: 0, to: tank.fillPercent / 100).stroke(tank.status == "LOW" ? FuelNerveTheme.gold : FuelNerveTheme.green, style: StrokeStyle(lineWidth: 7, lineCap: .round)).rotationEffect(.degrees(-90)); Text("\(Int(tank.fillPercent))%").font(.caption2.bold()) }.frame(width: 58, height: 58)
                    VStack(alignment: .leading, spacing: 4) { Text("\(tank.productCode) · \(tank.code)").font(.headline); Text(tank.status == "LOW" ? "Replenishment attention" : "Stock level healthy").font(.caption).foregroundStyle(tank.status == "LOW" ? FuelNerveTheme.gold : .secondary) }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 3) { Text(tank.bookStock.litres).font(.headline); Text("of \(tank.workingCapacity.litres)").font(.caption2).foregroundStyle(.secondary) }
                }.padding().background(.white, in: RoundedRectangle(cornerRadius: 18))
            }
        }
    }
}

private struct CollectionSection: View {
    let collections: [OwnerCollection]; let total: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(title: "Collections", detail: total.rupees, symbol: "wallet.bifold")
            VStack(spacing: 0) {
                ForEach(collections) { item in
                    HStack { Label(item.method.capitalized, systemImage: symbol(item.method)); Spacer(); Text(item.amount.rupees).fontWeight(.semibold) }.padding(.vertical, 12)
                    if item.id != collections.last?.id { Divider() }
                }
            }.padding(.horizontal).background(.white, in: RoundedRectangle(cornerRadius: 18))
        }
    }
    private func symbol(_ method: String) -> String { switch method { case "CASH": "banknote"; case "UPI": "iphone.gen3"; case "CARD": "creditcard"; case "CREDIT": "person.text.rectangle"; default: "ellipsis.circle" } }
}

private struct SectionTitle: View {
    let title: String; let detail: String; let symbol: String
    var body: some View { HStack { Label(title, systemImage: symbol).font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest); Spacer(); Text(detail).font(.caption.weight(.semibold)).foregroundStyle(.secondary) } }
}
