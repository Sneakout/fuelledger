import SwiftUI

struct CoreNotificationPopup: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL

    let alert: OwnerAlert
    let acknowledge: () async -> Bool
    let remindLater: () -> Void

    @State private var saving = false
    @State private var errorMessage: String?

    private var actions: Set<String> { Set(alert.packet?.availableActions ?? ["ACKNOWLEDGE", "VIEW_RECORD"]) }
    private var accent: Color {
        alert.severity == .urgent ? .red : alert.severity == .attention ? FuelNerveTheme.gold : FuelNerveTheme.green
    }

    var body: some View {
        ZStack {
            FuelNerveTheme.forest.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 28)
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("FUELNERVE")
                                .font(.caption.weight(.black)).tracking(2).foregroundStyle(FuelNerveTheme.green)
                            Text("Owner notification")
                                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(action: remindLater) {
                            Image(systemName: "xmark").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                                .frame(width: 42, height: 42).background(FuelNerveTheme.canvas, in: Circle())
                        }
                        .accessibilityLabel("Close and remind me later")
                    }

                    HStack(spacing: 12) {
                        Image(systemName: alert.severity == .urgent ? "exclamationmark" : "bell.fill")
                            .font(.title3.bold()).foregroundStyle(accent)
                            .frame(width: 48, height: 48).background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 15))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(alert.stationName ?? alert.packet?.station.name ?? "Your fuel station")
                                .font(.caption.weight(.bold)).foregroundStyle(.secondary)
                            Text(alert.createdAt, format: .dateTime.day().month(.wide).year())
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }

                    Text(alert.detail)
                        .font(.title2.weight(.bold)).foregroundStyle(FuelNerveTheme.forest)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(alert.detail)

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                            .font(.callout).foregroundStyle(.red)
                    }

                    VStack(spacing: 11) {
                        if actions.contains("ACKNOWLEDGE") {
                            Button {
                                Task { await saveAcknowledgement() }
                            } label: {
                                HStack { if saving { ProgressView().tint(.white) }; Text(saving ? "Saving…" : "OK") }
                                    .font(.headline).frame(maxWidth: .infinity).frame(height: 52)
                            }
                            .buttonStyle(.plain).foregroundStyle(.white)
                            .background(FuelNerveTheme.forest, in: RoundedRectangle(cornerRadius: 16))
                            .disabled(saving)
                        }

                        if actions.contains("VIEW_RECORD"), let destination = session.environment.evidenceURL(for: alert.evidencePath) {
                            Button {
                                openURL(destination)
                            } label: {
                                Label("Show supporting record", systemImage: "doc.text.magnifyingglass")
                                    .font(.headline).frame(maxWidth: .infinity).frame(height: 50)
                            }
                            .buttonStyle(.plain).foregroundStyle(FuelNerveTheme.green)
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(FuelNerveTheme.green.opacity(0.35)))
                            .accessibilityHint("Opens the supporting FuelNerve record. You may need to sign in on the web.")
                        }

                        if actions.contains("REMIND_LATER") {
                            Button("Remind me later", action: remindLater)
                                .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 3)
                        }
                    }

                    Label("This message comes from verified FuelNerve records.", systemImage: "checkmark.shield")
                        .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }
                .padding(24).background(.white, in: RoundedRectangle(cornerRadius: 30))
                .padding(.horizontal, 20)
                Spacer(minLength: 28)
            }
        }
        .interactiveDismissDisabled(saving)
    }

    @MainActor
    private func saveAcknowledgement() async {
        guard !saving else { return }
        saving = true; errorMessage = nil
        if await acknowledge() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        else { errorMessage = "FuelNerve could not save this. Please try again." }
        saving = false
    }
}
