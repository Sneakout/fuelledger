import SwiftUI

struct IntelligenceNotificationPopup: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL

    let alert: OwnerAlert
    let acknowledge: () async -> Bool
    let remindLater: () -> Void

    @State private var answer: ContextAnswer?
    @State private var preparedDraft: String?
    @State private var saving = false

    private var packet: OwnerAlert.NotificationPacket { alert.packet! }
    private var agent: OwnerAlert.NotificationPacket.Agent { packet.responsibleAgent! }
    private var actions: Set<String> { Set(packet.availableActions) }

    var body: some View {
        ZStack {
            FuelNerveTheme.forest.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top, spacing: 13) {
                        Image(systemName: symbol)
                            .font(.title2).foregroundStyle(FuelNerveTheme.forest)
                            .frame(width: 54, height: 54).background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 17))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(agent.name).font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                            Text(agent.responsibility).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(action: remindLater) {
                            Image(systemName: "xmark").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                                .frame(width: 42, height: 42).background(FuelNerveTheme.canvas, in: Circle())
                        }.accessibilityLabel("Close and remind me later")
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("What I found").font(.caption.bold()).tracking(1.2).foregroundStyle(FuelNerveTheme.green)
                        Text(alert.detail).font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("This is based on FuelNerve's verified records for \(packet.station.name).")
                            .font(.caption).foregroundStyle(.secondary)
                    }

                    if actions.contains("GIVE_DETAILS") || actions.contains("VIEW_RECORD") || actions.contains("COMPARE_RECORDS") || actions.contains("PREPARE_DRAFT") {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("What would you like me to do?").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                            if actions.contains("GIVE_DETAILS") {
                                commandButton("Give me details", symbol: "text.magnifyingglass") { answer = detailAnswer }
                            }
                            if actions.contains("VIEW_RECORD"), let destination = session.environment.evidenceURL(for: alert.evidencePath) {
                                commandButton("Show supporting record", symbol: "doc.text.magnifyingglass") { openURL(destination) }
                            }
                            if actions.contains("COMPARE_RECORDS") {
                                commandButton("Compare records", symbol: "rectangle.2.swap") { answer = comparisonAnswer }
                            }
                            if actions.contains("PREPARE_DRAFT") {
                                commandButton("Prepare draft", symbol: "square.and.pencil") { preparedDraft = draftText }
                            }
                        }
                    }

                    if let answer {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(answer.title).font(.caption.bold()).foregroundStyle(FuelNerveTheme.green)
                            Text(answer.text).font(.body).foregroundStyle(FuelNerveTheme.forest)
                        }
                        .padding(15).frame(maxWidth: .infinity, alignment: .leading)
                        .background(FuelNerveTheme.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 17))
                    }

                    if let preparedDraft {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Draft only", systemImage: "doc.badge.clock").font(.caption.bold()).foregroundStyle(FuelNerveTheme.gold)
                            Text(preparedDraft).font(.body).foregroundStyle(FuelNerveTheme.forest)
                            Text("Nothing has been sent or changed.").font(.caption).foregroundStyle(.secondary)
                            if actions.contains("SUBMIT_PROPOSAL") {
                                Text("Proposal submission is unavailable until its server workflow is enabled.")
                                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            }
                        }
                        .padding(15).frame(maxWidth: .infinity, alignment: .leading)
                        .background(FuelNerveTheme.gold.opacity(0.08), in: RoundedRectangle(cornerRadius: 17))
                    }

                    VStack(spacing: 11) {
                        if actions.contains("ACKNOWLEDGE") {
                            Button(saving ? "Saving…" : "OK") { Task { await save() } }
                                .font(.headline).foregroundStyle(FuelNerveTheme.green)
                                .frame(maxWidth: .infinity).frame(height: 49)
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(FuelNerveTheme.green.opacity(0.35)))
                                .disabled(saving)
                        }
                        if actions.contains("REMIND_LATER") {
                            Button("Remind me later", action: remindLater).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }
                    }

                    Label("Nerve can review and explain. Only you can make changes.", systemImage: "lock.shield")
                        .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }
                .padding(22).background(.white, in: RoundedRectangle(cornerRadius: 30)).padding(20)
            }
        }
        .interactiveDismissDisabled(saving)
    }

    private struct ContextAnswer { let title: String; let text: String }

    private func commandButton(_ label: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack { Image(systemName: symbol).frame(width: 24); Text(label); Spacer(); Image(systemName: "chevron.right") }
                .font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest)
                .padding(13).background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 14))
        }.buttonStyle(.plain)
    }

    private var detailAnswer: ContextAnswer {
        let waiting = packet.daysOverdueOrWaiting.map { " It has been waiting for \($0) \($0 == 1 ? "day" : "days")." } ?? ""
        let value = packet.amount.map { " The recorded amount is \($0.value.rupees)." }
            ?? packet.quantity.map { " The recorded quantity is \($0.value.formatted(.number.precision(.fractionLength(0...3)))) \($0.unit ?? "units")." } ?? ""
        return ContextAnswer(title: "Details from \(agent.name)", text: "\(packet.subjectName) is currently marked \(plainStatus).\(value)\(waiting) I cannot infer a cause from this notification alone.")
    }

    private var comparisonAnswer: ContextAnswer {
        let labels = packet.evidence.map(\.label)
        return ContextAnswer(title: "Records compared", text: "I compared \(humanList(labels)). They support the recorded status: \(plainStatus). This comparison does not establish why it happened.")
    }

    private var draftText: String {
        "Please review \(packet.subjectName) at \(packet.station.name). FuelNerve currently records it as \(plainStatus)."
    }

    private func humanList(_ values: [String]) -> String {
        guard let last = values.last else { return "no records" }
        if values.count == 1 { return last }
        return values.dropLast().joined(separator: ", ") + " and " + last
    }

    private var plainStatus: String { packet.status.lowercased().replacingOccurrences(of: "_", with: " ") }
    private var symbol: String {
        switch agent.key {
        case "reconciliation-review": "checkmark.seal"
        case "inventory-watch": "drop.triangle"
        case "receivables-watch": "indianrupeesign.circle"
        case "purchase-check": "doc.text.magnifyingglass"
        case "profit-insight": "chart.line.uptrend.xyaxis"
        default: "sparkles"
        }
    }

    @MainActor private func save() async {
        saving = true
        if await acknowledge() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        saving = false
    }
}

extension OwnerAlert {
    var hasKnownIntelligenceAgent: Bool {
        guard let key = packet?.responsibleAgent?.key else { return false }
        return ["reconciliation-review", "inventory-watch", "receivables-watch", "purchase-check", "profit-insight", "owner-assistant"].contains(key)
    }
}
