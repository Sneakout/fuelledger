import SwiftUI

struct StationScopePicker: View {
    @Environment(AppSession.self) private var session
    var compact = false

    var body: some View {
        Menu {
            ForEach(session.permittedStations) { station in
                Button {
                    session.selectStation(station.id)
                } label: {
                    if station.id == session.selectedStationId {
                        Label(station.name, systemImage: "checkmark")
                    } else {
                        Text(station.name)
                    }
                }
            }
        } label: {
            if compact {
                Label(session.permittedStations.count > 1 ? "Switch" : "Station", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption.weight(.semibold))
            } else {
                Label(session.selectedStation?.name ?? "Select station", systemImage: "fuelpump")
                    .font(.caption.weight(.semibold))
            }
        }
        .disabled(session.permittedStations.isEmpty)
        .accessibilityLabel("Current fuel station")
        .accessibilityValue(session.selectedStation?.name ?? "None selected")
    }
}
