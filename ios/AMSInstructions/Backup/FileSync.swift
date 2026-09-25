import CryptoKit
import Foundation
import SwiftData
import Observation

// Syncing the library between devices through one file in the app's own
// iCloud Drive folder — the same way the other AMS apps sync. No iCloud
// database, so no schema to set up and nothing to deploy.
//
// The file is an ordinary backup (the same JSON as "Back Up Now"), written
// whole. The rule is simple and said out loud in Data Safety: the most recent
// version wins. Before this device's library is ever replaced by the cloud's,
// it is saved into the automatic backup slot, so the losing side of a clash
// can always be put back by hand.
@MainActor
@Observable
final class FileSync {
    static let shared = FileSync()

    // What Data Safety shows.
    private(set) var available = false
    private(set) var waitingForDownload = false
    private(set) var lastSent: Date?
    private(set) var lastReceived: Date?
    private(set) var lastProblem: String?
    private(set) var lastProblemAt: Date?
    private(set) var busy = false

    private var container: ModelContainer?
    private var fileURL: URL?
    private var query: NSMetadataQuery?
    private var observers: [NSObjectProtocol] = []
    private var pendingUpload: Task<Void, Never>?
    private var pendingCheck: Task<Void, Never>?
    private var applying = false

    private let defaults = UserDefaults.standard
    private static let fileName = "Library.json"

    private enum Key {
        static let stamp = "fileSyncStamp"            // timestamp of the cloud file last applied or written
        static let dirty = "fileSyncDirty"            // library changed here since then
        static let changedAt = "fileSyncChangedAt"    // when it last changed here
        static let sentHash = "fileSyncSentHash"      // content last written, to skip identical uploads
        static let lastSent = "fileSyncLastSent"
        static let lastReceived = "fileSyncLastReceived"
    }

    private init() {
        lastSent = date(Key.lastSent)
        lastReceived = date(Key.lastReceived)
    }

    // MARK: Starting

    func start(container: ModelContainer) {
        guard self.container == nil else { return }
        self.container = container

        // Every save marks the library as changed here — except the saves made
        // while applying the cloud's version, which are not local edits.
        // Only the app's own context counts; the throwaway one used to check
        // backups saves too. The library is only ever saved on the main thread.
        let mainContext = container.mainContext
        observers.append(NotificationCenter.default.addObserver(
            forName: ModelContext.didSave, object: nil, queue: nil
        ) { [weak self] note in
            guard (note.object as? ModelContext) === mainContext else { return }
            MainActor.assumeIsolated {
                guard let self, !self.applying else { return }
                self.defaults.set(true, forKey: Key.dirty)
                self.defaults.set(Date().timeIntervalSince1970, forKey: Key.changedAt)
                self.scheduleUpload()
            }
        })

        // Finding the iCloud folder can take a moment and must not happen on
        // the main thread.
        Task.detached(priority: .utility) {
            let base = FileManager.default.url(forUbiquityContainerIdentifier: nil)
            await MainActor.run {
                guard let base else {
                    self.available = false
                    return
                }
                let documents = base.appendingPathComponent("Documents", isDirectory: true)
                try? FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
                self.fileURL = documents.appendingPathComponent(Self.fileName)
                self.available = true
                self.watchCloudFile()
                self.syncNow()
            }
        }
    }

