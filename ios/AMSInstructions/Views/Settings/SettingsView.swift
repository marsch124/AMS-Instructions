import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Environment(ToastCenter.self) private var toasts
    @Environment(LocalState.self) private var local
    @Query private var instructions: [Instruction]

    @State private var path = NavigationPath()
    @State private var exporting = false
    @State private var importing = false
    @State private var pendingRestore: PendingRestore?
    @State private var confirmingClear = false
    @State private var confirmingStarter = false
    @State private var message: String?
    @State private var aiDraftsOn = APIKeyStore.hasKey

    struct PendingRestore: Identifiable {
        let id = UUID()
        let name: String
        let backup: BackupFile
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section("Checklists") {
                    NavigationLink(value: SettingsRoute.run) {
                        Label("Run a Set", systemImage: "figure.walk")
                    }
                    NavigationLink(value: SettingsRoute.health) {
                        Label("Library Health", systemImage: "stethoscope")
                    }
                }

                Section("People") {
                    NavigationLink(value: SettingsRoute.people) {
                        Label("Manage People", systemImage: "person.2")
                    }
                }

                Section {
                    NavigationLink(value: SettingsRoute.ai) {
                        LabeledContent {
                            Text(aiDraftsOn ? "On" : "Off")
                        } label: {
                            Label("AI Drafts", systemImage: "sparkles")
                        }
                    }
                } footer: {
                    Text("Claude drafts a new instruction from photos of the item.")
                }

                Section {
                    Button {
                        exporting = true
                    } label: {
                        Label("Back Up Now", systemImage: "externaldrive.badge.icloud")
                    }
                    NavigationLink(value: SettingsRoute.dataSafety) {
                        Label("Data Safety", systemImage: "lock.shield")
                    }
                    Button {
                        importing = true
                    } label: {
                        Label("Restore from a Backup File", systemImage: "arrow.counterclockwise")
                    }
                    Button {
                        confirmingStarter = true
                    } label: {
                        Label("Load the Starter Library", systemImage: "books.vertical")
                    }
                } header: {
                    Text("Data")
                } footer: {
                    Text("Your library syncs between your devices through iCloud. A backup file is a copy you keep yourself — in Files, iCloud Drive or anywhere else.")
                }

                Section("About") {
                    NavigationLink(value: SettingsRoute.about) {
                        Label("How This Works", systemImage: "book")
                    }
                    LabeledContent("Version", value: appVersion)
                    LabeledContent("Instructions", value: "\(instructions.count)")
                }

                Section {
                    Button("Clear All Data", role: .destructive) { confirmingClear = true }
                }
            }
            .navigationTitle("Settings")
            // Back from the AI Drafts page, the key may have been added or removed.
            .onAppear { aiDraftsOn = APIKeyStore.hasKey }
            .navigationDestination(for: SettingsRoute.self) { route in
                switch route {
                case .run: RunPickerView()
                case .health: HealthView()
                case .people: PeopleView()
                case .dataSafety: DataSafetyView()
                case .about: AboutView()
                case .ai: AIKeyView()
                }
            }
            .instructionDestinations()
            .sheet(isPresented: $exporting) {
                BackupExportSheet()
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                readBackupFile(result)
            }
            .alert(pendingRestore.map { "Restore \($0.name)?" } ?? "",
                   isPresented: Binding(get: { pendingRestore != nil }, set: { if !$0 { pendingRestore = nil } }),
                   presenting: pendingRestore) { pending in
                Button("Cancel", role: .cancel) {}
                Button("Restore") { restore(pending.backup) }
            } message: { pending in
                let count = pending.backup.instructions.count
                Text("Put back \(Formatting.plural(count, "instruction"))? Anything currently in the app with the same number will be replaced by the backup’s version. Nothing else is deleted.")
            }
            .confirmationDialog("Load the starter library?", isPresented: $confirmingStarter, titleVisibility: .visible) {
                Button("Load 205 instructions") { loadStarter() }
            } message: {
                Text("Adds the ready-made RV, home and sport instructions. Any of yours with the same number are replaced.")
            }
            .confirmationDialog("Clear all data?", isPresented: $confirmingClear, titleVisibility: .visible) {
                Button("Clear All Data", role: .destructive) { clearAll() }
            } message: {
                Text("This deletes all instructions, audits and to-dos — on every device signed in to the same iCloud account. Your People list is kept. A backup taken just beforehand stays available under Data Safety, so this can still be undone from there.")
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            }
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    private func readBackupFile(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let backup = try Library.decode(Data(contentsOf: url))
            pendingRestore = PendingRestore(name: url.lastPathComponent, backup: backup)
        } catch {
            message = "Could not read that file: \(error.localizedDescription)"
        }
    }

    private func restore(_ backup: BackupFile) {
        do {
            let result = try Library.restore(backup, into: context)
            AutoBackup.save(from: context)
            message = "Backup restored: \(Formatting.plural(result.instructions, "instruction"))."
        } catch {
            message = "Restore failed: \(error.localizedDescription)"
        }
    }

    private func loadStarter() {
        do {
            let result = try Library.restore(Library.starterLibrary(), into: context)
            toasts.show("✓ \(Formatting.plural(result.instructions, "instruction")) loaded")
        } catch {
            message = "Could not load the starter library: \(error.localizedDescription)"
        }
    }

    private func clearAll() {
        AutoBackup.keepForUndo(from: context)
        do {
            try Library.clearAll(in: context)
            local.currentRun = nil
            BulkUndoRecord.save(nil)
            message = "All data cleared."
        } catch {
            message = "Could not clear the data: \(error.localizedDescription)"
        }
    }
}

