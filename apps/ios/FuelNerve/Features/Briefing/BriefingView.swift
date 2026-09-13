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
                else if planRequired { VStack(spacing: 18) { ContentUnavailableView("FuelNerve Intelligence", systemImage: "sparkles", description: Text("Daily owner briefings are included with Core + Intelligence.")); Link("View Core + Intelligence", destination: session.environment.webBaseURL.appending(path: "subscription")).buttonStyle(.borderedProminent).tint(FuelNerveTheme.forest) } }
                else if let briefing { BriefingContent(briefing: briefing, stale: stale) { Task { await load() } } }
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

private struct BriefingContent: View {
    let briefing: DailyBriefing
    let stale: Bool
    let retry: () -> Void
    private func fact(_ id: String) -> DailyBriefing.Fact? { briefing.facts.first { $0.id == id } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if stale { StaleDataNotice(updatedAt: briefing.calculatedAt, retry: retry) }
                VStack(alignment: .leading, spacing: 10) {
                    Label(briefing.narrativeMode == "AI_EXPLAINED" ? "FUELNERVE INTELLIGENCE" : "VERIFIED DAILY BRIEF", systemImage: "sparkles").font(.caption.weight(.bold)).foregroundStyle(FuelNerveTheme.lime)
                    Text(briefing.narrative.headline).font(.largeTitle.bold())
                    Text(briefing.narrative.summary).foregroundStyle(.white.opacity(0.78))
                    Text("Calculated \(briefing.calculatedAt.formatted(date: .omitted, time: .shortened)) · balances come from posted records").font(.caption).foregroundStyle(.white.opacity(0.6))
                }.frame(maxWidth: .infinity, alignment: .leading).padding(22).foregroundStyle(.white).background(FuelNerveTheme.forest, in: RoundedRectangle(cornerRadius: 24))

                ForEach(briefing.narrative.items) { item in
                    if let fact = fact(item.factId) { BriefingSignal(fact: fact, item: item) }
                }

                Text("Verified numbers").font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(briefing.facts) { fact in
                        VStack(alignment: .leading, spacing: 6) { Text(fact.label.uppercased()).font(.caption2.bold()).foregroundStyle(.secondary); Text(fact.value).font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest); Text(fact.context).font(.caption).foregroundStyle(.secondary).lineLimit(3) }.frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading).padding().background(.white, in: RoundedRectangle(cornerRadius: 18))
                    }
                }
            }.padding()
        }.refreshable {}
    }
}

private struct BriefingSignal: View {
    let fact: DailyBriefing.Fact; let item: DailyBriefing.Narrative.Item
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(fact.label).font(.headline); Spacer(); Text(fact.value).font(.headline).foregroundStyle(FuelNerveTheme.gold) }
            Text(item.explanation).foregroundStyle(.secondary)
            Text(item.action).font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest)
            EvidenceLink(label: fact.evidenceLabel, path: fact.evidencePath)
        }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20))
    }
}
