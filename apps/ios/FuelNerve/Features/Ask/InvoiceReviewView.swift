import SwiftUI

struct InvoiceReviewView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let document: InvoiceSourceDocument

    @State private var references: InvoiceImportBootstrap?
    @State private var rawText = ""
    @State private var supplierId = ""
    @State private var invoiceNumber = ""
    @State private var invoiceDate = Date()
    @State private var invoiceTotal = 0.0
    @State private var taxAmount = 0.0
    @State private var lines: [DraftLine] = []
    @State private var receiveNow = true
    @State private var paidNow = false
    @State private var paymentMethod = "UPI"
    @State private var paymentReference = ""
    @State private var phase = Phase.checking
    @State private var errorMessage: String?
    @State private var postedNumber: String?
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(phase == .complete ? "Done" : "Cancel") { dismiss() } }
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
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Label("New invoice found", systemImage: "checkmark.circle.fill")
                        .font(.headline).foregroundStyle(FuelNerveTheme.green)
                    Text("Please check the extracted details below. FuelNerve will update your records only after you confirm.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                if document.attachment == nil {
                    Label("The original is over 500 KB, so it will not be attached. Extracted fields can still be posted.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
            Section("Invoice") {
                Picker("Supplier", selection: $supplierId) {
                    Text("Choose supplier").tag("")
                    ForEach(references?.suppliers.filter(\.active) ?? []) { Text($0.name).tag($0.id) }
                }
                TextField("Invoice number", text: $invoiceNumber).textInputAutocapitalization(.characters)
                DatePicker("Invoice date", selection: $invoiceDate, displayedComponents: .date)
                CurrencyField("Invoice total", value: $invoiceTotal)
                CurrencyField("Tax amount", value: $taxAmount)
                if let supplier { LabeledContent("Due date", value: dueDate(for: supplier).formatted(date: .abbreviated, time: .omitted)) }
            }
            Section("Items") {
                ForEach($lines) { $line in
                    InvoiceLineEditor(line: $line, products: references?.products ?? [], station: station)
                }.onDelete { lines.remove(atOffsets: $0) }
                Button { lines.append(DraftLine()) } label: { Label("Add item", systemImage: "plus") }
                LabeledContent("Calculated total", value: money(calculatedTotal))
                if !totalsMatch { Label("Invoice total must match items plus tax before posting.", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.red) }
            }
            Section("Stock and payment") {
                Toggle("Receive stock now", isOn: $receiveNow)
                Text(receiveNow ? "Creates the receipt and inventory entries when posted." : "Posts the bill without changing stock.").font(.caption).foregroundStyle(.secondary)
                Toggle("Already paid", isOn: $paidNow)
                if paidNow {
                    Picker("Paid by", selection: $paymentMethod) { ForEach(["CASH", "UPI", "CARD", "OTHER"], id: \.self) { Text($0.capitalized).tag($0) } }
                    TextField("Payment reference (optional)", text: $paymentReference)
                }
            }
            if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            Section {
                Button { postInvoice() } label: {
                    HStack { Spacer(); if phase == .posting { ProgressView().tint(.white) }; Text(phase == .posting ? "Updating…" : "Confirm and update records").fontWeight(.semibold); Spacer() }
                }.listRowBackground(canPost ? FuelNerveTheme.green : Color.gray.opacity(0.25)).foregroundStyle(.white).disabled(!canPost || phase == .posting)
                Text("This creates the supplier invoice and accounting journal. Stock receipt and inventory records are also created if selected; payment records are created only if marked paid.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var successView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 58)).foregroundStyle(FuelNerveTheme.green)
            Text("Invoice \(postedNumber ?? invoiceNumber) was added").font(.title2.bold()).multilineTextAlignment(.center).foregroundStyle(FuelNerveTheme.forest)
            Text(receiveNow ? "The invoice, payable, stock receipt, inventory ledger and accounting entries were updated together." : "The invoice, payable and accounting entries were updated together.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Done") { dismiss() }.buttonStyle(.borderedProminent).tint(FuelNerveTheme.green)
        }.padding(30)
    }

    private var station: InvoiceImportBootstrap.Station? {
        guard let references else { return nil }
        return references.stations.first { $0.id == session.selectedStationId } ?? references.stations.first
    }
    private var supplier: InvoiceImportBootstrap.Supplier? { references?.suppliers.first { $0.id == supplierId } }
    private var calculatedTotal: Double { lines.reduce(0) { $0 + $1.quantity * $1.unitCost } + taxAmount }
    private var totalsMatch: Bool { invoiceTotal > 0 && abs(invoiceTotal - calculatedTotal) < 0.02 }
    private var canPost: Bool {
        guard station != nil, supplier != nil, !invoiceNumber.trimmingCharacters(in: .whitespaces).isEmpty, !lines.isEmpty, totalsMatch else { return false }
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
        invoiceDate = parsed.invoiceDate ?? .now
        invoiceTotal = parsed.total ?? 0
        taxAmount = parsed.tax
        supplierId = bestSupplier(for: parsed, in: references)?.id ?? ""
        lines = parsed.lines.map { item in
            let product = bestProduct(for: item.description, in: references)
            return DraftLine(productId: product?.id ?? "", tankId: product.flatMap { product in station(in: references)?.tanks.first(where: { $0.productId == product.id })?.id } ?? "", description: item.description, quantity: item.quantity, sourceUnit: item.unit ?? product?.unit ?? "", unitCost: item.unitCost, taxRate: product?.taxCategory?.rate.value ?? 0, hsnCode: item.hsnCode ?? product?.hsnCode ?? "")
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
    private func bestProduct(for description: String, in references: InvoiceImportBootstrap) -> InvoiceImportBootstrap.Product? {
        let value = normalized(description)
        return references.products.first { product in value.contains(normalized(product.code)) || value.contains(normalized(product.name)) || (product.code.uppercased() == "MS" && value.contains("PETROL")) || (product.code.uppercased() == "HSD" && value.contains("DIESEL")) }
    }
    private func normalized(_ value: String) -> String { value.uppercased().filter(\.isLetter) }
    private func similarity(_ left: String, _ right: String) -> Int { guard !left.isEmpty, !right.isEmpty else { return 0 }; return left == right ? 1000 : (left.contains(right) || right.contains(left) ? min(left.count, right.count) : zip(left, right).prefix { $0 == $1 }.count) }
    private func dueDate(for supplier: InvoiceImportBootstrap.Supplier) -> Date { Calendar(identifier: .gregorian).date(byAdding: .day, value: supplier.paymentTerms, to: invoiceDate) ?? invoiceDate }
    private func money(_ value: Double) -> String { value.formatted(.currency(code: "INR")) }

    private func postInvoice() {
        guard canPost, let station, let supplier else { return }
        errorMessage = nil; phase = .posting
        let formatter = ISO8601DateFormatter()
        let submission = PurchaseInvoiceSubmission(
            stationId: station.id, supplierId: supplier.id, invoiceNumber: invoiceNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            invoiceDate: formatter.string(from: invoiceDate), dueDate: formatter.string(from: dueDate(for: supplier)), invoiceTotal: invoiceTotal,
            taxAmount: taxAmount, notes: "Imported with on-device OCR; confirmed by user.", receiveNow: receiveNow, paidNow: paidNow,
            paymentMethod: paidNow ? paymentMethod : nil, paymentReferenceNo: paidNow && !paymentReference.isEmpty ? paymentReference : nil,
            attachment: document.attachment,
            lines: lines.map { .init(productId: $0.productId.isEmpty ? nil : $0.productId, tankId: $0.tankId.isEmpty ? nil : $0.tankId, description: $0.description, quantity: $0.quantity, sourceUnit: $0.sourceUnit.isEmpty ? nil : $0.sourceUnit, unitCost: $0.unitCost, taxRate: $0.taxRate, hsnCode: $0.hsnCode.isEmpty ? nil : $0.hsnCode) }
        )
        Task {
            do { let posted = try await session.invoiceImportService.post(submission, idempotencyKey: saveKey); postedNumber = posted.invoiceNumber; phase = .complete }
            catch APIError.server(_, let code, let message) { errorMessage = code == "INVOICE_EXISTS" ? "This supplier invoice has already been posted. No duplicate was created." : (message ?? "The invoice was not posted. No records were changed."); phase = .review }
            catch { session.handleAuthenticationFailure(error); errorMessage = "The invoice was not posted. Check your connection and try again."; phase = .review }
        }
    }
}

private struct InvoiceLineEditor: View {
    @Binding var line: DraftLine
    let products: [InvoiceImportBootstrap.Product]
    let station: InvoiceImportBootstrap.Station?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Product", selection: $line.productId) {
                Text("Choose product").tag("")
                ForEach(products) { Text("\($0.name) (\($0.code))").tag($0.id) }
            }.onChange(of: line.productId) { _, productId in
                guard let product = products.first(where: { $0.id == productId }) else { line.tankId = ""; return }
                if line.description == "Invoice purchase" || line.description.isEmpty { line.description = product.name }
                line.taxRate = product.taxCategory?.rate.value ?? line.taxRate
                line.hsnCode = line.hsnCode.isEmpty ? product.hsnCode ?? "" : line.hsnCode
                line.tankId = station?.tanks.first(where: { $0.productId == productId })?.id ?? ""
            }
            TextField("Description", text: $line.description)
            HStack { DecimalField("Quantity", value: $line.quantity); DecimalField("Unit cost", value: $line.unitCost) }
            TextField("Invoice unit", text: $line.sourceUnit).textInputAutocapitalization(.characters)
            HStack { DecimalField("Tax %", value: $line.taxRate); TextField("HSN", text: $line.hsnCode).keyboardType(.numberPad) }
            if let product = products.first(where: { $0.id == line.productId }), product.tankLinked {
                Picker("Receiving tank", selection: $line.tankId) {
                    Text("Choose tank").tag("")
                    ForEach(station?.tanks.filter { $0.productId == product.id } ?? []) { Text($0.code).tag($0.id) }
                }
            }
        }.padding(.vertical, 5)
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
}

private struct DecimalField: View {
    let label: String
    @Binding var value: Double
    init(_ label: String, value: Binding<Double>) { self.label = label; _value = value }
    var body: some View { TextField(label, value: $value, format: .number.precision(.fractionLength(0...3))).keyboardType(.decimalPad).textFieldStyle(.roundedBorder) }
}

private struct CurrencyField: View {
    let label: String
    @Binding var value: Double
    init(_ label: String, value: Binding<Double>) { self.label = label; _value = value }
    var body: some View { TextField(label, value: $value, format: .number.precision(.fractionLength(2))).keyboardType(.decimalPad) }
}
