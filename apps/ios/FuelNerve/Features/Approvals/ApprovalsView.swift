import SwiftUI

struct ApprovalsView: View {
    @Environment(AppSession.self) private var session
    @State private var approvals: [OwnerApproval] = []
    @State private var selected: OwnerApproval?
    @State private var loading = true
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ZStack {
                FuelNerveTheme.canvas.ignoresSafeArea()
                if loading { ProgressView() }
                else if approvals.isEmpty { ContentUnavailableView("Nothing waiting", systemImage: "checkmark.shield", description: Text("Exceptional actions will appear here before they can change stock or money.")) }
                else { ScrollView { LazyVStack(spacing: 14) { ForEach(approvals) { card($0) } }.padding() } }
            }
            .navigationTitle("Owner approvals")
            .refreshable { await load() }
            .task { await load() }
            .sheet(item: $selected) { approval in
                ApprovalDecisionSheet(approval: approval, intelligenceEnabled: session.hasIntelligence, dismiss: { selected = nil }) { sellingPrice, effectiveFrom in
                    await approve(approval, sellingPrice: sellingPrice, effectiveFrom: effectiveFrom)
                }
            }
        }
    }

    private func card(_ approval: OwnerApproval) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Label(approval.isPriceChange ? "PRICE CHANGE" : "STOCK ADJUSTMENT", systemImage: approval.isPriceChange ? "indianrupeesign" : "checkmark.shield").font(.caption.bold()).foregroundStyle(FuelNerveTheme.green); Spacer(); Text("Waiting").font(.caption.bold()).padding(.horizontal, 10).padding(.vertical, 5).background(.orange.opacity(0.14), in: Capsule()).foregroundStyle(.orange) }
            Text(approval.isPriceChange ? "\(approval.evidence.product.code) purchase and selling prices" : "\(approval.evidence.product.code) · \(approval.evidence.tank?.code ?? "General stock")").font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
            Text(approval.station.name).font(.subheadline).foregroundStyle(.secondary)
            if approval.isPriceChange {
                HStack { price("Current purchase", approval.evidence.currentPurchasePrice); Image(systemName: "arrow.right").foregroundStyle(.secondary); price("Invoice purchase", approval.evidence.proposedPurchasePrice) }
            } else {
                HStack { value("Book stock", approval.evidence.bookStockBefore ?? 0); Image(systemName: "arrow.right").foregroundStyle(.secondary); value("After approval", approval.evidence.proposedBookStock ?? 0) }
            }
            Divider()
            Text(approval.reason)
            Text("Requested by \(approval.requestedBy.name)").font(.caption).foregroundStyle(.secondary)
            EvidenceLink(label: "Review inventory evidence", path: approval.evidence.evidencePath)
            Button("Review decision") { selected = approval }
                .buttonStyle(.borderedProminent).tint(FuelNerveTheme.forest)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 22))
    }

    private func value(_ label: String, _ amount: Double) -> some View {
        VStack(alignment: .leading) { Text(label).font(.caption).foregroundStyle(.secondary); Text("\(amount.formatted()) L").font(.headline) }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func price(_ label: String, _ amount: Double?) -> some View {
        VStack(alignment: .leading) { Text(label).font(.caption).foregroundStyle(.secondary); Text((amount ?? 0).formatted(.currency(code: "INR"))).font(.headline) }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func load() async { loading = true; defer { loading = false }; do { approvals = try await session.approvalService.approvals(); message = nil } catch { message = "Approvals could not be loaded." } }
    private func approve(_ approval: OwnerApproval, sellingPrice: Double?, effectiveFrom: Date?) async -> Bool {
        do {
            _ = try await session.approvalService.decide(id: approval.id, approve: true, note: "", version: approval.version, sellingPrice: sellingPrice, sellingPriceEffectiveFrom: effectiveFrom)
            approvals.removeAll { $0.id == approval.id }
            return true
        } catch APIError.server(let status, _, _) where status == 409 {
            message = "This request changed or was already reviewed. The list has been refreshed."
            await load()
            return false
        } catch {
            session.handleAuthenticationFailure(error)
            message = "The decision was not saved. No stock or money was changed."
            return false
        }
    }
}
