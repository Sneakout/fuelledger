import SwiftUI

struct StationScopePicker: View {
    @Environment(AppSession.self) private var session
    @State private var showingStations = false
    var compact = false

    var body: some View {
        Button { showingStations = true } label: {
            if compact {
                Label(session.permittedStations.count > 1 ? "Switch" : "Station", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption.weight(.semibold))
            } else {
                Label(session.selectedStation?.name ?? "Select station", systemImage: "fuelpump.fill")
                    .font(.caption.weight(.semibold))
            }
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showingStations) {
            StationSelectionSheet(
                stations: session.permittedStations,
                selectedId: session.selectedStationId
            ) { stationId in
                session.selectStation(stationId)
                showingStations = false
            } dismiss: {
                showingStations = false
            }
            .presentationDetents([.medium])
            .fuelNerveSheet()
        }
        .disabled(session.permittedStations.isEmpty)
        .accessibilityLabel("Current fuel station")
        .accessibilityValue(session.selectedStation?.name ?? "None selected")
    }
}

private struct StationSelectionSheet: View {
    let stations: [ApplicationScope.Station]
    let selectedId: String?
    let select: (String) -> Void
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(systemName: "fuelpump.fill").font(.title2).foregroundStyle(FuelNerveTheme.forest)
                    .frame(width: 50, height: 50).background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 15))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Choose fuel station").font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                    Text("Every number will refresh for this station.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: dismiss) { Image(systemName: "xmark").frame(width: 38, height: 38).background(.white, in: Circle()) }
                    .foregroundStyle(FuelNerveTheme.forest).accessibilityLabel("Close station selection")
            }
            VStack(spacing: 10) {
                ForEach(stations) { station in
                    Button { select(station.id) } label: {
                        HStack(spacing: 13) {
                            Text(String(station.name.prefix(2)).uppercased()).font(.caption.bold()).foregroundStyle(FuelNerveTheme.forest)
                                .frame(width: 42, height: 42).background(station.id == selectedId ? FuelNerveTheme.lime : FuelNerveTheme.green.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 2) { Text(station.name).font(.subheadline.bold()); Text("\(station.code) · \(station.city)").font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Image(systemName: station.id == selectedId ? "checkmark.circle.fill" : "circle").foregroundStyle(station.id == selectedId ? FuelNerveTheme.green : .secondary)
                        }
                        .foregroundStyle(FuelNerveTheme.forest).padding(13).background(.white, in: RoundedRectangle(cornerRadius: 17))
                        .overlay(RoundedRectangle(cornerRadius: 17).stroke(station.id == selectedId ? FuelNerveTheme.green.opacity(0.35) : FuelNerveTheme.forest.opacity(0.06)))
                    }.buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
    }
}
