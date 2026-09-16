import SwiftUI

struct InvoiceReviewView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let document: InvoiceSourceDocument
    var onClose: () -> Void = {}

    @State private var references: InvoiceImportBootstrap?
    @State private var rawText = ""
    @State private var supplierId = ""
    @State private var supplierName = ""
    @State private var supplierCode = ""
    @State private var supplierTaxId = ""
    @State private var supplierPhone = ""
    @State private var supplierEmail = ""
    @State private var supplierAddress = ""
    @State private var supplierPaymentTerms = 0
    @State private var createNewSupplier = false
    @State private var showSupplierContactFields = false
    @State private var consigneeName = ""
    @State private var invoiceNumber = ""
    @State private var invoiceDate: Date?
    @State private var invoiceTotal = 0.0
    @State private var taxAmount = 0.0
    @State private var purchasePriceExcludedAmount = 0.0
    @State private var showAdjustments = false
    @State private var lines: [DraftLine] = []
    @State private var parserWarnings: [String] = []
    @State private var receiveNow = true
    @State private var paidNow = false
    @State private var paymentMethod = "UPI"
    @State private var paymentReference = ""
    @State private var phase = Phase.checking
    @State private var errorMessage: String?
    @State private var postedNumber: String?
    @State private var supplierAddedDuringConfirmation = false
    @State private var saveKey = UUID().uuidString

    private enum Phase { case checking, understanding, review, posting, complete }
    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .checking, .understanding: checkingView
                case .review, .posting: reviewForm
                case .complete: successView
                }
            }
            .navigationTitle(phase == .complete ? "Invoice updated" : "New invoice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(FuelNerveTheme.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(phase == .complete ? "Done" : "Cancel") { closeReview() }
                        .disabled(phase == .posting)
                }
            }
            .interactiveDismissDisabled(phase == .posting)
            .task { await readDocument() }
        }
    }

    private var checkingView: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().fill(FuelNerveTheme.lime.opacity(0.22)).frame(width: 82, height: 82)
                Image(systemName: phase == .checking ? "doc.text.viewfinder" : "sparkles")
                    .font(.system(size: 34)).foregroundStyle(FuelNerveTheme.green)
            }
            ProgressView().controlSize(.large).tint(FuelNerveTheme.green)
            Text(phase == .checking ? "Checking your document…" : "Understanding the invoice…")
                .font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest)
            Text(phase == .checking
                 ? "Reading the invoice securely on this device."
                 : "Matching the supplier, products, amounts and dates with your records.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Text("Nothing will be updated until you confirm.").font(.caption.weight(.semibold)).foregroundStyle(FuelNerveTheme.green)
            if let errorMessage {
                Text(errorMessage).font(.callout).foregroundStyle(.red).multilineTextAlignment(.center)
                Button("Close") { dismiss() }.buttonStyle(.bordered)
            }
        }.padding(28)
    }

    private var reviewForm: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 12) {
                    reviewHero
                    invoiceDetailsCard
                    itemsCard
                    if let priceAssessment, priceAssessment.direction != .unchanged {
                        priceChangeCard(priceAssessment)
                    }
                    if !parserWarnings.isEmpty { warningsCard }
                    stockAndPaymentCard
                    if let errorMessage { errorCard(errorMessage) }
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 12)
            }
            confirmationBar
        }
        .background(FuelNerveTheme.canvas)
    }

    private var reviewHero: some View {
        HStack(spacing: 14) {
            Image(systemName: "doc.text.viewfinder")
                .font(.title2.weight(.semibold))
                .foregroundStyle(FuelNerveTheme.forest)
                .frame(width: 52, height: 52)
                .background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 4) {
                Text("READY FOR YOUR REVIEW")
                    .font(.caption2.weight(.black)).tracking(1.3)
                    .foregroundStyle(FuelNerveTheme.green)
                Text("New invoice found")
                    .font(.title2.bold()).foregroundStyle(FuelNerveTheme.forest)
                Text("Check the details before anything changes.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [FuelNerveTheme.lime.opacity(0.22), .white],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 22)
        )
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(FuelNerveTheme.green.opacity(0.13)))
    }

    private var invoiceDetailsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            brandedSectionTitle("Invoice details", symbol: "doc.plaintext")

            VStack(alignment: .leading, spacing: 5) {
                Text("DELIVERED TO").brandFieldLabel()
                Text(consigneeName.isEmpty ? "Not clearly found" : consigneeName)
                    .font(.headline).foregroundStyle(FuelNerveTheme.forest)
                Label(stationAssessment.message, systemImage: stationAssessment.status == .match ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(stationAssessment.status == .match ? FuelNerveTheme.green : FuelNerveTheme.gold)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 15))

            supplierSection

            brandTextField("INVOICE NUMBER") {
                TextField("Enter invoice number", text: $invoiceNumber)
                    .textInputAutocapitalization(.characters)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("INVOICE DATE").brandFieldLabel()
                if invoiceDate != nil {
                    DatePicker("Invoice date", selection: Binding(get: { invoiceDate ?? .now }, set: { invoiceDate = $0 }), displayedComponents: .date)
                        .labelsHidden().tint(FuelNerveTheme.green)
                } else {
                    Button { invoiceDate = .now } label: {
                        Label("Choose invoice date", systemImage: "calendar")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(FuelNerveTheme.green)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(13)
                            .background(FuelNerveTheme.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 13))
                    }
                    Text("The document date was not clear. No date was assumed.")
                        .font(.caption).foregroundStyle(FuelNerveTheme.gold)
                }
            }

            HStack(alignment: .top, spacing: 12) {
                brandNumberField("INVOICE TOTAL", value: $invoiceTotal)
                brandNumberField("TAXES & CHARGES", value: $taxAmount)
            }

            DisclosureGroup(isExpanded: $showAdjustments) {
                VStack(alignment: .leading, spacing: 6) {
                    brandNumberField("NON-PRODUCT ADJUSTMENTS", value: $purchasePriceExcludedAmount)
                    Text("Deposits or unrelated charges only. This is excluded from the product purchase price.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.top, 8)
            } label: {
                HStack {
                    Text("Other adjustments (optional)")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.green)
                    Spacer()
                    if purchasePriceExcludedAmount > 0 { Text(money(purchasePriceExcludedAmount)).font(.caption.bold()) }
                }
            }
            .tint(FuelNerveTheme.green)

            if let invoiceDate {
                HStack {
                    Text("Payment due").font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                    Text(dueDate(paymentTerms: resolvedPaymentTerms, invoiceDate: invoiceDate).formatted(date: .abbreviated, time: .omitted))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest)
                }
            }

            if document.attachment == nil {
                Label("Original too large to attach; checked details can still be saved.", systemImage: "paperclip.badge.ellipsis")
                    .font(.caption).foregroundStyle(FuelNerveTheme.gold)
            }
        }
        .brandCard()
    }

    private var itemsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                brandedSectionTitle("Products", symbol: "drop.fill")
                Spacer()
                Button { lines.append(DraftLine()) } label: {
                    Label("Add", systemImage: "plus")
                        .font(.subheadline.weight(.bold)).foregroundStyle(FuelNerveTheme.green)
                }
            }

            ForEach(lines.indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("PRODUCT \(index + 1)").brandFieldLabel()
                        Spacer()
                        if lines.count > 1 {
                            Button(role: .destructive) { lines.remove(at: index) } label: {
                                Image(systemName: "trash").font(.subheadline)
                            }
                        }
                    }
                    InvoiceLineEditor(line: $lines[index], products: references?.products ?? [], station: station)
                }
                .padding(12)
                .background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 16))
            }

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    totalTile("Products", money(productSubtotal), emphasis: false)
                    totalTile("Taxes & charges", money(taxAmount), emphasis: false)
                }
                HStack(spacing: 10) {
                    totalTile("Calculated total", money(calculatedTotal), emphasis: false)
                    totalTile("Invoice total", money(invoiceTotal), emphasis: totalsMatch)
                }
            }

            if !totalsMatch {
                Label("Invoice total must match products plus taxes and charges.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold)).foregroundStyle(.red)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 13))
            }
        }
        .brandCard()
    }

    @ViewBuilder private var supplierSection: some View {
        if createNewSupplier {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 11) {
                    Image(systemName: "person.crop.circle.badge.plus")
                        .font(.title3).foregroundStyle(FuelNerveTheme.green)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("New supplier found")
                            .font(.headline).foregroundStyle(FuelNerveTheme.forest)
                        Text("This supplier is not in FuelNerve yet. Check these details; it will be added only when you confirm the invoice.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                brandTextField("SUPPLIER NAME") {
                    TextField("Supplier name", text: $supplierName)
                        .textInputAutocapitalization(.words)
                        .onChange(of: supplierName) { oldValue, newValue in
                            if supplierCode.isEmpty || supplierCode == suggestedSupplierCode(from: oldValue) {
                                supplierCode = uniqueSupplierCode(suggestedSupplierCode(from: newValue))
                            }
                        }
                }

                HStack(alignment: .top, spacing: 12) {
                    brandTextField("SUPPLIER CODE") {
                        TextField("Code", text: $supplierCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .onChange(of: supplierCode) { _, value in
                                supplierCode = sanitizedSupplierCode(value)
                            }
                    }
                    brandTextField("GST NUMBER") {
                        TextField("Optional", text: $supplierTaxId)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                    }
                }

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("PAYMENT TERMS").brandFieldLabel()
                        Text(supplierPaymentTerms == 0 ? "Due immediately" : "Due in \(supplierPaymentTerms) days")
                            .font(.subheadline).foregroundStyle(FuelNerveTheme.forest)
                    }
                    Spacer()
                    Stepper("Payment terms", value: $supplierPaymentTerms, in: 0...365)
                        .labelsHidden().tint(FuelNerveTheme.green)
                }
                .padding(13)
                .background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 13))

                DisclosureGroup(isExpanded: $showSupplierContactFields) {
                    VStack(spacing: 12) {
                        brandTextField("PHONE") {
                            TextField("Optional", text: $supplierPhone).keyboardType(.phonePad)
                        }
                        brandTextField("EMAIL") {
                            TextField("Optional", text: $supplierEmail)
                                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        }
                        VStack(alignment: .leading, spacing: 7) {
                            Text("ADDRESS").brandFieldLabel()
                            TextEditor(text: $supplierAddress)
                                .frame(minHeight: 64)
                                .padding(8)
                                .scrollContentBackground(.hidden)
                                .background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 13))
                                .overlay(RoundedRectangle(cornerRadius: 13).stroke(FuelNerveTheme.green.opacity(0.16)))
                        }
                    }
                    .padding(.top, 12)
                } label: {
                    Text("Contact and address (optional)")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.green)
                }
                .tint(FuelNerveTheme.green)

                if !(references?.suppliers.filter(\.active).isEmpty ?? true) {
                    Button {
                        createNewSupplier = false
                        supplierId = ""
                    } label: {
                        Label("Choose an existing supplier instead", systemImage: "arrow.uturn.backward")
                            .font(.caption.weight(.semibold)).foregroundStyle(FuelNerveTheme.green)
                    }
                }

                if !newSupplierValidationMessage.isEmpty {
                    Label(newSupplierValidationMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold)).foregroundStyle(.red)
                }
            }
            .padding(14)
            .background(FuelNerveTheme.green.opacity(0.055), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(FuelNerveTheme.green.opacity(0.16)))
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("SUPPLIER").brandFieldLabel()
                Picker("Supplier", selection: $supplierId) {
                    Text("Choose supplier").tag("")
                    ForEach(references?.suppliers.filter(\.active) ?? []) { Text($0.name).tag($0.id) }
                }
                .labelsHidden()
                .tint(FuelNerveTheme.green)
                .frame(maxWidth: .infinity, alignment: .leading)

                if !supplierName.isEmpty {
                    Button {
                        supplierId = ""
                        createNewSupplier = true
                    } label: {
                        Label("Use \(supplierName) as a new supplier", systemImage: "person.badge.plus")
                            .font(.caption.weight(.semibold)).foregroundStyle(FuelNerveTheme.green)
                    }
                }
            }
        }
    }

    private func priceChangeCard(_ assessment: InvoicePriceAssessment) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            brandedSectionTitle("Price change found", symbol: "chart.line.uptrend.xyaxis")
            Text("\(assessment.productName) purchase price \(assessment.direction == .increase ? "increased" : "decreased")")
                .font(.headline).foregroundStyle(FuelNerveTheme.forest)
            Text("\(money(assessment.previousPrice)) → \(money(assessment.invoicePrice)) per \(assessment.unit)")
                .font(.title3.bold()).foregroundStyle(FuelNerveTheme.gold)
            Text("Review the retail selling price before the next sale.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(18)
        .background(FuelNerveTheme.gold.opacity(0.09), in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(FuelNerveTheme.gold.opacity(0.2)))
    }

    private var warningsCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            brandedSectionTitle("Please check", symbol: "exclamationmark.triangle.fill")
            ForEach(parserWarnings, id: \.self) { warning in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "circle.fill").font(.system(size: 6)).padding(.top, 6)
                    Text(warning).font(.subheadline)
                }
                .foregroundStyle(FuelNerveTheme.gold)
            }
        }
        .brandCard()
    }

    private var stockAndPaymentCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            brandedSectionTitle("When you confirm", symbol: "arrow.triangle.2.circlepath")
            brandedToggle(
                title: "Receive stock now",
                detail: receiveNow ? "Stock and tank records will be updated." : "The bill will be saved without changing stock.",
                symbol: "shippingbox.fill",
                isOn: $receiveNow
            )
            Divider().overlay(FuelNerveTheme.forest.opacity(0.08))
            brandedToggle(
                title: "Already paid",
                detail: paidNow ? "A payment record will be created." : "The amount will remain payable.",
                symbol: "indianrupeesign.circle.fill",
                isOn: $paidNow
            )
            if paidNow {
                HStack(spacing: 12) {
                    Picker("Paid by", selection: $paymentMethod) {
                        ForEach(["CASH", "UPI", "CARD", "OTHER"], id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .tint(FuelNerveTheme.green)
                    TextField("Payment reference", text: $paymentReference)
                        .textFieldStyle(.roundedBorder)
                }
            }
        }
        .brandCard()
    }

    private var confirmationBar: some View {
        VStack(spacing: 8) {
            Button { postInvoice() } label: {
                HStack(spacing: 10) {
                    if phase == .posting { ProgressView().tint(.white) }
                    Image(systemName: phase == .posting ? "arrow.triangle.2.circlepath" : "checkmark.shield.fill")
                    Text(phase == .posting ? "Updating records…" : "Confirm and update records")
                        .fontWeight(.bold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
            }
            .foregroundStyle(canPost ? .white : FuelNerveTheme.forest.opacity(0.4))
            .background(canPost ? FuelNerveTheme.forest : Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
            .contentShape(Rectangle())
            .buttonStyle(.plain)
            .disabled(!canPost || phase == .posting)

            Text(canPost ? "Nothing changes until you tap confirm." : "Complete the highlighted details to continue.")
                .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) { Divider().opacity(0.4) }
    }

    private func brandedSectionTitle(_ title: String, symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.headline).foregroundStyle(FuelNerveTheme.forest)
    }

    private func brandTextField<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).brandFieldLabel()
            content()
                .padding(.horizontal, 13).frame(minHeight: 48)
                .background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 13))
                .overlay(RoundedRectangle(cornerRadius: 13).stroke(FuelNerveTheme.green.opacity(0.16)))
        }
    }

    private func brandNumberField(_ label: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).brandFieldLabel()
            HStack(spacing: 5) {
                Text("₹").foregroundStyle(.secondary)
                TextField("0.00", value: value, format: .number.precision(.fractionLength(2)))
                    .keyboardType(.decimalPad)
            }
            .padding(.horizontal, 12).frame(minHeight: 48)
            .background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(FuelNerveTheme.green.opacity(0.16)))
        }
        .frame(maxWidth: .infinity)
    }

    private func totalTile(_ label: String, _ value: String, emphasis: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.headline).foregroundStyle(FuelNerveTheme.forest).lineLimit(1).minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(emphasis ? FuelNerveTheme.lime.opacity(0.2) : FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 14))
    }

    private func brandedToggle(title: String, detail: String, symbol: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: 13) {
            Image(systemName: symbol)
                .font(.headline).foregroundStyle(FuelNerveTheme.green)
                .frame(width: 42, height: 42)
                .background(FuelNerveTheme.green.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline).foregroundStyle(FuelNerveTheme.forest)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Toggle("", isOn: isOn).labelsHidden().tint(FuelNerveTheme.green)
        }
    }

    private func errorCard(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.octagon.fill")
            .font(.subheadline.weight(.semibold)).foregroundStyle(.red)
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
    }

    private var successView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 58)).foregroundStyle(FuelNerveTheme.green)
            Text("Invoice \(postedNumber ?? invoiceNumber) was added").font(.title2.bold()).multilineTextAlignment(.center).foregroundStyle(FuelNerveTheme.forest)
            Text(receiveNow ? "The invoice, payable, stock receipt, inventory ledger and accounting entries were updated together." : "The invoice, payable and accounting entries were updated together.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Done") { closeReview() }.buttonStyle(.borderedProminent).tint(FuelNerveTheme.green)
        }.padding(30)
    }

    private func closeReview() {
        guard phase != .posting else { return }
        onClose()
        dismiss()
    }

    private var station: InvoiceImportBootstrap.Station? {
        guard let references else { return nil }
        return references.stations.first { $0.id == session.selectedStationId } ?? references.stations.first
    }
    private var supplier: InvoiceImportBootstrap.Supplier? { references?.suppliers.first { $0.id == supplierId } }
    private var resolvedPaymentTerms: Int { createNewSupplier ? supplierPaymentTerms : supplier?.paymentTerms ?? 0 }
    private var validNewSupplier: Bool { newSupplierValidationMessage.isEmpty }
    private var newSupplierValidationMessage: String {
        let name = supplierName.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = supplierCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let email = supplierEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.count < 2 { return "Enter the supplier name." }
        if code.isEmpty { return "Enter a supplier code." }
        if code.range(of: #"^[A-Z0-9-]+$"#, options: .regularExpression) == nil { return "Use only letters, numbers and hyphens in the supplier code." }
        if references?.suppliers.contains(where: { $0.code.caseInsensitiveCompare(code) == .orderedSame }) == true { return "This supplier code is already in use." }
        if supplierTaxId.count > 30 { return "Check the GST number." }
        if supplierPhone.count > 30 { return "Check the phone number." }
        if !email.isEmpty && (email.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil) { return "Enter a valid supplier email address." }
        if supplierAddress.count > 300 { return "The supplier address is too long." }
        return ""
    }
    private var stationAssessment: InvoiceStationAssessment { InvoiceImportSafety.assessStation(consigneeName: consigneeName, stationName: station?.name) }
    private var priceAssessment: InvoicePriceAssessment? {
        guard lines.count == 1, let line = lines.first else { return nil }
        return InvoiceImportSafety.assessSingleProductPrice(invoiceTotal: invoiceTotal, excludedAmount: purchasePriceExcludedAmount, productId: line.productId, description: line.description, quantity: line.quantity, sourceUnit: line.sourceUnit, baseAmount: line.quantity * line.unitCost, taxRate: line.taxRate, products: references?.products ?? [])
    }
    private var productSubtotal: Double { lines.reduce(0) { $0 + $1.quantity * $1.unitCost } }
    private var calculatedTotal: Double { productSubtotal + taxAmount }
    private var totalsMatch: Bool { invoiceTotal > 0 && abs(invoiceTotal - calculatedTotal) < 0.02 }
    private var canPost: Bool {
        let hasSupplier = createNewSupplier ? validNewSupplier : supplier != nil
        guard station != nil, stationAssessment.permitsSubmission, hasSupplier, invoiceDate != nil, !invoiceNumber.trimmingCharacters(in: .whitespaces).isEmpty, !lines.isEmpty, totalsMatch else { return false }
        return lines.allSatisfy { $0.quantity > 0 && $0.unitCost >= 0 && !$0.description.trimmingCharacters(in: .whitespaces).isEmpty && (!receiveNow || !$0.productId.isEmpty) && (!receiveNow || tankIsValid(for: $0)) }
    }
    private func tankIsValid(for line: DraftLine) -> Bool {
        guard let product = references?.products.first(where: { $0.id == line.productId }) else { return false }
        return !product.tankLinked || !line.tankId.isEmpty
    }

    @MainActor private func readDocument() async {
        guard phase == .checking, errorMessage == nil else { return }
        do {
            let ocr = try await InvoiceOCRService.recognize(document)
            phase = .understanding
            let bootstrap = try await session.invoiceImportService.bootstrap()
            references = bootstrap; rawText = ocr.text
            apply(InvoiceTextParser.parse(ocr.text), references: bootstrap)
            phase = .review
        } catch {
            session.handleAuthenticationFailure(error)
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "FuelNerve could not prepare this invoice. No records were changed."
        }
    }

    private func apply(_ parsed: ParsedInvoice, references: InvoiceImportBootstrap) {
        invoiceNumber = parsed.invoiceNumber ?? ""
        consigneeName = parsed.consigneeName ?? ""
        invoiceDate = parsed.invoiceDate
        invoiceTotal = parsed.total ?? 0
        taxAmount = parsed.tax
        parserWarnings = parsed.warnings
        supplierName = parsed.supplierName ?? ""
        supplierTaxId = parsed.supplierGSTIN ?? ""
        if let matchedSupplier = bestSupplier(for: parsed, in: references) {
            supplierId = matchedSupplier.id
            createNewSupplier = false
        } else {
            supplierId = ""
            supplierCode = uniqueSupplierCode(suggestedSupplierCode(from: supplierName))
            createNewSupplier = !supplierName.isEmpty
        }
        lines = parsed.lines.map { item in
            let product = bestProduct(for: item, in: references)
            return DraftLine(productId: product?.id ?? "", tankId: product.flatMap { product in station(in: references)?.tanks.first(where: { $0.productId == product.id })?.id } ?? "", description: item.description, quantity: item.quantity, sourceUnit: item.unit ?? product?.unit ?? "", unitCost: item.unitCost, taxRate: product?.taxCategory?.rate.value ?? 0, hsnCode: item.hsnCode ?? product?.hsnCode ?? "", detectedProduct: item.product, isExpanded: false)
        }
        if lines.isEmpty { lines = [DraftLine()] }
    }

    private func station(in references: InvoiceImportBootstrap) -> InvoiceImportBootstrap.Station? { references.stations.first { $0.id == session.selectedStationId } ?? references.stations.first }
    private func bestSupplier(for parsed: ParsedInvoice, in references: InvoiceImportBootstrap) -> InvoiceImportBootstrap.Supplier? {
        if let gst = parsed.supplierGSTIN?.uppercased(), let exact = references.suppliers.first(where: { $0.taxId?.uppercased() == gst }) { return exact }
        let name = normalized(parsed.supplierName ?? "")
        let candidate = references.suppliers.filter(\.active).max { similarity(normalized($0.name), name) < similarity(normalized($1.name), name) }
        guard let candidate, similarity(normalized(candidate.name), name) >= 4 else { return nil }
        return candidate
    }
    private func bestProduct(for item: ParsedInvoice.Line, in references: InvoiceImportBootstrap) -> InvoiceImportBootstrap.Product? {
        let value = normalized(item.description)
        let family = normalized(item.product)
        let hsn = item.hsnCode?.filter(\.isNumber)
        if let direct = references.products.first(where: { product in value.contains(normalized(product.code)) || value.contains(normalized(product.name)) || (product.code.uppercased() == "MS" && value.contains("PETROL")) || (product.code.uppercased() == "HSD" && value.contains("DIESEL")) }) { return direct }
        let familyMatches = references.products.filter { normalized($0.code) == family }
        if familyMatches.count == 1 { return familyMatches[0] }
        let hsnMatches = references.products.filter { hsn != nil && $0.hsnCode?.filter(\.isNumber) == hsn }
        return hsnMatches.count == 1 ? hsnMatches[0] : nil
    }
    private func normalized(_ value: String) -> String { value.uppercased().filter(\.isLetter) }
    private func similarity(_ left: String, _ right: String) -> Int { guard !left.isEmpty, !right.isEmpty else { return 0 }; return left == right ? 1000 : (left.contains(right) || right.contains(left) ? min(left.count, right.count) : zip(left, right).prefix { $0 == $1 }.count) }
    private func dueDate(paymentTerms: Int, invoiceDate: Date) -> Date { Calendar(identifier: .gregorian).date(byAdding: .day, value: paymentTerms, to: invoiceDate) ?? invoiceDate }
    private func money(_ value: Double) -> String { value.formatted(.currency(code: "INR")) }

    private func suggestedSupplierCode(from name: String) -> String {
        let words = name.uppercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        let initials = words.compactMap(\.first).map(String.init).joined()
        if initials.count >= 2 { return String(initials.prefix(12)) }
        return String(words.joined().prefix(12))
    }

    private func sanitizedSupplierCode(_ value: String) -> String {
        String(value.uppercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }.prefix(24))
    }

    private func uniqueSupplierCode(_ proposed: String) -> String {
        let base = sanitizedSupplierCode(proposed).isEmpty ? "SUPPLIER" : sanitizedSupplierCode(proposed)
        let used = Set((references?.suppliers ?? []).map { $0.code.uppercased() })
        if !used.contains(base) { return base }
        for suffix in 2...99 {
            let candidate = "\(base)-\(suffix)"
            if !used.contains(candidate) { return candidate }
        }
        return "\(base)-NEW"
    }

    private func postInvoice() {
        guard canPost, let station, let invoiceDate else { return }
        errorMessage = nil; phase = .posting
        supplierAddedDuringConfirmation = false
        Task {
            do {
                let resolvedSupplier = try await supplierForConfirmation()
                let submission = makeSubmission(station: station, supplier: resolvedSupplier, invoiceDate: invoiceDate)
                let posted = try await session.invoiceImportService.post(submission, idempotencyKey: saveKey)
                postedNumber = posted.invoiceNumber
                phase = .complete
            } catch APIError.server(_, let code, let message) {
                if code == "INVOICE_EXISTS" {
                    errorMessage = supplierAddedDuringConfirmation
                        ? "The supplier was added, but this invoice already exists. No duplicate invoice was created."
                        : "This supplier invoice has already been posted. No duplicate was created."
                } else {
                    errorMessage = supplierAddedDuringConfirmation
                        ? "The supplier was added, but the invoice was not posted. Check the invoice and try again."
                        : (message ?? "The invoice was not posted. No records were changed.")
                }
                phase = .review
            } catch {
                session.handleAuthenticationFailure(error)
                errorMessage = supplierAddedDuringConfirmation
                    ? "The supplier was added, but the invoice was not posted. Check your connection and try again."
                    : "The invoice was not posted. Check your connection and try again."
                phase = .review
            }
        }
    }

    @MainActor private func supplierForConfirmation() async throws -> InvoiceImportBootstrap.Supplier {
        if !createNewSupplier, let supplier { return supplier }
        let draft = NewSupplierSubmission(
            name: supplierName.trimmingCharacters(in: .whitespacesAndNewlines),
            code: supplierCode.trimmingCharacters(in: .whitespacesAndNewlines),
            phone: supplierPhone.trimmingCharacters(in: .whitespacesAndNewlines),
            email: supplierEmail.trimmingCharacters(in: .whitespacesAndNewlines),
            taxId: supplierTaxId.trimmingCharacters(in: .whitespacesAndNewlines),
            address: supplierAddress.trimmingCharacters(in: .whitespacesAndNewlines),
            paymentTerms: supplierPaymentTerms,
            active: true
        )
        do {
            let created = try await session.invoiceImportService.createSupplier(draft, idempotencyKey: "\(saveKey)-supplier")
            supplierAddedDuringConfirmation = true
            supplierId = created.id
            createNewSupplier = false
            if let references {
                self.references = .init(suppliers: references.suppliers + [created], stations: references.stations, products: references.products)
            }
            return created
        } catch APIError.server(_, let code, _) where code == "SUPPLIER_CODE_EXISTS" {
            let refreshed = try await session.invoiceImportService.bootstrap()
            references = refreshed
            if let existing = refreshed.suppliers.first(where: {
                $0.code.caseInsensitiveCompare(draft.code) == .orderedSame &&
                (normalized($0.name) == normalized(draft.name) || (!draft.taxId.isEmpty && $0.taxId?.caseInsensitiveCompare(draft.taxId) == .orderedSame))
            }) {
                supplierId = existing.id
                createNewSupplier = false
                return existing
            }
            throw APIError.server(status: 409, code: "SUPPLIER_CODE_EXISTS", message: "That supplier code is already in use. Choose another code.")
        }
    }

    private func makeSubmission(station: InvoiceImportBootstrap.Station, supplier: InvoiceImportBootstrap.Supplier, invoiceDate: Date) -> PurchaseInvoiceSubmission {
        let formatter = ISO8601DateFormatter()
        return PurchaseInvoiceSubmission(
            stationId: station.id, supplierId: supplier.id, invoiceNumber: invoiceNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            invoiceDate: formatter.string(from: invoiceDate), dueDate: formatter.string(from: dueDate(paymentTerms: supplier.paymentTerms, invoiceDate: invoiceDate)), invoiceTotal: invoiceTotal,
            taxAmount: taxAmount, purchasePriceExcludedAmount: purchasePriceExcludedAmount > 0 ? purchasePriceExcludedAmount : nil, notes: "Imported with on-device OCR; confirmed by user.", receiveNow: receiveNow, paidNow: paidNow,
            paymentMethod: paidNow ? paymentMethod : nil, paymentReferenceNo: paidNow && !paymentReference.isEmpty ? paymentReference : nil,
            attachment: document.attachment,
            lines: lines.map { .init(productId: $0.productId.isEmpty ? nil : $0.productId, tankId: $0.tankId.isEmpty ? nil : $0.tankId, description: $0.description, quantity: $0.quantity, sourceUnit: $0.sourceUnit.isEmpty ? nil : $0.sourceUnit, unitCost: $0.unitCost, taxRate: $0.taxRate, hsnCode: $0.hsnCode.isEmpty ? nil : $0.hsnCode) }
        )
    }
}

