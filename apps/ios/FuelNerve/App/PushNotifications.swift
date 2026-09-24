import UIKit
import GoogleSignIn
@preconcurrency import UserNotifications

extension Notification.Name {
    static let fuelNervePushToken = Notification.Name("fuelNervePushToken")
    static let fuelNerveOpenApproval = Notification.Name("fuelNerveOpenApproval")
    static let fuelNerveOpenAlert = Notification.Name("fuelNerveOpenAlert")
    static let fuelNerveOpenBriefing = Notification.Name("fuelNerveOpenBriefing")
    static let fuelNerveRecordsChanged = Notification.Name("fuelNerveRecordsChanged")
}

enum PushNavigation {
    static let pendingApprovalKey = "fuelNervePendingApprovalId"
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "fuelNervePushToken")
        NotificationCenter.default.post(name: .fuelNervePushToken, object: token)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        if let approvalId = notification.request.content.userInfo["approvalId"] as? String, !approvalId.isEmpty {
            await MainActor.run {
                UserDefaults.standard.set(approvalId, forKey: PushNavigation.pendingApprovalKey)
                NotificationCenter.default.post(name: .fuelNerveOpenApproval, object: approvalId)
            }
        }
        if let alertId = notification.request.content.userInfo["alertId"] as? String, !alertId.isEmpty {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveOpenAlert, object: alertId) }
        }
        return [.banner, .sound, .badge]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if response.notification.request.content.userInfo["notificationType"] as? String == "DAILY_SUMMARY" {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveOpenBriefing, object: nil) }
            return
        }
        if let approvalId = response.notification.request.content.userInfo["approvalId"] as? String,
           !approvalId.isEmpty {
            await MainActor.run {
                UserDefaults.standard.set(approvalId, forKey: PushNavigation.pendingApprovalKey)
                NotificationCenter.default.post(name: .fuelNerveOpenApproval, object: approvalId)
            }
            return
        }
        if let alertId = response.notification.request.content.userInfo["alertId"] as? String, !alertId.isEmpty {
            await MainActor.run { NotificationCenter.default.post(name: .fuelNerveOpenAlert, object: alertId) }
        }
        guard let path = response.notification.request.content.userInfo["evidencePath"] as? String,
              let url = AppEnvironment.configured().evidenceURL(for: path) else { return }
        await MainActor.run { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
    }
}

@MainActor
func requestPushNotifications() async {
    let center = UNUserNotificationCenter.current()
    let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    if granted { UIApplication.shared.registerForRemoteNotifications() }
}
