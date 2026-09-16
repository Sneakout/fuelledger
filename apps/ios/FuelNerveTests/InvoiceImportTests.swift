import Foundation
import Testing
@testable import FuelNerve

struct InvoiceImportTests {
    @Test func parsesIndianFuelInvoiceWithoutChangingRecords() throws {
        let text = """
        Kerala Fuel Supplies Pvt Ltd
        GSTIN: 32ABCDE1234F1Z5
        Tax Invoice No: KFS/2026/1842
        Invoice Date: 12/09/2026
        HSD 27101944 5000.000 L 87.50 437500.00
        CGST 9% 39375.00
        SGST 9% 39375.00
        Grand Total 516250.00
        """
        let result = InvoiceTextParser.parse(text)
        #expect(result.supplierName == "Kerala Fuel Supplies Pvt Ltd")
        #expect(result.supplierGSTIN == "32ABCDE1234F1Z5")
        #expect(result.invoiceNumber == "KFS/2026/1842")
        #expect(result.total == 516250)
        #expect(result.tax == 78750)
        #expect(result.lines.count == 1)
        #expect(result.lines.first?.quantity == 5000)
        #expect(result.lines.first?.unitCost == 87.5)
    }

    @Test func parsesIndianOilLayoutWithConsigneeAndRecoveredDecimals() {
        let result = InvoiceTextParser.parse("""
        Indian Oil Corporation Limited
        TAX INVOICE 20274247B025710
        SAP Entry no. 7010369929 Date 31-Aug-26
        Supplier CONSIGNEE
        PAYER - 187714 SALEEMA PETROLEUM
        10 50700 HSD-BSVI 12000 KL 2710 19 44
        BASIC DESTINATION PRICE 12000 KL 79341270 KL 95209524
        Total for material 1207079.09
        Total 1207079.00
        """)
        #expect(result.invoiceNumber == "20274247B025710")
        #expect(result.supplierName == "Indian Oil Corporation Limited")
        #expect(result.invoiceDate != nil)
        #expect(result.consigneeName == "SALEEMA PETROLEUM")
        #expect(result.consigneeCode == "187714")
        #expect(result.total == 1_207_079)
        #expect(result.tax == 254_983.76)
        #expect(result.lines.count == 1)
        #expect(result.lines.first?.product == "HSD")
        #expect(result.lines.first?.quantity == 12)
        #expect(result.lines.first?.unit == "KL")
        #expect(result.lines.first?.unitCost == 79_341.27)
        #expect(result.lines.first?.amount == 952_095.24)
        #expect(result.lines.first?.hsnCode == "27101944")
    }

    @Test func derivesChargesFromPrintedProductAmountInsteadOfOCRDistortedRate() {
        let result = InvoiceTextParser.parse("""
        Indian Oil Corporation Limited
        Tax Invoice No: 20274247B025710
        Date 31-Aug-26
        HSD-BSVI 12.000 KL 80000.00 KL 952095.24
        Total 1207079.00
        """)

        #expect(result.lines.first?.amount == 952_095.24)
        #expect(result.tax == 254_983.76)
        #expect(result.tax != 2)
    }

    @Test func reconcilesSingleDigitProductAmountOCRErrorWithoutFalseTotalMismatch() {
        let result = InvoiceTextParser.parse("""
        Indian Oil Corporation Limited
        Tax Invoice No: 20274247B025710
        Date 31-Aug-26
        HSD-BSVI 12.000 KL 79341.270 KL 952005.24
        Total 1207079.00
        """)

        #expect(result.lines.first?.amount == 952_005.24)
        #expect(result.tax == 254_983.76)
        #expect(result.warnings.contains { $0.contains("quantity and rate do not match") })
    }

    @Test func parsesVisionColumnarLayoutAndDoesNotTreatTaxPercentageAsRupees() {
        let result = InvoiceTextParser.parse("""
        Indian Oil Corporation Limited
        TAX INVOICE 20274247B025710
        Date 31-Aug-26
        HSD-BSVI
        QUANTITY. UNIT
        12.000
        KL
        RATE: UNIT
        79341.270
        HSN CODE
        27101944
        TOTAL FOR MATERIAL
        952095.24
        Social Cess 2%
        Total 1207079.00
        """)

        #expect(result.lines.count == 1)
        #expect(result.lines.first?.product == "HSD")
        #expect(result.lines.first?.quantity == 12)
        #expect(result.lines.first?.unitCost == 79_341.27)
        #expect(result.tax == 254_983.76)
        #expect(result.tax != 2)
    }

    @Test(arguments: [
        ("MS-BS VI", "MS"), ("XP95", "MS"), ("XP100", "MS"), ("XTRAPREMIUM", "MS"),
        ("Speed 97", "MS"), ("Power95", "MS"), ("XtraGreen", "HSD"), ("XtraMile", "HSD"),
        ("V-Power Diesel", "HSD"), ("Ethanol100", "ETHANOL"), ("AutoGas", "AUTO_LPG"),
        ("Jet A-1", "AVIATION_FUEL"),
    ])
    func recognisesBrandedFuels(description: String, family: String) {
        let result = InvoiceTextParser.parse("Fuel supplier\nInvoice No: BRAND-1\nInvoice Date: 13/09/2026\n\(description) 27101241 2.000 KL 100000.00 200000.00\nGrand Total 200000.00")
        #expect(result.lines.first?.description == description)
        #expect(result.lines.first?.product == family)
    }

