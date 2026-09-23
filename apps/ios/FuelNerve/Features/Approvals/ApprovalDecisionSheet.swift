import SwiftUI

struct ApprovalDecisionSheet: View {
    let approval: OwnerApproval
    let intelligenceEnabled: Bool
    let dismiss: () -> Void
    let approve: (Double?, Date?) async -> Bool

    @State private var approving = false
    @State private var approved = false
    @State private var message: String?
    @State private var sellingPrice: Double
    @State private var sellingEffectiveDate: Date

    init(approval: OwnerApproval, intelligenceEnabled: Bool, dismiss: @escaping () -> Void, approve: @escaping (Double?, Date?) async -> Bool) {
        self.approval = approval
        self.intelligenceEnabled = intelligenceEnabled
        self.dismiss = dismiss
        self.approve = approve
        _sellingPrice = State(initialValue: approval.evidence.suggestedSellingPrice ?? approval.payload.suggestedSellingPrice ?? 0)
        let purchaseDate = approval.evidence.purchaseEffectiveFrom ?? approval.payload.purchaseEffectiveFrom ?? .now
        _sellingEffectiveDate = State(initialValue: max(.now, purchaseDate))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Capsule().fill(Color.secondary.opacity(0.28)).frame(width: 42, height: 5).frame(maxWidth: .infinity)
                header
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.title.bold()).foregroundStyle(FuelNerveTheme.forest)
                    Text("\(approval.station.name) · Requested \(approval.requestedAt, style: .relative)").font(.subheadline).foregroundStyle(.secondary)
                }
                Divider()
                VStack(alignment: .leading, spacing: 7) {
                    Label("Why this needs your decision", systemImage: "doc.text").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                    Text(approval.reason).foregroundStyle(.secondary)
                    Text("Requested by \(approval.requestedBy.name)").font(.caption).foregroundStyle(.secondary)
                }
                if approval.isPriceChange { priceDecision } else { inventoryDecision }
                HStack {
                    Label("Supporting records checked", systemImage: "checkmark.circle").font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                    EvidenceLink(label: "View evidence", path: approval.evidence.evidencePath)
                }.padding(14).background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 16))

                if approved {
                    Label(approval.isPriceChange ? "Purchase and selling prices updated" : "Approved for later execution", systemImage: "checkmark.circle.fill")
                        .font(.headline).foregroundStyle(FuelNerveTheme.green).frame(maxWidth: .infinity).padding(16)
                        .background(FuelNerveTheme.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 18))
                } else {
                    SwipeToApproveControl(
                        working: approving,
                        enabled: !approval.isPriceChange || priceConfirmationValid,
                        label: approval.isPriceChange ? "Swipe right to update both prices" : "Swipe right to approve request",
                        accessibilityLabel: approval.isPriceChange ? "Approve purchase and selling price change" : "Approve inventory adjustment request",
                        accessibilityHint: approval.isPriceChange ? "Writes both price records with their effective dates." : "Records approval only. Inventory will not change."
                    ) { await submit() }
                }
                if let message { Label(message, systemImage: "exclamationmark.circle.fill").font(.callout).foregroundStyle(.red) }
                Label("Close to decide later. This request stays in Alerts.", systemImage: "bell").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                Label(approval.isPriceChange ? "FuelNerve rechecks current prices and updates both histories together." : "FuelNerve rechecks the latest records before approval. No inventory change is executed.", systemImage: "lock.shield")
                    .font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            }.padding(20)
        }
        .background(FuelNerveTheme.canvas).interactiveDismissDisabled(approving).presentationDetents([.large]).fuelNerveSheet()
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: approval.isPriceChange ? "indianrupeesign" : "cylinder.split.1x2.fill")
                .font(.title2).foregroundStyle(FuelNerveTheme.forest).frame(width: 56, height: 56)
                .background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 17))
            VStack(alignment: .leading, spacing: 5) {
                Text(approval.isPriceChange ? (intelligenceEnabled ? "Purchase Agent" : "Price review") : (intelligenceEnabled ? "Stock Agent" : "Inventory review"))
                    .font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                Label("Decision needed", systemImage: "exclamationmark.circle.fill").font(.caption.weight(.bold)).foregroundStyle(FuelNerveTheme.gold)
                    .padding(.horizontal, 10).padding(.vertical, 6).background(FuelNerveTheme.gold.opacity(0.12), in: Capsule())
            }
            Spacer()
            Button(action: dismiss) { Image(systemName: "xmark").font(.headline).foregroundStyle(FuelNerveTheme.forest).frame(width: 42, height: 42).background(FuelNerveTheme.canvas, in: Circle()) }
                .disabled(approving).accessibilityLabel("Close and decide later")
        }
    }

    private var inventoryDecision: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Proposed result", systemImage: "chart.bar.fill").font(.subheadline.bold()).foregroundStyle(FuelNerveTheme.green)
            Text("Book stock").font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Text((approval.evidence.bookStockBefore ?? 0).litres)
                Image(systemName: "arrow.right").foregroundStyle(FuelNerveTheme.green)
                Text((approval.evidence.proposedBookStock ?? 0).litres)
            }.font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
            Text("Approving records your decision only. Stock will not change.").font(.subheadline).foregroundStyle(.secondary)
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(FuelNerveTheme.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 18))
    }

    private var priceDecision: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Label("Purchase price found on invoice", systemImage: "doc.text.magnifyingglass").font(.subheadline.bold()).foregroundStyle(FuelNerveTheme.green)
                priceRow("Current", approval.evidence.currentPurchasePrice ?? 0, "New", approval.evidence.proposedPurchasePrice ?? approval.payload.proposedPurchasePrice ?? 0)
                if let invoice = approval.evidence.invoice {
                    Text("Invoice \(invoice.invoiceNumber) · \(invoice.quantity.formatted(.number.precision(.fractionLength(0...2)))) \(approval.evidence.product.unit.lowercased()) · total \(invoice.totalAmount.formatted(.currency(code: "INR")))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let date = approval.evidence.purchaseEffectiveFrom ?? approval.payload.purchaseEffectiveFrom {
                    Text("Purchase price effective \(date.formatted(date: .long, time: .omitted))").font(.caption.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest)
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                Text("Confirm the retail selling price").font(.headline).foregroundStyle(FuelNerveTheme.forest)
                Text("FuelNerve suggested a price that keeps the previous rupee margin. Change it if your approved retail price is different.").font(.caption).foregroundStyle(.secondary)
                TextField("New selling price", value: $sellingPrice, format: .currency(code: "INR")).keyboardType(.decimalPad).textFieldStyle(.roundedBorder)
                DatePicker("Selling price effective", selection: $sellingEffectiveDate, in: minimumSellingEffectiveDate..., displayedComponents: .date)
                    .fuelNervePickerField()
                if !priceConfirmationValid { Label(priceValidationMessage, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.red) }
            }
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(FuelNerveTheme.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 18))
    }

    private func priceRow(_ leftLabel: String, _ left: Double, _ rightLabel: String, _ right: Double) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading) { Text(leftLabel).font(.caption).foregroundStyle(.secondary); Text(left.formatted(.currency(code: "INR"))).font(.title3.bold()) }
            Image(systemName: "arrow.right").foregroundStyle(FuelNerveTheme.green)
            VStack(alignment: .leading) { Text(rightLabel).font(.caption).foregroundStyle(.secondary); Text(right.formatted(.currency(code: "INR"))).font(.title3.bold()) }
        }.foregroundStyle(FuelNerveTheme.forest)
    }

    private var title: String {
        if approval.isPriceChange { return "Confirm \(approval.evidence.product.code) purchase and selling prices" }
        let amount = (approval.payload.quantityDelta ?? 0).formatted(.number.precision(.fractionLength(0...2)))
        return "Adjust \(approval.evidence.product.code) \(approval.evidence.tank.map { "Tank \($0.code)" } ?? "stock") by \(amount) L"
    }

    private var priceConfirmationValid: Bool {
        guard approval.isPriceChange else { return true }
        let oldSelling = approval.evidence.currentSellingPrice ?? 0
        let newPurchase = approval.evidence.proposedPurchasePrice ?? approval.payload.proposedPurchasePrice ?? 0
        return sellingPrice > 0 && abs(sellingPrice - oldSelling) >= 0.01 && sellingPrice >= newPurchase
    }

    private var minimumSellingEffectiveDate: Date {
        approval.evidence.purchaseEffectiveFrom ?? approval.payload.purchaseEffectiveFrom ?? .distantPast
    }

    private var priceValidationMessage: String {
        let oldSelling = approval.evidence.currentSellingPrice ?? 0
        let newPurchase = approval.evidence.proposedPurchasePrice ?? approval.payload.proposedPurchasePrice ?? 0
        if abs(sellingPrice - oldSelling) < 0.01 { return "Confirm a changed selling price before swiping." }
        if sellingPrice < newPurchase { return "Selling price cannot be below the new purchase price." }
        return "Enter the new selling price."
    }

    @MainActor private func submit() async -> Bool {
        guard !approving, !approval.isPriceChange || priceConfirmationValid else { return false }
        approving = true; message = nil
        let success = await approve(approval.isPriceChange ? sellingPrice : nil, approval.isPriceChange ? sellingEffectiveDate : nil)
        approving = false
        if success { approved = true; UINotificationFeedbackGenerator().notificationOccurred(.success); try? await Task.sleep(for: .milliseconds(650)); dismiss() }
        else { message = "This request could not be approved. No records were changed." }
        return success
    }
}

