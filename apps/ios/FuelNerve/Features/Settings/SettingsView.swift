import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var signingOut = false

    var body: some View {
        Form {
            Section("Account") {
                LabeledContent("Name", value: session.user?.name ?? "—")
                LabeledContent("Email", value: session.user?.email ?? "—")
                LabeledContent("Organization", value: session.user?.organization.name ?? "—")
            }
            Section("FuelNerve") {
                LabeledContent("Environment", value: session.environment.name.rawValue.capitalized)
                LabeledContent("Access", value: session.capabilities.canCaptureInvoices ? "Read-first · reviewed actions" : (session.capabilities.readOnly ? "Read-only" : "Operational"))
            }
            Section {
                Button(signingOut ? "Signing out…" : "Sign out", role: .destructive) {
                    signingOut = true
                    Task { await session.logout(); signingOut = false }
                }.disabled(signingOut)
            }
        }.navigationTitle("Settings")
    }
}