private struct InvoiceLineEditor: View {
    @Binding var line: DraftLine
    let products: [InvoiceImportBootstrap.Product]
    let station: InvoiceImportBootstrap.Station?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(line.description.isEmpty ? "Product not clearly found" : line.description)
                        .font(.headline).foregroundStyle(FuelNerveTheme.forest)
                    Text(productSummary)
                        .font(.caption).foregroundStyle(line.description.isEmpty ? FuelNerveTheme.gold : Color.secondary)
                }
                Spacer(minLength: 8)
                Text((line.quantity * line.unitCost).formatted(.currency(code: "INR")))
                    .font(.subheadline.bold()).foregroundStyle(FuelNerveTheme.forest)
                    .multilineTextAlignment(.trailing)
            }

            DisclosureGroup(isExpanded: $line.isExpanded) {
                VStack(alignment: .leading, spacing: 10) {
                    labeledField("DESCRIPTION") { TextField("Description", text: $line.description).brandInput() }

                    HStack(alignment: .top, spacing: 10) {
                        labeledField("PRODUCT") {
                            Picker("Product", selection: $line.productId) {
                                Text(line.detectedProduct.isEmpty ? "Choose product" : line.detectedProduct).tag("")
                                ForEach(products) { Text("\($0.name) (\($0.code))").tag($0.id) }
                            }
                            .tint(FuelNerveTheme.green)
                            .padding(.horizontal, 11)
                            .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        }
                        labeledField("HSN") { TextField("Optional", text: $line.hsnCode).keyboardType(.numberPad).brandInput() }
                            .frame(maxWidth: 120)
                    }

                    HStack(alignment: .top, spacing: 10) {
                        labeledField("QUANTITY") { DecimalField("Quantity", value: $line.quantity) }
                        labeledField("UNIT") { TextField("KL or L", text: $line.sourceUnit).textInputAutocapitalization(.characters).brandInput() }
                    }
                    HStack(alignment: .top, spacing: 10) {
                        labeledField("RATE") { DecimalField("Rate", value: $line.unitCost) }
                        labeledField("TAX %") { DecimalField("Tax %", value: $line.taxRate) }
                    }

                    if line.productId.isEmpty && !line.detectedProduct.isEmpty {
                        Text("Detected as \(line.detectedProduct). Choose the matching FuelNerve product before receiving stock.")
                            .font(.caption2).foregroundStyle(FuelNerveTheme.gold)
                    }
                    if let product = products.first(where: { $0.id == line.productId }), product.tankLinked {
                        Picker("Receiving tank", selection: $line.tankId) {
                            Text("Choose tank").tag("")
                            ForEach(station?.tanks.filter { $0.productId == product.id } ?? []) { Text($0.code).tag($0.id) }
                        }
                        .tint(FuelNerveTheme.green)
                    }
                }
                .padding(.top, 9)
            } label: {
                Text(line.isExpanded ? "Hide details" : "Review details")
                    .font(.caption.weight(.bold)).foregroundStyle(FuelNerveTheme.green)
            }
            .tint(FuelNerveTheme.green)
            .onChange(of: line.productId) { _, productId in
                guard let product = products.first(where: { $0.id == productId }) else { line.tankId = ""; return }
                line.detectedProduct = product.code.uppercased()
                if line.description == "Invoice purchase" || line.description.isEmpty { line.description = product.name }
                line.taxRate = product.taxCategory?.rate.value ?? line.taxRate
                line.hsnCode = line.hsnCode.isEmpty ? product.hsnCode ?? "" : line.hsnCode
                line.tankId = station?.tanks.first(where: { $0.productId == productId })?.id ?? ""
            }
        }
    }

    private var productSummary: String {
        let product = line.detectedProduct.isEmpty ? "Unidentified" : line.detectedProduct.replacingOccurrences(of: "_", with: " ")
        let quantity = line.quantity.formatted(.number.precision(.fractionLength(0...3)))
        let measure = line.sourceUnit.isEmpty ? quantity : "\(quantity) \(line.sourceUnit.uppercased())"
        let hsn = line.hsnCode.isEmpty ? nil : "HSN \(line.hsnCode)"
        return ([product, measure] + [hsn].compactMap { $0 }).joined(separator: " · ")
    }

    private func labeledField<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).brandFieldLabel()
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

