import SwiftUI

extension AppEnvironment {
    func evidenceURL(for path: String) -> URL? {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              let components = URLComponents(string: path),
              components.scheme == nil, components.host == nil,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.percentEncodedPath == path,
              !components.path.contains("..") else { return nil }
        let allowedPaths: Set<String> = [
            "/dashboard", "/operations", "/reconciliation", "/inventory",
            "/sales", "/reports", "/customers", "/purchases", "/notifications",
        ]
        guard allowedPaths.contains(components.path),
              let destination = URL(string: path, relativeTo: webBaseURL)?.absoluteURL,
              destination.scheme == webBaseURL.scheme,
              destination.host == webBaseURL.host,
              destination.user == nil, destination.password == nil else { return nil }
        return destination
    }
}

struct EvidenceLink: View {
    @Environment(AppSession.self) private var session
    let label: String
    let path: String

    var body: some View {
        if let destination = session.environment.evidenceURL(for: path) {
            Link(destination: destination) {
                Label(label, systemImage: "doc.text.magnifyingglass").font(.caption.weight(.semibold))
            }
            .accessibilityHint("Opens this record in the FuelNerve web application. You may need to sign in there.")
        } else {
            Label("Record link unavailable", systemImage: "exclamationmark.shield").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct StaleDataNotice: View {
    let updatedAt: Date
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
            VStack(alignment: .leading, spacing: 2) {
                Text("Showing the last available update").font(.subheadline.weight(.semibold))
                Text("Updated \(updatedAt.formatted(date: .abbreviated, time: .shortened))").font(.caption)
            }
            Spacer()
            Button("Retry", action: retry).buttonStyle(.bordered)
        }
        .padding(12).foregroundStyle(.orange).background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
    }
}
