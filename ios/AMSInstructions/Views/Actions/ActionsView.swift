import SwiftUI
import SwiftData

struct ActionsView: View {
    @Query private var actions: [ActionItem]
    @State private var path = NavigationPath()
    @State private var editing: ActionEditorTarget?

    var body: some View {
        let open = ActionOrdering.open(actions)
        let done = actions.filter(\.isDone).sorted { ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast) }

        NavigationStack(path: $path) {
            List {
                Section("Open") {
                    if open.isEmpty {
                        Text("Nothing to do. Tap + to add a to-do.").foregroundStyle(.secondary)
                    }
                    ForEach(open) { action in
                        ActionRow(action: action) { editing = ActionEditorTarget(action: action) }
                    }
                }
                if !done.isEmpty {
                    Section("Done") {
                        ForEach(done) { action in
                            ActionRow(action: action) { editing = ActionEditorTarget(action: action) }
                        }
                    }
                }
            }
            .navigationTitle("Actions")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editing = ActionEditorTarget(action: nil)
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("New to-do")
                }
            }
            .instructionDestinations()
            .sheet(item: $editing) { target in
                ActionEditorView(action: target.action, fromAudit: nil)
            }
        }
    }
}

struct ActionEditorTarget: Identifiable {
    let id = UUID()
    let action: ActionItem?
}

enum ActionOrdering {
    /// Most pressing first: high priority, then soonest due (undated last),
    /// then oldest.
    static func open(_ actions: [ActionItem]) -> [ActionItem] {
        actions.filter { !$0.isDone }.sorted { a, b in
            if a.isHighPriority != b.isHighPriority { return a.isHighPriority }
            let dueA = Formatting.day(from: a.dueDate) ?? .distantFuture
            let dueB = Formatting.day(from: b.dueDate) ?? .distantFuture
            if dueA != dueB { return dueA < dueB }
            return a.createdAt < b.createdAt
        }
    }

    static func isOverdue(_ action: ActionItem) -> Bool {
        guard let due = Formatting.day(from: action.dueDate) else { return false }
        return due < Calendar.current.startOfDay(for: Date())
    }
}

struct ActionRow: View {
    @Bindable var action: ActionItem
    let onEdit: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                action.status = action.isDone ? "open" : "done"
                action.completedAt = action.isDone ? Date() : nil
            } label: {
                Image(systemName: action.isDone ? "checkmark.square.fill" : "square")
                    .font(.title2)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(action.isDone ? "Mark as not done" : "Mark as done")

            VStack(alignment: .leading, spacing: 4) {
                Text(action.title)
                    .strikethrough(action.isDone)
                    .foregroundStyle(action.isDone ? .secondary : .primary)
                HStack(spacing: 6) {
                    if !action.isDone && action.isHighPriority {
                        Chip(text: "High", color: Palette.danger)
                    }
                    if let due = Formatting.day(from: action.dueDate) {
                        Chip(text: "📅 " + due.formatted(date: .abbreviated, time: .omitted),
                             color: !action.isDone && ActionOrdering.isOverdue(action) ? Palette.danger : .secondary)
                    }
                    if let number = action.instructionNumber, !number.isEmpty {
                        NavigationLink(value: InstructionNumberRoute(number: number)) {
                            Chip(text: "#" + number, color: .accentColor)
                        }
                        .buttonStyle(.borderless)
                    }
                    if action.sourceAuditID != nil {
                        Chip(text: "🔍 From audit", color: .secondary)
                    }
                }
                if !action.notes.isEmpty {
                    Text(action.notes)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onEdit)
    }
}

struct Chip: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }
}

struct ActionEditorView: View {
    let action: ActionItem?
    /// Set when the to-do comes from an audit finding's "Convert to Action".
    let fromAudit: Audit?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Instruction.number) private var instructions: [Instruction]

    @State private var title = ""
    @State private var notes = ""
    @State private var high = false
    @State private var hasDue = false
    @State private var due = Date()
    @State private var instructionUID = ""
    @State private var loaded = false
    @State private var confirmingDelete = false

    var body: some View {
        NavigationStack {
            Form {
                if let note = sourceNote {
                    Section { Text(note).font(.callout).foregroundStyle(.secondary) }
                }
                Section {
                    TextField("What needs doing?", text: $title)
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...8)
                }
                Section {
                    Toggle("High priority", isOn: $high)
                    Toggle("Due date", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Due", selection: $due, displayedComponents: .date)
                    }
                    Picker("Instruction", selection: $instructionUID) {
                        Text("None (general to-do)").tag("")
                        ForEach(instructions) { Text("\($0.number) — \($0.title)").tag($0.uid) }
                    }
                }
                if action != nil {
                    Section {
                        Button("Delete To-do", role: .destructive) { confirmingDelete = true }
                    }
                }
            }
            .navigationTitle(fromAudit != nil ? "New Action from Audit" : (action == nil ? "New Action" : "Edit Action"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .bold()
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear(perform: load)
            .confirmationDialog("Delete \"\(action?.title ?? "")\"?", isPresented: $confirmingDelete,
                                titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let action { context.delete(action) }
                    try? context.save()
                    dismiss()
                }
            }
        }
    }

    private var sourceNote: String? {
        if let audit = fromAudit {
            return "From the audit by \(audit.auditorName.isEmpty ? "Unknown" : audit.auditorName) on \(audit.timestamp.formatted(date: .abbreviated, time: .omitted))."
        }
        if let action, action.sourceAuditID != nil {
            return "Created from an audit finding" +
                (action.instructionNumber.map { " on instruction \($0)" } ?? "") + "."
        }
        return nil
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let action {
            title = action.title
            notes = action.notes
            high = action.isHighPriority
            if let date = Formatting.day(from: action.dueDate) {
                hasDue = true
                due = date
            }
            instructionUID = action.instructionUID ?? ""
        } else if let audit = fromAudit {
            // The first line becomes the title; the whole finding stays in the
            // notes so nothing is lost.
            let firstLine = audit.findings.split(separator: "\n").first.map(String.init)?
                .trimmingCharacters(in: .whitespaces) ?? ""
            title = firstLine.count > 60 ? String(firstLine.prefix(57)) + "…" : firstLine
            notes = audit.findings
            instructionUID = audit.instructionUID
        }
    }

    private func save() {
        let target = action ?? {
            let created = ActionItem(title: "")
            context.insert(created)
            return created
        }()
        target.title = title.trimmingCharacters(in: .whitespaces)
        target.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        target.priority = high ? "high" : "normal"
        target.dueDate = hasDue ? Formatting.dayString(due) : nil
        let linked = instructions.first { $0.uid == instructionUID }
        target.instructionUID = linked?.uid
        target.instructionNumber = linked?.number

        // Stamp the audit so the same finding can't be converted twice.
        if let audit = fromAudit {
            target.sourceAuditID = audit.uid
            audit.convertedToActionID = target.uid
        }
        try? context.save()
        dismiss()
    }
}
