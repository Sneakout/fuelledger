import SwiftUI

enum FuelNerveTheme {
    static let forest = Color(red: 0.04, green: 0.23, blue: 0.18)
    static let green = Color(red: 0.04, green: 0.47, blue: 0.31)
    static let lime = Color(red: 0.82, green: 0.96, blue: 0.27)
    static let gold = Color(red: 0.78, green: 0.50, blue: 0.02)
    static let canvas = Color(red: 0.97, green: 0.98, blue: 0.97)
}

struct MetricCard: View {
    let title: String
    let value: String
    let detail: String
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: symbol).foregroundStyle(FuelNerveTheme.green)
            Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            Text(value).font(.title2.weight(.bold)).foregroundStyle(FuelNerveTheme.forest)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .background(.white, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(FuelNerveTheme.forest.opacity(0.055)))
    }
}
