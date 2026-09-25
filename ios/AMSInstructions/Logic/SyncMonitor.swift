import CoreData
import CloudKit
import Foundation
import Observation

// What iCloud sync is doing, in words, for Settings → Data Safety.
//
// SwiftData syncs through Core Data's CloudKit mirroring, which reports every
// setup, import and export as an event. Listening to those is the only way to
// see from the phone whether sync is working — a missing schema or a full
// iCloud account otherwise fails silently while the app carries on locally.
@Observable
final class SyncMonitor {
    static let shared = SyncMonitor()

    private(set) var lastSuccess: Date?
    private(set) var lastError: String?
    private(set) var lastErrorAt: Date?
    private(set) var hasActivity = false
    private(set) var inProgress = false

    private var observer: NSObjectProtocol?
    private let defaults = UserDefaults.standard

    private init() {
        let success = defaults.double(forKey: "syncLastSuccess")
        lastSuccess = success > 0 ? Date(timeIntervalSince1970: success) : nil
        lastError = defaults.string(forKey: "syncLastError")
        let errorAt = defaults.double(forKey: "syncLastErrorAt")
        lastErrorAt = errorAt > 0 ? Date(timeIntervalSince1970: errorAt) : nil
    }

    func start() {
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(
            forName: NSPersistentCloudKitContainer.eventChangedNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let event = notification.userInfo?[NSPersistentCloudKitContainer.eventNotificationUserInfoKey]
                    as? NSPersistentCloudKitContainer.Event else { return }
            self?.record(event)
        }
    }

    private func record(_ event: NSPersistentCloudKitContainer.Event) {
        hasActivity = true
        guard let end = event.endDate else {
            inProgress = true
            return
        }
        inProgress = false
        if event.succeeded {
            lastSuccess = end
            defaults.set(end.timeIntervalSince1970, forKey: "syncLastSuccess")
            // An old error stops being news once a later sync has worked.
            if let errorAt = lastErrorAt, errorAt < end {
                lastError = nil
                defaults.removeObject(forKey: "syncLastError")
            }
        } else if let error = event.error {
            let kind: String
            switch event.type {
            case .setup: kind = "Setting up"
            case .import: kind = "Receiving"
            case .export: kind = "Sending"
            @unknown default: kind = "Syncing"
            }
            lastError = kind + ": " + Self.describe(error)
            lastErrorAt = end
            defaults.set(lastError, forKey: "syncLastError")
            defaults.set(end.timeIntervalSince1970, forKey: "syncLastErrorAt")
        }
    }

    /// The iCloud store could not be opened at launch, so the library is on
    /// this device only until the next launch.
    private(set) var fellBack = false

    func storeFellBack(_ error: Error) {
        fellBack = true
        lastError = "The iCloud library could not be opened, so this launch uses the library on the phone only: " + Self.describe(error)
        lastErrorAt = Date()
    }

    /// Signed in to iCloud on this device. Nil-safe even without the iCloud
    /// capability, unlike asking CloudKit directly.
    var signedIn: Bool {
        FileManager.default.ubiquityIdentityToken != nil
    }

    static func describe(_ error: Error) -> String {
        let ns = error as NSError
        if let ck = error as? CKError {
            switch ck.code {
            case .notAuthenticated:
                return "not signed in to iCloud on this device."
            case .quotaExceeded:
                return "your iCloud storage is full."
            case .networkUnavailable, .networkFailure:
                return "no internet connection — it tries again by itself."
            case .serverRejectedRequest, .partialFailure, .invalidArguments:
                return "Apple refused the data (\(ck.code.rawValue)). Usually the iCloud schema has not been deployed to Production yet. \(ns.localizedDescription)"
            default:
                break
            }
        }
        return "\(ns.localizedDescription) (\(ns.domain) \(ns.code))"
    }
}
