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
        HSD 27101944 5000.000 87.50 437500.00
        CGST 9% 39375.00
        SGST 9% 39375.00
        Grand Total 516250.00
        """
        let result = InvoiceTextParser.parse(text)
        #expect(result.supplierGSTIN == "32ABCDE1234F1Z5")
        #expect(result.invoiceNumber == "KFS/2026/1842")
        #expect(result.total == 516250)
        #expect(result.tax == 78750)
        #expect(result.lines.count == 1)
        #expect(result.lines.first?.quantity == 5000)
        #expect(result.lines.first?.unitCost == 87.5)
    }

    @Test func parsesCompactFuelLineWithQuantityAndUnitCost() {
        let result = InvoiceTextParser.parse("Invoice No: A-12\nDate: 13/09/2026\nHSD 5000 87.50\nGrand Total 437500.00")
        #expect(result.lines.first?.quantity == 5000)
        #expect(result.lines.first?.unitCost == 87.5)
    }

    @Test func purchaseInvoiceIsTheOnlyNewOperationalWriteAllowed() async throws {
        struct Body: Encodable, Sendable { let confirmed = true }
        struct Response: Decodable, Sendable { let id: String }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [InvoiceURLProtocol.self]
        let client = APIClient(baseURL: URL(string: "https://fuelnerve.example/api")!, session: URLSession(configuration: configuration), cookieStorage: .shared)

        InvoiceURLProtocol.handler = { request in
            #expect(request.url?.path == "/api/purchases/invoices")
            #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "invoice-save-key-123")
            return (HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!, Data(#"{"id":"invoice-1"}"#.utf8))
        }
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
