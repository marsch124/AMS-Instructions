import SwiftUI
import SwiftData

// Bulk actions on the filtered list. Every one is a deliberate overwrite, so
// each goes through a confirmation that states the count and what it replaces,
// and each leaves an Undo behind — in the toast for the moment, and under
// Settings → Data Safety for later. Bulk edits write no revision history: two
// hundred "Updated" entries would bury the real edits.

/// The last bulk change, recording only the fields it touched — so an undo
/// three days later restores the owner without also reverting the steps you
/// rewrote yesterday. Kept on this device, like the web app's copy.
struct BulkUndoRecord: Codable {
    struct Entry: Codable {
        var uid: String
        var owner: String?
        var ownerID: String?
        var tags: [String]?
        var status: String?
        var warnings: String?
    }

    var label: String
    var timestamp: Date
    var fields: [String]
    var entries: [Entry]

    private static let key = "bulkUndo"

    static func load() -> BulkUndoRecord? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(BulkUndoRecord.self, from: data)
    }

    static func save(_ record: BulkUndoRecord?) {
        if let record, let data = try? JSONEncoder().encode(record) {
            UserDefaults.standard.set(data, forKey: key)
        } else {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }

    static func snapshot(_ items: [Instruction], fields: [String], label: String) -> BulkUndoRecord {
        BulkUndoRecord(label: label, timestamp: Date(), fields: fields, entries: items.map { i in
            Entry(uid: i.uid,
                  owner: fields.contains("owner") ? i.owner : nil,
                  ownerID: fields.contains("owner") ? i.ownerID : nil,
                  tags: fields.contains("tags") ? i.tags : nil,
                  status: fields.contains("status") ? i.status : nil,
                  warnings: fields.contains("warnings") ? i.warnings : nil)
        })
    }

    var fieldNames: String {
        Set(fields).sorted().joined(separator: " and ")
    }

    /// Puts the last bulk change back. Instructions deleted since are skipped
    /// rather than resurrected. Consumed once used. Returns (restored, missing).
    @discardableResult
    static func undo(in context: ModelContext) -> (Int, Int)? {
        guard let record = load(), !record.entries.isEmpty else { return nil }
        let byUID = Dictionary(Library.all(Instruction.self, in: context).map { ($0.uid, $0) },
                               uniquingKeysWith: { a, _ in a })
        var restored = 0, missing = 0
        for entry in record.entries {
            guard let instruction = byUID[entry.uid] else { missing += 1; continue }
            if record.fields.contains("owner") {
                instruction.owner = entry.owner ?? ""
                instruction.ownerID = entry.ownerID
            }
            if record.fields.contains("tags") { instruction.tags = entry.tags ?? [] }
            if record.fields.contains("status"), let status = entry.status { instruction.status = status }
            if record.fields.contains("warnings") { instruction.warnings = entry.warnings ?? "" }
            restored += 1
        }
        try? context.save()
        save(nil)
        return (restored, missing)
    }

    static func undoMessage(_ result: (Int, Int)?) -> String {
        guard let result else { return "Nothing to undo" }
        let (restored, missing) = result
        return missing > 0
            ? "↩︎ Put back \(restored) — \(missing) no longer \(missing == 1 ? "exists" : "exist")"
            : "↩︎ Put back as it was"
    }
}

struct BulkPanel: View {
    let items: [Instruction]
    let searchTerm: String

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(ToastCenter.self) private var toasts
    @Query(sort: \Person.name) private var people: [Person]

    @State private var ownerID = ""
    @State private var tag = ""
    @State private var status = InstructionStatus.active.rawValue
    @State private var pending: PendingChange?

    struct PendingChange: Identifiable {
        let id = UUID()
        let title: String
        let message: String
        let apply: () -> Void
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(items.count == 1 ? "The 1 instruction now listed" : "All \(items.count) instructions now listed")
                        .font(.headline)
                }

                Section("Owner") {
                    if people.isEmpty {
                        Text("Add someone under Settings → Manage People first.")
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Person", selection: $ownerID) {
                            ForEach(people) { Text($0.name).tag($0.uid) }
                        }
                        Button("Set owner on \(items.count)") { confirmOwner() }
                            .disabled(ownerID.isEmpty)
                    }
                }

                Section("Tag") {
                    TextField("Tag to add", text: $tag)
                        .textInputAutocapitalization(.never)
                    Button("Add tag to \(items.count)") { confirmTag() }
                        .disabled(tag.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                Section("Status") {
                    Picker("Status", selection: $status) {
                        ForEach(InstructionStatus.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
                    }
                    Button("Set status on \(items.count)") { confirmStatus() }
                }
            }
            .navigationTitle("Apply to all")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .onAppear {
                if ownerID.isEmpty { ownerID = people.first?.uid ?? "" }
            }
            .alert(pending?.title ?? "", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
                   presenting: pending) { change in
                Button("Cancel", role: .cancel) {}
                Button("Confirm") { change.apply() }
            } message: { change in
                Text(change.message)
            }
        }
    }

    /// With a search term as well, the slice is the overlap — worth spelling out.
    private var scopeNote: String {
        searchTerm.isEmpty ? "" : " (the filtered list, narrowed by your search for \"\(searchTerm)\")"
    }

    private func confirmOwner() {
        guard let person = people.first(where: { $0.uid == ownerID }) else { return }
        pending = PendingChange(
            title: "Set owner on \(items.count)?",
            message: "\(person.name) becomes the owner of all \(items.count) instructions currently listed\(scopeNote). This replaces any owner they already have. You can undo it straight afterwards."
        ) {
            apply(fields: ["owner"], label: "\(person.name) set as owner on \(items.count)") { i in
                i.owner = person.name
                i.ownerID = person.uid
            }
        }
    }

    private func confirmTag() {
        let tag = tag.trimmingCharacters(in: .whitespaces)
        pending = PendingChange(
            title: "Add \"\(tag)\" to \(items.count)?",
            message: "The tag is added to all \(items.count) instructions currently listed\(scopeNote). Any that already carry it are left alone, and nothing else changes."
        ) {
            apply(fields: ["tags"], label: "\"\(tag)\" added to \(items.count)") { i in
                if !i.tags.contains(tag) { i.tags.append(tag) }
            }
            self.tag = ""
        }
    }

    private func confirmStatus() {
        let status = status
        let extra = status == InstructionStatus.archived.rawValue
            ? " Archived instructions never fall due, and drop off the Due list." : ""
        pending = PendingChange(
            title: "Set status to \(status) on \(items.count)?",
            message: "All \(items.count) instructions currently listed\(scopeNote) are set to \(status), replacing whatever status they have now.\(extra) You can undo it straight afterwards."
        ) {
            apply(fields: ["status"], label: "\(items.count) set to \(status)") { $0.status = status }
        }
    }

    private func apply(fields: [String], label: String, change: (Instruction) -> Void) {
        let record = BulkUndoRecord.snapshot(items, fields: fields, label: label)
        items.forEach(change)
        try? context.save()
        // Saved after the change: an undo for something that never happened
        // would be worse than none.
        BulkUndoRecord.save(record)
        dismiss()
        let context = context
        let toasts = toasts
        toasts.show("✓ " + label, actionLabel: "Undo") {
            toasts.show(BulkUndoRecord.undoMessage(BulkUndoRecord.undo(in: context)))
        }
    }
}