enum SettingsRoute: Hashable {
    case run, health, people, dataSafety, about, ai
}

// MARK: - Back up now

/// Writes a backup file and hands it to Files or the share sheet. Same format
/// as the web app's backups, so either can restore the other's.
struct BackupExportSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(LocalState.self) private var local

    @State private var file: BackupDocument?
    @State private var summary = ""
    @State private var saving = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "externaldrive.badge.icloud")
                    .font(.system(size: 56))
                    .foregroundStyle(.tint)
                if let failure {
                    Text(failure).foregroundStyle(Palette.danger)
                } else if let file {
                    Text(summary).multilineTextAlignment(.center)
                    Button {
                        saving = true
                    } label: {
                        Label("Save to Files", systemImage: "folder")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    ShareLink(item: file.temporaryURL) {
                        Label("Share…", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .simultaneousGesture(TapGesture().onEnded { local.lastExport = Date() })
                } else {
                    ProgressView("Preparing backup…")
                }
                Spacer()
            }
            .padding(24)
            .navigationTitle("Back Up Now")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { prepare() }
            .fileExporter(isPresented: $saving, document: file, contentType: .json,
                          defaultFilename: file?.fileName) { result in
                if case .success = result {
                    local.lastExport = Date()
                    dismiss()
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func prepare() {
        guard file == nil else { return }
        do {
            let backup = Library.makeBackup(from: context)
            let data = try Library.encode(backup)
            let name = Library.backupFileName()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            file = BackupDocument(data: data, fileName: name, temporaryURL: url)
            summary = [
                Formatting.plural(backup.instructions.count, "instruction"),
                Formatting.plural(backup.people.count, "person", "people"),
                Formatting.plural(backup.audits.count, "audit"),
                Formatting.plural(backup.actions.count, "to-do")
            ].joined(separator: " · ")
        } catch {
            failure = "Could not prepare the backup: \(error.localizedDescription)"
        }
    }
}

struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    var data: Data
    var fileName: String
    var temporaryURL: URL

    init(data: Data, fileName: String, temporaryURL: URL) {
        self.data = data
        self.fileName = fileName
        self.temporaryURL = temporaryURL
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
        fileName = configuration.file.filename ?? "backup.json"
        temporaryURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
