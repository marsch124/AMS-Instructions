import Foundation
import SwiftData

// Automatic backups kept on this device, as backup files in the app's own
// storage. iCloud sync already keeps a copy off the phone, but sync faithfully
// copies mistakes too — a wipe on one device is a wipe on all of them. These
// files are the way back from that.
//
// Two slots: the current backup, and a previous generation at least a day
// older, so a bad current backup is never the only copy left.
enum AutoBackup {
    enum Slot: String, CaseIterable {
        case current, previous

        var label: String {
            self == .current ? "Automatic backup" : "Older automatic backup"
        }
    }

    struct Summary {
        let date: Date
        let instructions: Int
        let people: Int
        let audits: Int
        let actions: Int
    }

    private static var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Backups", isDirectory: true)
    }

    static func url(_ slot: Slot) -> URL {
        folder.appendingPathComponent(slot.rawValue + ".json")
    }

    private static let failedKey = "autoBackupFailedAt"

    static var failedAt: Date? {
        let value = UserDefaults.standard.double(forKey: failedKey)
        return value > 0 ? Date(timeIntervalSince1970: value) : nil
    }

    /// Writes the current library into the current slot. The old current slot
    /// becomes the previous one once it is a day old. An empty library never
    /// overwrites a backup that has something in it.
    @discardableResult
    static func save(from context: ModelContext) -> Bool {
        let backup = Library.makeBackup(from: context)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

            if let existing = summary(.current) {
                if backup.instructions.isEmpty && existing.instructions > 0 {
                    return true
                }
                if Date().timeIntervalSince(existing.date) >= Schedule.day || summary(.previous) == nil {
                    try? FileManager.default.removeItem(at: url(.previous))
                    try FileManager.default.copyItem(at: url(.current), to: url(.previous))
                }
            }

            let data = try Library.encode(backup)
            try data.write(to: url(.current), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            UserDefaults.standard.removeObject(forKey: failedKey)
            return true
        } catch {
            print("[AutoBackup] Could not save: \(error)")
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: failedKey)
            return false
        }
    }

    /// Before a deliberate wipe: the current backup rolls into the previous
    /// slot, so the wipe can be undone by hand from Data Safety.
    static func keepForUndo(from context: ModelContext) {
        save(from: context)
        try? FileManager.default.removeItem(at: url(.previous))
        try? FileManager.default.copyItem(at: url(.current), to: url(.previous))
    }

    static func load(_ slot: Slot) -> BackupFile? {
        guard let data = try? Data(contentsOf: url(slot)) else { return nil }
        return try? Library.decode(data)
    }

    static func summary(_ slot: Slot) -> Summary? {
        guard let backup = load(slot) else { return nil }
        let date = backup.timestamp.flatMap { ISO8601DateFormatter.backup.date(from: $0) }
            ?? ((try? FileManager.default.attributesOfItem(atPath: url(slot).path)[.modificationDate]) as? Date)
            ?? Date.distantPast
        return Summary(date: date, instructions: backup.instructions.count, people: backup.people.count,
                       audits: backup.audits.count, actions: backup.actions.count)
    }
}

// Checking a backup by actually restoring it, somewhere harmless: a throwaway
// in-memory library with the same rules as the real one. What it reports is
// what a real restore would do — not what the file claims to hold.
enum BackupCheck {
    struct Report {
        enum Verdict { case ok, warn, bad }

        var readable = true
        var restorable = false
        var instructions = 0
        var photos = 0
        var people = 0
        var audits = 0
        var actions = 0
        var restored: Int?
        var date: Date?
        var problems: [String] = []

        var verdict: Verdict {
            guard readable, restorable else { return .bad }
            return problems.isEmpty ? .ok : .warn
        }
    }

    static func check(data: Data) -> Report {
        guard let backup = try? Library.decode(data) else {
            var report = Report()
            report.readable = false
            report.problems = ["This file is not a backup the app can read."]
            return report
        }
        return check(backup)
    }

    static func check(_ backup: BackupFile) -> Report {
        var report = Report()
        report.date = backup.timestamp.flatMap { ISO8601DateFormatter.backup.date(from: $0) }
        report.instructions = backup.instructions.count
        report.people = backup.people.count
        report.audits = backup.audits.count
        report.actions = backup.actions.count

        if backup.instructions.isEmpty {
            report.problems.append("This backup contains no instructions. Restoring it would put nothing back.")
        }

        var seen = Set<String>()
        var duplicates = Set<String>()
        var missing = 0
        var photos = 0
        var broken = 0
        for dto in backup.instructions {
            guard let number = dto.number, !number.isEmpty, let title = dto.title, !title.isEmpty, dto.id != nil else {
                missing += 1
                continue
            }
            let normalized = Numbers.normalize(number)
            if !seen.insert(normalized).inserted { duplicates.insert(normalized) }
            for photo in dto.photos ?? [] {
                photos += 1
                if DataURI.decode(photo.data) == nil { broken += 1 }
            }
        }
        report.photos = photos

        if missing > 0 {
            report.problems.append(missing == 1
                ? "1 instruction is missing its number, title or identity, and would come back damaged."
                : "\(missing) instructions are missing their number, title or identity, and would come back damaged.")
        }
        if !duplicates.isEmpty {
            report.problems.append("Two instructions share the same number (\(duplicates.sorted().joined(separator: ", "))). Only one of each would come back.")
        }
        if broken > 0 {
            report.problems.append(broken == 1
                ? "1 photo is damaged and would not come back."
                : "\(broken) photos are damaged and would not come back.")
        }

        do {
            let schema = Schema(AppSchema.models)
            let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)
            let container = try ModelContainer(for: schema, configurations: config)
            let context = ModelContext(container)
            try Library.restore(backup, into: context)
            let restored = try context.fetchCount(FetchDescriptor<Instruction>())
            report.restored = restored
            let expected = seen.count
            report.restorable = restored == expected && expected > 0
            if restored != expected {
                report.problems.append("A test restore put back \(restored) of \(expected) instructions.")
            }
        } catch {
            report.problems.append("A test restore of this backup failed: \(error.localizedDescription)")
        }
        return report
    }
}
