import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct AskView: View {
    @Environment(AppSession.self) private var session
    @State private var question = ""
    @State private var answer: FuelNerveAnswer?
    @State private var asking = false
    @State private var message: String?
    @State private var answerStationId: String?
    @State private var answerUpdatedAt: Date?
    @State private var staleAnswer = false
    @State private var invoiceDocument: InvoiceSourceDocument?
    @State private var selectedInvoicePhoto: PhotosPickerItem?
    @State private var showingInvoiceChoices = false
    @State private var choosingInvoicePhoto = false
    @State private var choosingInvoiceFile = false
    @State private var loadingInvoice = false
    private let suggestions = ["How is stock today?", "Are any shifts still open?", "What is today’s profit?", "Who owes us money?"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    AskHeader()

                    if answer == nil {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Try asking").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                            LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 10) {
                                ForEach(Array(suggestions.enumerated()), id: \.element) { index, suggestion in
                                    Button { question = suggestion } label: {
                                        VStack(alignment: .leading, spacing: 10) {
                                            Image(systemName: suggestionSymbol(index)).foregroundStyle(FuelNerveTheme.green)
                                            Text(suggestion).font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest).multilineTextAlignment(.leading)
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 74, alignment: .leading)
                                        .padding(14)
                                        .background(.white, in: RoundedRectangle(cornerRadius: 16))
                                    }.buttonStyle(.plain)
                                }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text(answer == nil ? "Ask Nerve" : "Ask a follow-up").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                        HStack(alignment: .bottom, spacing: 10) {
                            if canCaptureInvoice {
                                Button { showingInvoiceChoices = true } label: {
                                    Group {
                                        if loadingInvoice { ProgressView().tint(FuelNerveTheme.green) }
                                        else { Image(systemName: "plus").font(.title3.weight(.semibold)) }
                                    }
                                    .frame(width: 48, height: 48)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(FuelNerveTheme.green)
                                .background(.white, in: Circle())
                                .overlay(Circle().stroke(FuelNerveTheme.green.opacity(0.2)))
                                .disabled(loadingInvoice)
                                .accessibilityLabel("Add purchase invoice")
                            }
                            TextField("What would you like to understand?", text: $question, axis: .vertical)
                                .lineLimit(1...4).padding(.horizontal, 14).padding(.vertical, 12)
                                .background(.white, in: RoundedRectangle(cornerRadius: 16))
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(FuelNerveTheme.green.opacity(0.18)))
                                .submitLabel(.send).onSubmit { if canAsk { ask() } }
                            Button { ask() } label: {
                                Group { if asking { ProgressView().tint(.white) } else { Image(systemName: "arrow.up").font(.headline) } }
                                    .frame(width: 48, height: 48)
                            }
                            .buttonStyle(.plain).foregroundStyle(.white)
                            .background(canAsk ? FuelNerveTheme.green : Color.gray.opacity(0.25), in: Circle())
                            .disabled(!canAsk)
                            .accessibilityLabel("Send question")
                        }
                        Label("Nerve can review and explain. Only you can make changes.", systemImage: "lock.shield")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                        if let message { Text(message).font(.callout).foregroundStyle(.red) }
                        if staleAnswer, let answerUpdatedAt { StaleDataNotice(updatedAt: answerUpdatedAt) { ask() } }
                        if let answer { AnswerView(response: answer) { followUp in ask(followUp, preserveSnapshot: true) } }
                }.padding(.horizontal, 18).padding(.bottom, 28)
            }
            .background(FuelNerveTheme.canvas.ignoresSafeArea())
            .navigationTitle("Ask")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .sheet(isPresented: $showingInvoiceChoices) {
                InvoiceSourcePicker {
                    showingInvoiceChoices = false
                    choosingInvoicePhoto = true
                } chooseFile: {
                    showingInvoiceChoices = false
                    choosingInvoiceFile = true
                } dismiss: {
                    showingInvoiceChoices = false
                }
                .presentationDetents([.height(360)])
                .fuelNerveSheet()
            }
            .photosPicker(isPresented: $choosingInvoicePhoto, selection: $selectedInvoicePhoto, matching: .images)
            .onChange(of: session.selectedStationId) { _, stationId in if answerStationId != stationId { answer = nil; staleAnswer = false; message = nil } }
            .onChange(of: selectedInvoicePhoto) { _, item in
                guard let item else { return }
                loadingInvoice = true
                Task {
                    defer { loadingInvoice = false; selectedInvoicePhoto = nil }
                    guard let data = try? await item.loadTransferable(type: Data.self) else { message = "FuelNerve could not open that image."; return }
                    let type = item.supportedContentTypes.first
                    invoiceDocument = .init(fileName: "invoice.\(type?.preferredFilenameExtension ?? "jpg")", mimeType: type?.preferredMIMEType ?? "image/jpeg", data: data)
                }
            }
            .fileImporter(isPresented: $choosingInvoiceFile, allowedContentTypes: [.pdf, .jpeg, .png, .heic], allowsMultipleSelection: false) { result in
                do {
                    guard let url = try result.get().first else { return }
                    let accessed = url.startAccessingSecurityScopedResource()
                    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                    let data = try Data(contentsOf: url)
                    invoiceDocument = .init(fileName: url.lastPathComponent, mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream", data: data)
                } catch { message = "FuelNerve could not open that invoice file." }
            }
            .sheet(item: $invoiceDocument) { document in
                InvoiceReviewView(document: document) { invoiceDocument = nil }
                    .fuelNerveSheet()
            }
        }
    }

    private var canCaptureInvoice: Bool {
        !session.isDemoReadOnly && session.capabilities.canCaptureInvoices && [.owner, .manager, .accountant].contains(session.role)
    }
    private var canAsk: Bool { question.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 && !asking }
    private func suggestionSymbol(_ index: Int) -> String { ["cylinder.split.1x2", "clock", "chart.line.uptrend.xyaxis", "person.2"][index % 4] }

    private func ask(_ requestedQuestion: String? = nil, preserveSnapshot: Bool = false) {
        let value = (requestedQuestion ?? question).trimmingCharacters(in: .whitespacesAndNewlines)
        let requestId = UUID()
        asking = true; message = nil; staleAnswer = false
        Task {
            do { answer = try await session.askService.ask(value, stationId: session.selectedStationId, requestId: requestId, asOf: preserveSnapshot ? answer?.snapshotDate : nil); answerStationId = session.selectedStationId; answerUpdatedAt = .now; staleAnswer = false }
            catch APIError.server(let status, let code, let serverMessage) {
                staleAnswer = answer != nil
                switch code {
                case "INTELLIGENCE_PLAN_REQUIRED": message = "Ask FuelNerve is available with Core + Intelligence."
                case "STATION_ACCESS_DENIED": message = "This station is no longer available. FuelNerve has returned to an authorized station."
                case "ASK_LIMIT_REACHED", "RATE_LIMITED": message = "This month’s question allowance has been used."
                default: message = status == 429 ? "Please wait a moment before asking again." : serverMessage ?? "That question is outside the supported station topics. Try sales, stock, collections, profit, shifts, customers or suppliers."
                }
            }
            catch { session.handleAuthenticationFailure(error); staleAnswer = answer != nil; message = "FuelNerve could not answer right now. Your previous verified answer remains visible." }
            asking = false
        }
    }
}

