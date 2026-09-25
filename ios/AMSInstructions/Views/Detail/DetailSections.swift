import SwiftUI
import SwiftData

/// The steps, with your place in them kept. Tick three of twelve, lock the
/// phone, come back — the three are still ticked. Losing your place halfway
/// through a job you are doing with wet hands is the whole reason this exists.
struct StepsSection: View {
    let instruction: Instruction
    let photos: [InstructionPhoto]
    let onPhoto: (InstructionPhoto) -> Void

    @Environment(LocalState.self) private var local

    var body: some View {
        let ticked = local.tickedSteps(for: instruction)
        SectionCard(title: "Instructions", systemImage: "list.number") {
            // Only shown once you are part-way through: "0 of 12 done" on an
            // instruction you just opened is noise.
            if !ticked.isEmpty {
                HStack {
                    Text("\(ticked.count) of \(instruction.steps.count) done")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.tint)
                    Spacer()
                    Button("Start again") { local.setTicked([], for: instruction) }
                        .font(.subheadline)
                }
            }

            if instruction.steps.isEmpty {
                Text("--").foregroundStyle(.secondary)
            }

            ForEach(Array(instruction.steps.enumerated()), id: \.offset) { index, step in
                let done = ticked.contains(index)
                VStack(alignment: .leading, spacing: 6) {
                    Button {
                        var next = ticked
                        if done { next.remove(index) } else { next.insert(index) }
                        local.setTicked(next, for: instruction)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                                .font(.title3)
                                .foregroundStyle(done ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                            Text(verbatim: "\(index + 1). \(step)")
                                .strikethrough(done)
                                .foregroundStyle(done ? .secondary : .primary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .multilineTextAlignment(.leading)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    // A photo pinned to this step sits directly under it — the
                    // picture of the valve beside the instruction to turn it.
                    let stepPhotos = photos.filter { $0.step == index }
                    if !stepPhotos.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(stepPhotos) { photo in
                                    Button {
                                        onPhoto(photo)
                                    } label: {
                                        Thumbnail(data: photo.thumbData ?? photo.imageData, size: 88)
                                    }
                                }
                            }
                            .padding(.leading, 34)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
}

/// Every recorded completion, newest first — who, and when.
struct DoneLogSection: View {
    let instruction: Instruction
    let colors: OwnerColors

    var body: some View {
        let log = instruction.completionLog
        SectionCard(title: "Done History", systemImage: "checkmark.seal") {
            if log.isEmpty && instruction.completionCount == 0 {
                Text("Not marked Done yet.").foregroundStyle(.secondary)
            }
            ForEach(Array(log.enumerated()), id: \.offset) { _, entry in
                HStack {
                    if entry.byName.isEmpty {
                        Text("No name recorded").italic().foregroundStyle(.secondary)
                    } else {
                        OwnerPill(name: entry.byName, colors: colors)
                    }
                    Spacer()
                    Text(Formatting.dateAndTime(entry.at))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            // Everything done before the app started keeping names.
            let earlier = instruction.completionCount - log.count
            if earlier > 0 {
                Text(earlier == 1
                     ? "Marked Done once more before the app started recording who."
                     : "Marked Done \(earlier) more times before the app started recording who.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct RevisionSection: View {
    let instruction: Instruction
    let people: [Person]
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(instruction.revisions.reversed().enumerated()), id: \.offset) { _, revision in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text("v\(revision.version)").bold()
                            Spacer()
                            Text(Formatting.dateAndTime(revision.timestamp))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Text("By: \(revision.authorName)").font(.subheadline)
                        if let contact = contactLine(revision.authorID) {
                            Text(contact).font(.caption).foregroundStyle(.secondary)
                        }
                        Text(revision.changes).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            Label("Revision History", systemImage: "clock.arrow.circlepath").font(.headline)
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func contactLine(_ id: String?) -> String? {
        guard let id, let person = people.first(where: { $0.uid == id }) else { return nil }
        let parts = [person.phone.isEmpty ? nil : "📞 " + person.phone,
                     person.email.isEmpty ? nil : "✉️ " + person.email].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
    }
}

/// Audits of this instruction: who checked it, when, and what they found. A
/// finding can be turned into a to-do, once.
struct AuditSection: View {
    let instruction: Instruction

    @Environment(\.modelContext) private var context
    @Environment(LocalState.self) private var local
    @Query(sort: \Person.name) private var people: [Person]
    @Query(sort: \Audit.timestamp, order: .reverse) private var allAudits: [Audit]

    @State private var open = false
    @State private var auditorID = ""
    @State private var date = Date()
    @State private var findings = ""
    @State private var addingPerson = false
    @State private var converting: Audit?
    @State private var deleting: Audit?
    @State private var problem: String?

    var body: some View {
        let audits = allAudits.filter { $0.instructionUID == instruction.uid }
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 12) {
                if audits.isEmpty {
                    Text("No audits recorded yet.").foregroundStyle(.secondary)
                }
                ForEach(audits) { audit in
                    auditRow(audit)
                    Divider()
                }
                addForm
            }
            .padding(.top, 8)
        } label: {
            HStack {
                Label("Audit Log", systemImage: "magnifyingglass").font(.headline)
                Spacer()
                if !audits.isEmpty {
                    Text("\(audits.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .onAppear {
            if auditorID.isEmpty, let last = local.lastRevisedByID, people.contains(where: { $0.uid == last }) {
                auditorID = last
            }
        }
        .sheet(isPresented: $addingPerson) {
            PersonEditorView(person: nil) { saved in
                auditorID = saved.uid
            }
        }
        .sheet(item: $converting) { audit in
            ActionEditorView(action: nil, fromAudit: audit)
        }
        .alert("Please check", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(problem ?? "")
        }
        .confirmationDialog("Delete this audit entry?", isPresented: Binding(get: { deleting != nil },
                                                                            set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { audit in
            Button("Delete", role: .destructive) {
                context.delete(audit)
                try? context.save()
            }
        }
    }

    private func auditRow(_ audit: Audit) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Audited by: \(audit.auditorName.isEmpty ? "Unknown" : audit.auditorName)")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(audit.timestamp.formatted(date: .abbreviated, time: .omitted))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text(audit.findings.isEmpty ? "--" : audit.findings).font(.subheadline)
            HStack {
                if audit.convertedToActionID != nil {
                    Label("Already actioned", systemImage: "checkmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.success)
                } else {
                    Button("→ Convert to Action") { converting = audit }
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.bordered)
                }
                Spacer()
                Button("Delete", role: .destructive) { deleting = audit }
                    .font(.caption)
                    .buttonStyle(.borderless)
            }
        }
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Add an audit").font(.subheadline.weight(.semibold))
            HStack {
                Picker("Audited by", selection: $auditorID) {
                    Text("-- Select --").tag("")
                    ForEach(people) { Text($0.name).tag($0.uid) }
                }
                Button {
                    addingPerson = true
                } label: {
                    Label("Person", systemImage: "plus")
                }
                .buttonStyle(.bordered)
            }
            DatePicker("Date", selection: $date, displayedComponents: .date)
            TextField("What did the audit find?", text: $findings, axis: .vertical)
                .lineLimit(3...8)
                .textFieldStyle(.roundedBorder)
            Button("Add Audit Entry") { addAudit() }
                .buttonStyle(.borderedProminent)
        }
    }

    private func addAudit() {
        guard let person = people.first(where: { $0.uid == auditorID }) else {
            problem = "Please select who did the audit."
            return
        }
        let text = findings.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            problem = "Please enter what the audit found."
            return
        }
        let audit = Audit(instructionUID: instruction.uid)
        audit.instructionNumber = instruction.number
        audit.auditorID = person.uid
        audit.auditorName = person.name
        audit.timestamp = Calendar.current.startOfDay(for: date)
        audit.findings = text
        context.insert(audit)
        try? context.save()
        local.lastRevisedByID = person.uid
        findings = ""
        date = Date()
    }
}