private struct SwipeToApproveControl: View {
    let working: Bool
    let enabled: Bool
    let label: String
    let accessibilityLabel: String
    let accessibilityHint: String
    let onApprove: () async -> Bool
    @State private var drag: CGFloat = 0
    @State private var submitted = false

    var body: some View {
        GeometryReader { proxy in
            let thumb: CGFloat = 58
            let maximum = max(0, proxy.size.width - thumb - 8)
            ZStack(alignment: .leading) {
                Capsule().fill(FuelNerveTheme.green.opacity(enabled ? 0.09 : 0.04))
                Text(working ? "Checking latest records…" : label).font(.subheadline.bold()).foregroundStyle(enabled ? FuelNerveTheme.forest : .secondary).frame(maxWidth: .infinity)
                HStack(spacing: 3) { Image(systemName: "chevron.right"); Image(systemName: "chevron.right") }.font(.caption.bold()).foregroundStyle(FuelNerveTheme.green.opacity(0.35)).padding(.trailing, 18).frame(maxWidth: .infinity, alignment: .trailing)
                Circle().fill(enabled ? FuelNerveTheme.lime : Color.gray.opacity(0.2)).frame(width: thumb, height: thumb)
                    .overlay { if working { ProgressView().tint(FuelNerveTheme.forest) } else { Image(systemName: "chevron.right").font(.title3.bold()).foregroundStyle(enabled ? FuelNerveTheme.forest : .secondary) } }
                    .padding(4).offset(x: min(max(0, drag), maximum))
                    .gesture(DragGesture(minimumDistance: 5)
                        .onChanged { if enabled && !working && !submitted { drag = $0.translation.width } }
                        .onEnded { _ in
                            guard enabled && !working && !submitted else { return }
                            if drag >= maximum * 0.82 { submitted = true; drag = maximum; Task { if !(await onApprove()) { submitted = false; withAnimation(.spring) { drag = 0 } } } }
                            else { withAnimation(.spring) { drag = 0 } }
                        })
            }
        }.frame(height: 66).accessibilityElement(children: .ignore).accessibilityLabel(accessibilityLabel).accessibilityHint(accessibilityHint)
        .accessibilityAction(named: "Approve") { guard enabled && !working && !submitted else { return }; submitted = true; Task { if !(await onApprove()) { submitted = false } } }
    }
}
