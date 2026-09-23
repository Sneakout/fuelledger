import SwiftUI

struct BriefingView: View {
    @Environment(AppSession.self) private var session
    @State private var briefing: DailyBriefing?
    @State private var loading = true
    @State private var planRequired = false
    @State private var loadedStationId: String?
    @State private var stale = false

    var body: some View {
        NavigationStack {
            ZStack {
                FuelNerveTheme.canvas.ignoresSafeArea()
                if loading { ProgressView("Reviewing today’s records…") }
                else if planRequired { CoreBriefingPreview(subscriptionURL: session.environment.webBaseURL.appending(path: "subscription")) }
                else if let briefing { IntelligenceBriefingContent(briefing: briefing, stationName: session.selectedStation?.name ?? "Your station", stale: stale) { Task { await load() } } }
                else { VStack(spacing: 12) { ContentUnavailableView("Briefing unavailable", systemImage: "exclamationmark.arrow.triangle.2.circlepath", description: Text("FuelNerve could not load verified briefing data.")); Button("Try again") { Task { await load() } }.buttonStyle(.borderedProminent).tint(FuelNerveTheme.forest) } }
            }
            .navigationTitle("Daily briefing")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { StationScopePicker() } }
            .task(id: session.selectedStationId) { await load() }
        }
    }

    private func load() async {
        let stationId = session.selectedStationId
        if loadedStationId != stationId { briefing = nil; stale = false }
        loading = briefing == nil
        guard session.hasIntelligence else { briefing = nil; planRequired = true; loading = false; return }
        do { briefing = try await session.briefingService.daily(stationId: stationId); loadedStationId = stationId; stale = false; planRequired = false }
        catch APIError.server(_, let code, _) { planRequired = code == "INTELLIGENCE_PLAN_REQUIRED"; stale = briefing != nil }
        catch { session.handleAuthenticationFailure(error); stale = briefing != nil }
        loading = false
    }
}

private struct CoreBriefingPreview: View {
    let subscriptionURL: URL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        PlanBadge(title: "CORE", symbol: "checkmark.shield.fill", colour: .white.opacity(0.16))
                        Spacer()
                        Image(systemName: "fuelpump.fill").font(.title2).foregroundStyle(FuelNerveTheme.lime)
                    }
                    Text("Your station records, clearly organised.")
                        .font(.largeTitle.bold()).foregroundStyle(.white)
                    Text("Core keeps sales, stock, shifts, purchases and accounts in one dependable system.")
                        .font(.body).foregroundStyle(.white.opacity(0.74))
                }
                .padding(22)
                .background(FuelNerveTheme.forest, in: RoundedRectangle(cornerRadius: 26))

                VStack(alignment: .leading, spacing: 14) {
                    Text("INCLUDED WITH CORE").font(.caption.bold()).tracking(1.2).foregroundStyle(FuelNerveTheme.green)
                    CoreFeature(symbol: "chart.bar.fill", title: "Live business view", detail: "Sales, collections, profit and tank stock from posted records.")
                    CoreFeature(symbol: "bell.badge.fill", title: "Rules-based alerts", detail: "Known exceptions appear when a configured threshold is crossed.")
                    CoreFeature(symbol: "checkmark.shield.fill", title: "Owner-controlled records", detail: "Nothing changes without an authorised workflow.")
                }
                .padding(20).background(.white, in: RoundedRectangle(cornerRadius: 22))

                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        PlanBadge(title: "CORE + INTELLIGENCE", symbol: "sparkles", colour: FuelNerveTheme.lime)
                        Spacer()
                        Text("OPTIONAL").font(.caption2.bold()).tracking(1).foregroundStyle(.secondary)
                    }
                    Text("Six specialists review the records for you.")
                        .font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                    Text("Instead of opening every report, you receive one short owner briefing: what changed, why it matters and what to review next.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        IntelligenceBenefit(title: "Prioritised", symbol: "list.number")
                        IntelligenceBenefit(title: "Explained", symbol: "text.bubble")
                        IntelligenceBenefit(title: "Evidence", symbol: "doc.text.magnifyingglass")
                    }
                    Link(destination: subscriptionURL) {
                        HStack { Text("Explore Core + Intelligence").fontWeight(.bold); Spacer(); Image(systemName: "arrow.right") }
                            .foregroundStyle(FuelNerveTheme.forest).padding(.horizontal, 18).frame(height: 52)
                            .background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 16))
                    }
                }
                .padding(20)
                .background(LinearGradient(colors: [Color.white, FuelNerveTheme.lime.opacity(0.13)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).stroke(FuelNerveTheme.lime.opacity(0.5)))
            }
            .padding()
        }
    }
}

