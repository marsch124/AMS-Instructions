import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct DataSafetyView: View {
    @Environment(\.modelContext) private var context
    @Environment(LocalState.self) private var local
    @Environment(ToastCenter.self) private var toasts
    @Query private var instructions: [Instruction]
    @Query private var people: [Person]
    @Query private var audits: [Audit]
    @Query private var actions: [ActionItem]

    @State private var reports: [(String, BackupCheck.Report)] = []
    @State private var checking = false
    @State private var checkingFile = false
    @State private var restoring: AutoBackup.Slot?
    @State private var confirmingUndo = false
    @State private var exporting = false
    @State private var refresh = 0
    @State private var message: String?

    var body: some View {
        List {
            if let failed = AutoBackup.failedAt {
                Section {
                    Label("The last automatic backup could not be saved (\(Formatting.relative(failed))). Storage on this device may be full. Use Back Up Now to keep a copy somewhere safe.",
                          systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Palette.danger)
                }
            }

            ICloudStatusSection()

            Section("In the app now") {
                Text(describe(instructions.count, people.count, audits.count, actions.count))
            }

            Section {
                ForEach(AutoBackup.Slot.allCases, id: \.self) { slot in
                    slotRow(slot)
                }
            } header: {
                Text("Automatic backups on this device")
            } footer: {
                Text("Saved whenever you leave the app. The older one is kept at least a day behind, so a bad backup is never the only copy.")
            }

            Section {
                Button {
                    exporting = true
                } label: {
                    Label("Back Up Now", systemImage: "externaldrive.badge.icloud")
                }
                LabeledContent("Last backup file",
                               value: local.lastExport.map(Formatting.dateAndTime) ?? "Never backed up")
            }

            if let record = BulkUndoRecord.load() {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(record.label) · \(Formatting.relative(record.timestamp))").font(.subheadline.weight(.semibold))
                        Text("Puts the \(record.fieldNames) back exactly as it was on those \(record.entries.count), and touches nothing else. Only the most recent bulk change can be undone.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Button("Undo Last Bulk Change") { confirmingUndo = true }
                } header: {
                    Text("Last bulk change")
                }
                .id(refresh)
            }

            Section {
                Button {
                    checkSlots()
                } label: {
                    Label("Check the Automatic Backups", systemImage: "checkmark.shield")
                }
                .disabled(checking)
                Button {
                    checkingFile = true
                } label: {
                    Label("Check a Backup File", systemImage: "doc.badge.gearshape")
                }
            } header: {
                Text("Check a backup")
            } footer: {
                Text("A check restores the backup into a throwaway copy of the library and counts what comes back — so it reports what a real restore would do, not what the file claims.")
            }

            ForEach(Array(reports.enumerated()), id: \.offset) { _, entry in
                Section(entry.0) {
                    ReportView(report: entry.1)
                }
            }
        }
        .navigationTitle("Data Safety")
        .sheet(isPresented: $exporting) { BackupExportSheet() }
        .fileImporter(isPresented: $checkingFile, allowedContentTypes: [.json]) { result in
            checkFile(result)
        }
        .confirmationDialog(restoring.map { "Restore the \($0.label.lowercased())?" } ?? "",
                            isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } }),
                            titleVisibility: .visible, presenting: restoring) { slot in
            Button("Restore") { restore(slot) }
        } message: { _ in
            Text("Anything currently in the app with the same number will be replaced by the backup’s version. Nothing else is deleted.")
        }
        .confirmationDialog("Undo the last bulk change?", isPresented: $confirmingUndo, titleVisibility: .visible) {
            Button("Undo") {
                toasts.show(BulkUndoRecord.undoMessage(BulkUndoRecord.undo(in: context)))
                refresh += 1
            }
        } message: {
            Text("Anything else you have edited since is left alone. It can only be done once.")
        }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private func describe(_ instructions: Int, _ people: Int, _ audits: Int, _ actions: Int) -> String {
        [Formatting.plural(instructions, "instruction"),
         Formatting.plural(people, "person", "people"),
         Formatting.plural(audits, "audit"),
         Formatting.plural(actions, "to-do")].joined(separator: " · ")
    }

    @ViewBuilder
    private func slotRow(_ slot: AutoBackup.Slot) -> some View {
        if let summary = AutoBackup.summary(slot) {
            VStack(alignment: .leading, spacing: 4) {
                Text(slot.label).font(.subheadline.weight(.semibold))
                Text(Formatting.dateAndTime(summary.date)).font(.caption)
                Text(describe(summary.instructions, summary.people, summary.audits, summary.actions))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if summary.instructions > 0 {
                    Button("Restore This Backup") { restoring = slot }
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.bordered)
                }
            }
            .id("\(slot.rawValue)-\(refresh)")
        } else {
            VStack(alignment: .leading) {
                Text(slot.label).font(.subheadline.weight(.semibold))
                Text("No backup yet").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func restore(_ slot: AutoBackup.Slot) {
        guard let backup = AutoBackup.load(slot) else {
            message = "That backup is no longer available."
            return
        }
        do {
            let result = try Library.restore(backup, into: context)
            message = "Restored \(Formatting.plural(result.instructions, "instruction"))."
        } catch {
            message = "Restore failed: \(error.localizedDescription)"
        }
    }

    private func checkSlots() {
        checking = true
        defer { checking = false }
        var results: [(String, BackupCheck.Report)] = []
        var best = 0
        for slot in AutoBackup.Slot.allCases {
            if let backup = AutoBackup.load(slot) {
                let report = BackupCheck.check(backup)
                best = max(best, report.instructions)
                results.append((slot.label, report))
            } else {
                var report = BackupCheck.Report()
                report.readable = false
                report.problems = ["There is no backup in this slot yet."]
                results.append((slot.label, report))
            }
        }
        // A backup that restores perfectly can still be missing this morning's work.
        let behind = instructions.count - best
        var summary = BackupCheck.Report()
        summary.readable = true
        summary.restorable = behind <= 0
        summary.instructions = instructions.count
        summary.problems = behind > 0
            ? ["The app holds \(instructions.count) instructions — \(behind) more than the best backup. Leave the app briefly to save a fresh one."]
            : []
        results.append(("Compared with the app", summary))
        reports = results
    }

    private func checkFile(_ result: Result<URL, Error>) {
        guard let url = try? result.get() else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            message = "Could not read that file."
            return
        }
        reports = [(url.lastPathComponent, BackupCheck.check(data: data))]
    }
}