fileprivate struct DraftLine: Identifiable {
    let id = UUID()
    var productId = ""
    var tankId = ""
    var description = ""
    var quantity = 1.0
    var sourceUnit = ""
    var unitCost = 0.0
    var taxRate = 0.0
    var hsnCode = ""
    var detectedProduct = ""
    var isExpanded = true
}

private struct DecimalField: View {
    let label: String
    @Binding var value: Double
    init(_ label: String, value: Binding<Double>) { self.label = label; _value = value }
    var body: some View { TextField(label, value: $value, format: .number.precision(.fractionLength(0...3))).keyboardType(.decimalPad).brandInput() }
}

private struct CurrencyField: View {
    let label: String
    @Binding var value: Double
    init(_ label: String, value: Binding<Double>) { self.label = label; _value = value }
    var body: some View { TextField(label, value: $value, format: .number.precision(.fractionLength(2))).keyboardType(.decimalPad) }
}

private extension View {
    func brandCard() -> some View {
        self
            .padding(15)
            .background(.white, in: RoundedRectangle(cornerRadius: 19))
            .overlay(RoundedRectangle(cornerRadius: 19).stroke(FuelNerveTheme.forest.opacity(0.07)))
            .shadow(color: FuelNerveTheme.forest.opacity(0.03), radius: 10, y: 4)
    }

    func brandInput() -> some View {
        self
            .padding(.horizontal, 12)
            .frame(minHeight: 46)
            .background(.white, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(FuelNerveTheme.green.opacity(0.16)))
    }
}

private extension Text {
    func brandFieldLabel() -> some View {
        font(.caption2.weight(.bold))
            .tracking(0.8)
            .foregroundStyle(FuelNerveTheme.green)
    }
}