    /// iCloud says the file changed (another device wrote it, or a download
    /// finished): look again.
    private func watchCloudFile() {
        let query = NSMetadataQuery()
        query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        query.predicate = NSPredicate(format: "%K == %@", NSMetadataItemFSNameKey, Self.fileName)
        for name in [NSNotification.Name.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: query, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.scheduleCheck() }
            })
        }
        query.start()
        self.query = query
    }

    private func scheduleCheck() {
        pendingCheck?.cancel()
        pendingCheck = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.syncNow()
        }
    }

    /// A quiet moment after the last edit, rather than on every keystroke.
    private func scheduleUpload() {
        pendingUpload?.cancel()
        pendingUpload = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            self?.syncNow()
        }
    }

    // MARK: Syncing

    /// Compares this device with the cloud file and moves whichever is behind.
    func syncNow() {
        guard let url = fileURL, let container, !busy else { return }
        busy = true
        defer { busy = false }

        let context = container.mainContext
        let dirty = defaults.bool(forKey: Key.dirty)
        let lastStamp = defaults.string(forKey: Key.stamp)

        switch readCloudFile(at: url) {
        case .missing:
            waitingForDownload = false
            // Nothing in iCloud yet: this device starts it, if it has anything.
            if dirty || !Library.all(Instruction.self, in: context).isEmpty {
                upload(from: context, to: url)
            }

        case .downloading:
            // Never write over a newer version that simply hasn't arrived yet.
            waitingForDownload = true

        case .unreadable(let error):
            waitingForDownload = false
            report("Could not read the library in iCloud Drive: \(error.localizedDescription)")

        case .ready(let backup):
            waitingForDownload = false
            let stamp = backup.timestamp ?? ""
            if stamp == lastStamp {
                if dirty { upload(from: context, to: url) }
                return
            }
            // Another device has written since this one last synced.
            if !dirty {
                apply(backup, stamp: stamp, in: context)
                return
            }
            // Both changed: the newer one wins.
            let cloudDate = ISO8601DateFormatter.backup.date(from: stamp) ?? .distantPast
            let localDate = date(Key.changedAt) ?? .distantPast
            if cloudDate > localDate {
                apply(backup, stamp: stamp, in: context)
            } else {
                upload(from: context, to: url)
            }
        }
    }

    /// Leaving the app: send anything not yet sent.
    func appWillResignActive() {
        pendingUpload?.cancel()
        if defaults.bool(forKey: Key.dirty) { syncNow() }
    }

    private enum CloudFile {
        case missing
        case downloading
        case unreadable(Error)
        case ready(BackupFile)
    }

    private func readCloudFile(at url: URL) -> CloudFile {
        let manager = FileManager.default
        let placeholder = url.deletingLastPathComponent()
            .appendingPathComponent("." + url.lastPathComponent + ".icloud")

        if !manager.fileExists(atPath: url.path) {
            guard manager.fileExists(atPath: placeholder.path) else { return .missing }
            try? manager.startDownloadingUbiquitousItem(at: url)
            return .downloading
        }

        let status = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
            .ubiquitousItemDownloadingStatus
        if let status, status != .current {
            try? manager.startDownloadingUbiquitousItem(at: url)
            return .downloading
        }

        var coordinationError: NSError?
        var result: CloudFile = .missing
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readURL in
            do {
                result = .ready(try Library.decode(Data(contentsOf: readURL)))
            } catch {
                result = .unreadable(error)
            }
        }
        if let coordinationError { return .unreadable(coordinationError) }
        return result
    }

    private func upload(from context: ModelContext, to url: URL) {
        var backup = Library.makeBackup(from: context)
        do {
            // Skip writing a file identical to the last one sent — opening an
            // instruction saves too, but changes nothing another device needs.
            let stampless = { () -> BackupFile in var copy = backup; copy.timestamp = nil; return copy }()
            let hash = SHA256.hash(data: try Library.encode(stampless))
                .map { String(format: "%02x", $0) }.joined()
            if hash == defaults.string(forKey: Key.sentHash), defaults.string(forKey: Key.stamp) != nil {
                defaults.set(false, forKey: Key.dirty)
                return
            }

            let stamp = ISO8601DateFormatter.backup.string(from: Date())
            backup.timestamp = stamp
            let data = try Library.encode(backup)

            var coordinationError: NSError?
            var writeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { writeURL in
                do { try data.write(to: writeURL, options: .atomic) } catch { writeError = error }
            }
            if let failure = coordinationError ?? writeError { throw failure }

            defaults.set(stamp, forKey: Key.stamp)
            defaults.set(hash, forKey: Key.sentHash)
            defaults.set(false, forKey: Key.dirty)
            lastSent = Date()
            defaults.set(lastSent?.timeIntervalSince1970, forKey: Key.lastSent)
            clearProblem()
        } catch {
            report("Could not save the library to iCloud Drive: \(error.localizedDescription)")
        }
    }

    private func apply(_ backup: BackupFile, stamp: String, in context: ModelContext) {
        applying = true
        defer { applying = false }

        // This device's version goes into the automatic backup first, so it
        // can be put back from Data Safety if the newer one was the wrong one.
        AutoBackup.keepForUndo(from: context)

        // "Recently viewed" belongs to this device, not to the library.
        var viewed: [String: Date] = [:]
        for instruction in Library.all(Instruction.self, in: context) {
            if let at = instruction.lastViewedAt { viewed[instruction.uid] = at }
        }

        do {
            try Library.replaceAll(with: backup, in: context)
            for instruction in Library.all(Instruction.self, in: context) {
                instruction.lastViewedAt = viewed[instruction.uid]
            }
            try context.save()
            defaults.set(stamp, forKey: Key.stamp)
            defaults.set(false, forKey: Key.dirty)
            lastReceived = Date()
            defaults.set(lastReceived?.timeIntervalSince1970, forKey: Key.lastReceived)
            clearProblem()
        } catch {
            report("Could not take over the library from iCloud Drive: \(error.localizedDescription)")
        }
    }

    // MARK: Status

    private func report(_ problem: String) {
        lastProblem = problem
        lastProblemAt = Date()
    }

    private func clearProblem() {
        lastProblem = nil
        lastProblemAt = nil
    }

    private func date(_ key: String) -> Date? {
        let value = defaults.double(forKey: key)
        return value > 0 ? Date(timeIntervalSince1970: value) : nil
    }
}