private struct InvoiceSourcePicker: View {
    let choosePhoto: () -> Void
    let chooseFile: () -> Void
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: "doc.viewfinder.fill").font(.title2).foregroundStyle(FuelNerveTheme.forest)
                    .frame(width: 52, height: 52).background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 16))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Add purchase invoice").font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                    Text("Choose how you want FuelNerve to read it.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: dismiss) { Image(systemName: "xmark").frame(width: 38, height: 38).background(.white, in: Circle()) }
                    .foregroundStyle(FuelNerveTheme.forest).accessibilityLabel("Close invoice choices")
            }
            sourceButton("Take or choose a photo", detail: "Best for a paper invoice", symbol: "camera.fill", action: choosePhoto)
            sourceButton("Choose PDF or image", detail: "Open a document from Files", symbol: "doc.fill", action: chooseFile)
            Label("The document is checked before any record can change.", systemImage: "checkmark.shield.fill")
                .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
        }.padding(20)
    }

    private func sourceButton(_ title: String, detail: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: symbol).foregroundStyle(FuelNerveTheme.green).frame(width: 42, height: 42).background(FuelNerveTheme.green.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) { Text(title).font(.subheadline.bold()); Text(detail).font(.caption).foregroundStyle(.secondary) }
                Spacer(); Image(systemName: "chevron.right").foregroundStyle(FuelNerveTheme.green)
            }.foregroundStyle(FuelNerveTheme.forest).padding(13).background(.white, in: RoundedRectangle(cornerRadius: 17))
        }.buttonStyle(.plain)
    }
}

