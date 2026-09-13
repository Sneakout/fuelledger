import SwiftUI

@main
struct FuelNerveApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = AppSession(environment: .configured())

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
        }
    }
}