/// Whether iCloud sync is working, in words — the one place on the phone that
/// shows a sync problem at all.
private struct ICloudStatusSection: View {
    private var sync = FileSync.shared

    var body: some View {
        Section {
            LabeledContent("iCloud Drive", value: sync.available ? "Signed in" : "Not available")
            LabeledContent("Last sent", value: sync.lastSent.map(Formatting.relative) ?? "Not yet")
            LabeledContent("Last received", value: sync.lastReceived.map(Formatting.relative) ?? "Not yet")
            if sync.waitingForDownload {
                Label("Waiting for iCloud to download the latest version…", systemImage: "icloud.and.arrow.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let problem = sync.lastProblem {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Last problem", systemImage: "exclamationmark.icloud")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.orange)
                    Text(problem)
                        .font(.caption)
                        .textSelection(.enabled)
                    if let at = sync.lastProblemAt {
                        Text(Formatting.relative(at)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            Button {
                sync.syncNow()
            } label: {
                Label(sync.busy ? "Syncing…" : "Sync Now", systemImage: "arrow.triangle.2.circlepath.icloud")
            }
            .disabled(!sync.available || sync.busy)
        } header: {
            Text("iCloud sync")
        } footer: {
            Text(sync.available
                 ? "The library is kept as one file in this app's iCloud Drive folder, so it reaches every device signed in to the same iCloud. If two devices change it before syncing, the more recent version wins; the other is kept in the automatic backups below."
                 : "Sign in to iCloud and turn on iCloud Drive in the iPhone's Settings for the library to sync.")
        }
    }
}

private struct ReportView: View {
    let report: BackupCheck.Report

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // The verdict first — the counts are the evidence, not the answer.
            switch report.verdict {
            case .ok:
                Label(report.restored == nil ? "In step" : "Restores cleanly", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Palette.success)
            case .warn:
                Label("Restores, but read this", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            case .bad:
                Label(report.readable ? "Would not restore properly" : "Not a backup this app can read",
                      systemImage: "xmark.octagon.fill")
                    .foregroundStyle(Palette.danger)
            }
            if let date = report.date {
                Text("Saved \(Formatting.dateAndTime(date))").font(.caption)
            }
            if report.readable, report.restored != nil {
                Text([Formatting.plural(report.instructions, "instruction"),
                      Formatting.plural(report.photos, "photo"),
                      Formatting.plural(report.people, "person", "people"),
                      Formatting.plural(report.audits, "audit"),
                      Formatting.plural(report.actions, "to-do")].joined(separator: " · "))
                    .font(.caption)
                Text("Test restore put back \(report.restored ?? 0) of \(Formatting.plural(report.instructions, "instruction")).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(report.problems, id: \.self) { problem in
                Text("⚠ " + problem).font(.caption).foregroundStyle(.orange)
            }
        }
    }
}