private struct IntelligenceBriefingContent: View {
    let briefing: DailyBriefing
    let stationName: String
    let stale: Bool
    let retry: () -> Void
    private func fact(_ id: String) -> DailyBriefing.Fact? { briefing.facts.first { $0.id == id } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if stale { StaleDataNotice(updatedAt: briefing.calculatedAt, retry: retry) }
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        PlanBadge(title: "CORE + INTELLIGENCE", symbol: "sparkles", colour: FuelNerveTheme.lime)
                        Spacer()
                        Label("ACTIVE", systemImage: "circle.fill").font(.caption2.bold()).foregroundStyle(FuelNerveTheme.lime)
                    }
                    Text(stationName.uppercased()).font(.caption.bold()).tracking(1.2).foregroundStyle(.white.opacity(0.58))
                    Text(briefing.narrative.headline).font(.largeTitle.bold())
                    Text(briefing.narrative.summary).foregroundStyle(.white.opacity(0.78))
                    Divider().overlay(.white.opacity(0.16))
                    HStack {
                        Label("6 specialists reviewed", systemImage: "person.3.fill")
                        Spacer()
                        Text(briefing.calculatedAt.formatted(date: .omitted, time: .shortened))
                    }.font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.66))
                }.frame(maxWidth: .infinity, alignment: .leading).padding(22).foregroundStyle(.white).background(FuelNerveTheme.forest, in: RoundedRectangle(cornerRadius: 24))

                Text("What deserves your attention").font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest)
                ForEach(briefing.narrative.items) { item in
                    if let fact = fact(item.factId) { BriefingSignal(fact: fact, item: item) }
                }

                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Verified station facts").font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest)
                        Text("The numbers behind today’s briefing").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(FuelNerveTheme.green)
                }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(briefing.facts) { fact in
                        VStack(alignment: .leading, spacing: 6) { Text(fact.label.uppercased()).font(.caption2.bold()).foregroundStyle(.secondary); Text(fact.value).font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest); Text(fact.context).font(.caption).foregroundStyle(.secondary).lineLimit(3) }.frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading).padding().background(.white, in: RoundedRectangle(cornerRadius: 18))
                    }
                }
            }.padding()
        }.refreshable { retry() }
    }
}

private struct BriefingSignal: View {
    let fact: DailyBriefing.Fact; let item: DailyBriefing.Narrative.Item
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol).font(.headline).foregroundStyle(accent)
                    .frame(width: 40, height: 40).background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text(agent).font(.caption.bold()).foregroundStyle(accent)
                    Text(fact.label).font(.headline)
                }
                Spacer()
                Text(fact.value).font(.headline).foregroundStyle(FuelNerveTheme.forest)
            }
            Text(item.explanation).foregroundStyle(.secondary)
            Label(item.action, systemImage: "arrow.right.circle.fill").font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest)
            EvidenceLink(label: fact.evidenceLabel, path: fact.evidencePath)
        }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20))
        .overlay(alignment: .leading) { Capsule().fill(accent).frame(width: 4).padding(.vertical, 16) }
    }

    private var accent: Color { fact.severity == "URGENT" ? .red : fact.severity == "ATTENTION" ? FuelNerveTheme.gold : FuelNerveTheme.green }
    private var symbol: String { switch fact.category { case "SHIFT": "clock.badge.exclamationmark"; case "STOCK": "cylinder.split.1x2"; case "CREDIT": "person.crop.circle.badge.exclamationmark"; case "PROFIT": "chart.line.uptrend.xyaxis"; case "PURCHASE": "cart"; default: "sparkles" } }
    private var agent: String { switch fact.category { case "SHIFT": "SHIFT AGENT"; case "STOCK": "STOCK AGENT"; case "CREDIT": "CREDIT AGENT"; case "PROFIT": "PROFIT AGENT"; case "PURCHASE": "PURCHASE AGENT"; default: "OWNER ASSISTANT" } }
}

private struct PlanBadge: View {
    let title: String; let symbol: String; let colour: Color
    var body: some View {
        Label(title, systemImage: symbol).font(.caption2.bold()).tracking(0.8)
            .foregroundStyle(title == "CORE" ? Color.white : FuelNerveTheme.forest)
            .padding(.horizontal, 10).padding(.vertical, 7).background(colour, in: Capsule())
    }
}

private struct CoreFeature: View {
    let symbol: String; let title: String; let detail: String
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(FuelNerveTheme.green).frame(width: 38, height: 38).background(FuelNerveTheme.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 3) { Text(title).font(.subheadline.bold()).foregroundStyle(FuelNerveTheme.forest); Text(detail).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

private struct IntelligenceBenefit: View {
    let title: String; let symbol: String
    var body: some View {
        VStack(spacing: 7) { Image(systemName: symbol).foregroundStyle(FuelNerveTheme.green); Text(title).font(.caption2.bold()).foregroundStyle(FuelNerveTheme.forest) }
            .frame(maxWidth: .infinity).padding(.vertical, 12).background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 14))
    }
}