extension InvoiceSourceDocument: Identifiable { var id: String { "\(fileName)-\(data.count)-\(data.hashValue)" } }

private struct AskHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles").font(.title2).foregroundStyle(FuelNerveTheme.forest)
                    .frame(width: 48, height: 48).background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 15))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nerve Assistant").font(.title2.bold())
                    Text("Your read-only business guide").font(.subheadline).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
            }
            Text("What would you like to understand?").font(.title3.weight(.semibold))
            HStack(spacing: 8) {
                StationScopePicker().padding(.horizontal, 12).padding(.vertical, 8).background(.white.opacity(0.12), in: Capsule())
                Label("Verified records", systemImage: "checkmark.shield").font(.caption.weight(.semibold)).padding(.horizontal, 12).padding(.vertical, 8).background(.white.opacity(0.12), in: Capsule())
            }
        }
        .foregroundStyle(.white).padding(20)
        .background(LinearGradient(colors: [FuelNerveTheme.forest, Color(red: 0.03, green: 0.34, blue: 0.25)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
    }
}

private struct AnswerView: View {
    let response: FuelNerveAnswer
    let followUp: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Label(response.answerMode == "AI_EXPLAINED" ? "NERVE ASSISTANT" : "VERIFIED ANSWER", systemImage: "sparkles").font(.caption.bold()).foregroundStyle(FuelNerveTheme.green); Spacer(); Text("\(response.usage.remaining) left").font(.caption).foregroundStyle(.secondary) }
            Text(response.answer.title).font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
            if let snapshot = response.snapshotDate {
                Label("One station · Records as of \(snapshotLabel(snapshot))", systemImage: "clock")
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            if response.inconsistentSnapshot == true {
                notice("Record dates do not agree. Refresh before relying on this answer.", color: .red)
            } else if response.stale == true {
                notice("Some records are out of date. Refresh for the latest position.", color: FuelNerveTheme.gold)
            }
            if let missing = response.missingInformation, !missing.isEmpty {
                notice("Information is unavailable from: \(missing.joined(separator: ", ")).", color: FuelNerveTheme.gold)
            }
            Text(response.answer.explanation).foregroundStyle(.secondary)
            Text(response.answer.action).font(.headline).foregroundStyle(FuelNerveTheme.forest)
            ForEach(Array(response.answer.facts.prefix(3))) { fact in
                VStack(alignment: .leading, spacing: 6) {
                    HStack { if fact.priorityRank == 1 { Text("REVIEW FIRST").font(.caption2.bold()).foregroundStyle(FuelNerveTheme.green) }; Text(fact.label).font(.subheadline.weight(.semibold)); Spacer(); Text(fact.value).font(.headline).foregroundStyle(FuelNerveTheme.gold) }
                    Text(fact.context).font(.caption).foregroundStyle(.secondary)
                    if let reason = fact.priorityReason, fact.priorityRank == 1 { Text("Why first: \(reason)").font(.caption.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest) }
                }.padding().background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 14))
            }
            if response.answer.facts.count > 3 { Text("\(response.answer.facts.count - 3) more verified items").font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
            if let choices = response.supportedFollowUps, !choices.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Ask about this snapshot").font(.caption.bold()).foregroundStyle(.secondary)
                    ForEach(choices, id: \.self) { choice in
                        Button { followUp(choice) } label: { HStack { Text(choice); Spacer(); Image(systemName: choice == "Show the records" ? "doc.text.magnifyingglass" : "chevron.right") }.frame(maxWidth: .infinity, alignment: .leading) }
                            .buttonStyle(.bordered).tint(FuelNerveTheme.green)
                    }
                }
            }
        }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 22)).overlay(RoundedRectangle(cornerRadius: 22).stroke(FuelNerveTheme.green.opacity(0.1)))
    }
    private func notice(_ text: String, color: Color) -> some View { Label(text, systemImage: "exclamationmark.triangle.fill").font(.caption.weight(.semibold)).foregroundStyle(color).padding(10).frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 12)) }
    private func snapshotLabel(_ value: String) -> String { guard let date = ISO8601DateFormatter().date(from: value) else { return value }; return date.formatted(date: .abbreviated, time: .shortened) }
}
