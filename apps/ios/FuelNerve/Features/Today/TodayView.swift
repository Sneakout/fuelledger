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
                        MetricGrid(snapshot: snapshot)
                        TankStockSection(tanks: snapshot.tanks)
                        CollectionSection(collections: snapshot.collections, total: snapshot.collectedToday)
                        ShiftStatusCard(open: snapshot.openShifts, pending: snapshot.pendingReconciliations)
                    }.padding(.horizontal, 18).padding(.bottom, 28)
                } else if let error {
                    ContentUnavailableView("Unable to load today", systemImage: "wifi.exclamationmark", description: Text(error))
                        .padding(.top, 80)
                } else { ProgressView("Reviewing station records…").padding(.top, 80) }
            }
            .background(FuelNerveTheme.canvas)
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Text(profileInitials)
                            .font(.caption.bold())
                            .foregroundStyle(FuelNerveTheme.forest)
                            .frame(width: 34, height: 34)
                            .background(FuelNerveTheme.lime, in: Circle())
                    }
                    .accessibilityLabel("Open profile")
                }
                ToolbarItem(placement: .topBarTrailing) { if loading { ProgressView() } }
            }
            .refreshable { await load() }
            .task(id: session.selectedStationId) { await load() }
            .task {
                for await _ in NotificationCenter.default.notifications(named: .fuelNerveRecordsChanged) { await load() }
            }
        }
    }

    private var profileInitials: String {
        let parts = (session.user?.name ?? "Owner").split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
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
            Label("Live owner overview", systemImage: "chart.bar.fill")
                .font(.subheadline.weight(.bold)).foregroundStyle(FuelNerveTheme.lime)
        }
        .padding(20)
        .background(LinearGradient(colors: [FuelNerveTheme.forest, Color(red: 0.06, green: 0.38, blue: 0.28)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
    }

    private var greeting: String { Calendar.current.component(.hour, from: .now) < 12 ? "Good morning" : Calendar.current.component(.hour, from: .now) < 17 ? "Good afternoon" : "Good evening" }
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
                HStack(spacing: 18) {
                    TankLevelGraphic(percent: tank.fillPercent, status: tank.status)
                    VStack(alignment: .leading, spacing: 7) {
                        HStack { Text(tank.productCode).font(.caption.bold()).tracking(1).foregroundStyle(FuelNerveTheme.green); Text("· \(tank.code)").font(.caption).foregroundStyle(.secondary) }
                        Text(tank.bookStock.litres).font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest)
                        Text("of \(tank.workingCapacity.litres) capacity").font(.caption).foregroundStyle(.secondary)
                        if tank.status == "OVER_CAPACITY" {
                            Label("Recorded stock exceeds safe capacity", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption2.weight(.bold)).foregroundStyle(.red)
                        }
                        HStack(spacing: 12) {
                            if tank.sellingPrice > 0 { Label("₹\(tank.sellingPrice.formatted(.number.precision(.fractionLength(0...2))))/L", systemImage: "indianrupeesign.circle") }
                            if let density = tank.density { Label("\(density.formatted(.number.precision(.fractionLength(0...1)))) kg/m³", systemImage: "drop.degreesign") }
                        }.font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Spacer()
                }.padding(16).background(.white, in: RoundedRectangle(cornerRadius: 20))
            }
        }
    }
}

private struct TankLevelGraphic: View {
    let percent: Double
    let status: String
    private var level: Double { max(0, min(1, percent / 100)) }
    private var colour: Color { status == "OVER_CAPACITY" || status == "EMPTY" ? .red : status == "LOW" ? FuelNerveTheme.gold : FuelNerveTheme.green }

    var body: some View {
        VStack(spacing: 7) {
            Text("\(Int(percent.rounded()))%")
                .font(.caption.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(colour)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(colour.opacity(0.1), in: Capsule())

            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 11)
                    .fill(Color(red: 0.93, green: 0.96, blue: 0.94))
                GeometryReader { proxy in
                    VStack(spacing: 0) {
                        Spacer(minLength: 0)
                        RoundedRectangle(cornerRadius: 7)
                            .fill(
                                LinearGradient(
                                    colors: [colour.opacity(0.58), colour],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                            .frame(height: proxy.size.height * level)
                    }
                    .padding(5)
                }
            }
            .frame(width: 58, height: 82)
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .stroke(colour.opacity(0.65), lineWidth: 2)
            )
        }
        .frame(width: 64)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Int(percent.rounded())) percent full")
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
