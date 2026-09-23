import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var signingOut = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                profileHeader
                settingsCard(title: "ACCOUNT", symbol: "person.crop.circle.fill") {
                    settingRow("Name", session.user?.name ?? "—", symbol: "person")
                    Divider()
                    settingRow("Email", session.user?.email ?? "—", symbol: "envelope")
                    Divider()
                    settingRow("Organization", session.user?.organization.name ?? "—", symbol: "building.2")
                }
                settingsCard(title: "FUELNERVE ACCESS", symbol: "checkmark.shield.fill") {
                    settingRow("Plan", session.hasIntelligence ? "Core + Intelligence" : "Core", symbol: session.hasIntelligence ? "sparkles" : "square.grid.2x2")
                    Divider()
                    settingRow("Permissions", accessLabel, symbol: "key.horizontal")
                    Divider()
                    settingRow("Environment", session.environment.name.rawValue.capitalized, symbol: "server.rack")
                }
                settingsCard(title: "CURRENT STATION", symbol: "fuelpump.fill") {
                    HStack(spacing: 13) {
                        Image(systemName: "fuelpump.fill").foregroundStyle(FuelNerveTheme.green)
                            .frame(width: 40, height: 40).background(FuelNerveTheme.green.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.selectedStation?.name ?? "No station selected").font(.subheadline.bold()).foregroundStyle(FuelNerveTheme.forest)
                            Text(session.selectedStation.map { "\($0.code) · \($0.city), \($0.state)" } ?? "Choose an authorised station").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        StationScopePicker(compact: true).foregroundStyle(FuelNerveTheme.green)
                    }
                }
                Button {
                    signingOut = true
                    Task { await session.logout(); signingOut = false }
                } label: {
                    HStack { if signingOut { ProgressView() }; Image(systemName: "rectangle.portrait.and.arrow.right"); Text(signingOut ? "Signing out…" : "Sign out").fontWeight(.semibold) }
                        .foregroundStyle(.red).frame(maxWidth: .infinity).frame(height: 50)
                        .background(.white, in: RoundedRectangle(cornerRadius: 17))
                        .overlay(RoundedRectangle(cornerRadius: 17).stroke(Color.red.opacity(0.16)))
                }
                .buttonStyle(.plain).disabled(signingOut)
                Text("FuelNerve protects operational changes with verified workflows and owner confirmation.")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 18)
            }
            .padding(18).padding(.bottom, 24)
        }
        .background(FuelNerveTheme.canvas.ignoresSafeArea())
        .navigationTitle("Settings")
    }

    private var profileHeader: some View {
        HStack(spacing: 15) {
            Text(initials).font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                .frame(width: 62, height: 62).background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 19))
            VStack(alignment: .leading, spacing: 4) {
                Text("FUELNERVE \(session.role?.rawValue ?? "ACCOUNT")").font(.caption2.bold()).tracking(1.1).foregroundStyle(FuelNerveTheme.lime)
                Text(session.user?.name ?? "FuelNerve user").font(.title2.bold()).foregroundStyle(.white)
                Text(session.organization?.name ?? "").font(.caption).foregroundStyle(.white.opacity(0.68))
            }
            Spacer()
            Image(systemName: session.hasIntelligence ? "sparkles" : "checkmark.shield.fill").foregroundStyle(FuelNerveTheme.lime)
        }
        .padding(20).background(LinearGradient(colors: [FuelNerveTheme.forest, FuelNerveTheme.green.opacity(0.9)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
    }

    private func settingsCard<Content: View>(title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            Label(title, systemImage: symbol).font(.caption.bold()).tracking(1).foregroundStyle(FuelNerveTheme.green)
            content()
        }
        .padding(18).background(.white, in: RoundedRectangle(cornerRadius: 21))
        .overlay(RoundedRectangle(cornerRadius: 21).stroke(FuelNerveTheme.forest.opacity(0.055)))
    }

    private func settingRow(_ label: String, _ value: String, symbol: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(FuelNerveTheme.green).frame(width: 24)
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest).multilineTextAlignment(.trailing)
        }.padding(.vertical, 2)
    }

    private var initials: String {
        (session.user?.name ?? "FuelNerve").split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    private var accessLabel: String {
        if session.capabilities.canCaptureInvoices { return "Reviewed actions" }
        if session.capabilities.readOnly { return "Read-only" }
        return "Operational"
    }
}
