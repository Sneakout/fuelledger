import Foundation

struct AppEnvironment: Sendable {
    enum Name: String, Sendable { case local, staging, production }

    enum ConfigurationError: Error, Equatable {
        case missingValue(String)
        case invalidEnvironment(String)
        case invalidURL(String)
        case insecureRemoteURL(String)
        case previewOutsideLocal
    }

    let apiBaseURL: URL
    let webBaseURL: URL
    let name: Name
    let usesPreviewData: Bool

    init(infoDictionary: [String: Any]) throws {
        func requiredString(_ key: String) throws -> String {
            guard let value = infoDictionary[key] as? String,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ConfigurationError.missingValue(key)
            }
            return value
        }

        let environmentValue = try requiredString("FuelNerveEnvironment").lowercased()
        guard let name = Name(rawValue: environmentValue) else {
            throw ConfigurationError.invalidEnvironment(environmentValue)
        }
        let apiValue = try requiredString("FuelNerveAPIBaseURL")
        let webValue = try requiredString("FuelNerveWebBaseURL")
        guard let apiBaseURL = URL(string: apiValue), apiBaseURL.host != nil else {
            throw ConfigurationError.invalidURL(apiValue)
        }
        guard let webBaseURL = URL(string: webValue), webBaseURL.host != nil else {
            throw ConfigurationError.invalidURL(webValue)
        }

        if name != .local {
            guard apiBaseURL.scheme == "https" else { throw ConfigurationError.insecureRemoteURL(apiValue) }
            guard webBaseURL.scheme == "https" else { throw ConfigurationError.insecureRemoteURL(webValue) }
        }

        let previewValue = (infoDictionary["FuelNerveUsePreviewData"] as? String)?.lowercased()
        let usesPreviewData = previewValue == "yes" || previewValue == "true" || previewValue == "1"
        guard !usesPreviewData || name == .local else { throw ConfigurationError.previewOutsideLocal }

        self.apiBaseURL = apiBaseURL
        self.webBaseURL = webBaseURL
        self.name = name
        self.usesPreviewData = usesPreviewData
    }

    static func configured(bundle: Bundle = .main) -> AppEnvironment {
        do { return try AppEnvironment(infoDictionary: bundle.infoDictionary ?? [:]) }
        catch { fatalError("FuelNerve has an invalid environment configuration: \(error)") }
    }
}