    @Test func withholdsMissingOrImpossibleDates() {
        let missing = InvoiceTextParser.parse("Indian Oil Corporation Limited\nInvoice No: IOCL-44\nHSD 1 KL 90000 90000\nGrand Total 90000")
        #expect(missing.invoiceDate == nil)
        #expect(missing.missingFields.contains("invoice date"))
        let invalid = InvoiceTextParser.parse("Indian Oil Corporation Limited\nInvoice No: IOCL-44\nDate 51-Aug-26\nHSD 1 KL 90000 90000\nGrand Total 90000")
        #expect(invalid.invoiceDate == nil)
        #expect(invalid.warnings.contains { $0.contains("not a valid calendar date") })
    }

    @Test func separatesConsigneeFromAMergedProductTableLine() {
        let result = InvoiceTextParser.parse("Supplier CONSIGNEE Indian Oil Corporation Limited 187714 SALEEMA PETROLEUM INDIAN OIL DEALER PAYER - 187714 SALEEMA PETROLEUM item Material Code / Material Description Quantity Unit Rate Unit HSN code Total 10 50700 HSD-BSVI 12.000 KL 79341.270 KL 952095.24")
        #expect(result.consigneeName == "SALEEMA PETROLEUM")
        #expect(result.consigneeCode == "187714")
    }

    @Test func retainsUnknownPetroleumProductWithoutGuessingItsFamily() {
        let result = InvoiceTextParser.parse("Fuel supplier\nInvoice No: BRAND-2\nInvoice Date: 13/09/2026\nEcoBoost Max 27101241 2.000 KL 100000.00 200000.00\nGrand Total 200000.00")
        #expect(result.lines.first?.description == "EcoBoost Max")
        #expect(result.lines.first?.product == "OTHER")
        #expect(result.lines.first?.amount == 200_000)
    }

    @Test func blocksUnknownAndWrongConsigneesBeforeSubmission() {
        let unknown = InvoiceImportSafety.assessStation(consigneeName: nil, stationName: "Tirur RSA")
        let mismatch = InvoiceImportSafety.assessStation(consigneeName: "Saleema Petroleum", stationName: "Tirur RSA")
        #expect(unknown.status == .unknown)
        #expect(!unknown.permitsSubmission)
        #expect(mismatch.status == .mismatch)
        #expect(!mismatch.permitsSubmission)
        #expect(InvoiceImportSafety.assessStation(consigneeName: "Saleema Petroleum", stationName: "Saleema Fuels").status == .match)
    }

    @Test func calculatesSingleProductLandedPriceAndWithholdsBlendedPrice() {
        let product = InvoiceImportBootstrap.Product(
            id: "hsd", name: "High Speed Diesel", code: "HSD", unit: "L", hsnCode: "27101944", tankLinked: true,
            purchasePrice: FlexibleNumber(99.50), sellingPrice: FlexibleNumber(102), taxCategory: nil
        )
        let assessment = InvoiceImportSafety.assessSingleProductPrice(
            invoiceTotal: 1_207_079, productId: product.id, description: "HSD-BSVI", quantity: 12, sourceUnit: "KL", products: [product]
        )
        #expect(assessment?.invoicePrice == 100.59)
        #expect(assessment?.previousPrice == 99.50)
        #expect(assessment?.direction == .increase)
        #expect(InvoiceImportSafety.assessSingleProductPrice(invoiceTotal: 0, productId: product.id, description: "HSD", quantity: 12, sourceUnit: "KL", products: [product]) == nil)
        let excludingDeposit = InvoiceImportSafety.assessSingleProductPrice(
            invoiceTotal: 1_207_079, excludedAmount: 12_079, productId: product.id,
            description: "HSD-BSVI", quantity: 12, sourceUnit: "KL", baseAmount: 952_095.24,
            products: [product]
        )
        #expect(excludingDeposit?.invoicePrice == 99.58)
    }

    @Test func confirmedSupplierAndInvoiceAreTheOnlyNewOperationalWritesAllowed() async throws {
        struct Body: Encodable, Sendable { let confirmed = true }
        struct Response: Decodable, Sendable { let id: String }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [InvoiceURLProtocol.self]
        let client = APIClient(baseURL: URL(string: "https://fuelnerve.example/api")!, session: URLSession(configuration: configuration), cookieStorage: .shared)

        InvoiceURLProtocol.handler = { request in
            let path = request.url?.path
            #expect(path == "/api/purchases/invoices" || path == "/api/purchases/suppliers")
            #expect(request.value(forHTTPHeaderField: "Idempotency-Key") != nil)
            let id = path == "/api/purchases/suppliers" ? "supplier-1" : "invoice-1"
            return (HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!, Data("{\"id\":\"\(id)\"}".utf8))
        }
        let supplier: Response = try await client.send("purchases/suppliers", body: Body(), idempotencyKey: "supplier-save-key-123", as: Response.self)
        #expect(supplier.id == "supplier-1")
        let response: Response = try await client.send("purchases/invoices", body: Body(), idempotencyKey: "invoice-save-key-123", as: Response.self)
        #expect(response.id == "invoice-1")
        await #expect(throws: APIError.self) { let _: Response = try await client.send("inventory/adjustments", body: Body(), as: Response.self) }
    }
}

private final class InvoiceURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let (response, data) = Self.handler?(request) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
