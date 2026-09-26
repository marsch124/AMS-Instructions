import SwiftUI
import SwiftData

struct InstructionDetailView: View {
    @Bindable var instruction: Instruction

    @Environment(\.modelContext) private var context
    @Environment(LocalState.self) private var local
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Person.name) private var people: [Person]

    @State private var editing: EditorTarget?
    @State private var printingLabel = false
    @State private var chooser: ChooserPurpose?
    @State private var justDone = false
    @State private var fullScreenPhoto: InstructionPhoto?

    enum ChooserPurpose: Identifiable {
        case markDone, amend
        var id: Self { self }
    }

    var body: some View {
        // Deleted from the editor while this screen was underneath it.
        if instruction.isDeleted || instruction.modelContext == nil {
            ContentUnavailableView("Instruction deleted", systemImage: "trash")
        } else {
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        let photos = Library.photos(for: instruction.uid, in: context)
        let colors = OwnerColors(people: people)

        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                quickInfo(colors: colors)

                if !instruction.summary.isEmpty {
                    Text(instruction.summary).font(.body)
                }

                if !instruction.location.isEmpty {
                    SectionCard(title: instruction.location, systemImage: "mappin.and.ellipse") {
                        if !instruction.locationDetail.isEmpty {
                            Text(instruction.locationDetail).foregroundStyle(.secondary)
                        }
                    }
                }

                // Above the steps and never folded away: a warning behind a tap
                // is not a warning.
                if !instruction.warnings.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    SectionCard(title: "Safety Warnings", systemImage: "exclamationmark.triangle.fill") {
                        Text(instruction.warnings)
                    }
                    .foregroundStyle(Palette.danger)
                }

                StepsSection(instruction: instruction, photos: photos) { photo in
                    fullScreenPhoto = photo
                }

                markDoneButton

                // In words, right under Mark Done: a bare symbol in the top
                // bar was not findable.
                Button {
                    printingLabel = true
                } label: {
                    Label("Print Label", systemImage: "tag")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.bordered)

                RecognitionSection(instruction: instruction)

                FoldingText(title: "Equipment", systemImage: "wrench.and.screwdriver", text: instruction.equipment)
                FoldingText(title: "Preparations", systemImage: "list.clipboard", text: instruction.preparations)
                FoldingText(title: "After Use", systemImage: "arrow.uturn.backward", text: instruction.afterUse)
                FoldingText(title: "Maintenance", systemImage: "gearshape.2", text: instruction.maintenance)
                FoldingText(title: "Notes", systemImage: "note.text", text: instruction.notes)

                gallery(photos)
                links
                related

                DoneLogSection(instruction: instruction, colors: colors)
                AuditSection(instruction: instruction)
                RevisionSection(instruction: instruction, people: people)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        // The same code as on the printed label.
        .navigationTitle(Labels.code(instruction.number))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    instruction.isFavorite.toggle()
                } label: {
                    Image(systemName: instruction.isFavorite ? "star.fill" : "star")
                }
                .accessibilityLabel(instruction.isFavorite ? "Remove from favorites" : "Add to favorites")

                ShareLink(item: InstructionText.make(instruction),
                          subject: Text("\(Labels.code(instruction.number)) — \(instruction.title)"))

                Button {
                    editing = EditorTarget(instruction: instruction)
                } label: {
                    Image(systemName: "pencil")
                }
                .accessibilityLabel("Edit")
            }
        }
        .onAppear {
            instruction.lastViewedAt = Date()
        }
        .sheet(item: $editing) { target in
            InstructionEditorView(instruction: target.instruction) {
                dismiss()
            }
        }
        .sheet(isPresented: $printingLabel) {
            LabelSheet(instructions: [instruction])
        }
        .sheet(item: $chooser) { purpose in
            switch purpose {
            case .markDone:
                PersonChooser(title: "Who did it?",
                              message: "Recorded against this job, and remembered for next time.") { person in
                    local.lastDoneByID = person?.uid
                    completeDone(by: person)
                }
            case .amend:
                PersonChooser(title: "Who did it?",
                              message: "This replaces the name on what you just marked done.") { person in
                    local.lastDoneByID = person?.uid
                    Library.amendLastCompletion(instruction, to: person)
                    toasts.show(person.map { "✓ Recorded as \($0.name)" } ?? "✓ Name removed")
                }
            }
        }
        .fullScreenCover(item: $fullScreenPhoto) { photo in
            PhotoViewer(photo: photo)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(instruction.title)
                .font(.title2.weight(.bold))
            HStack(spacing: 8) {
                CategoryBadge(category: instruction.category)
                StatusBadge(status: instruction.status)
                if instruction.difficulty > 0 {
                    Text(String(repeating: "★", count: min(3, instruction.difficulty)))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func quickInfo(colors: OwnerColors) -> some View {
        let name = ownerName(of: instruction, people: people)
        let lastWho = instruction.completionLog.first?.byName ?? ""
        let lastDone = instruction.lastCompleted.map {
            Formatting.relative($0) + (lastWho.isEmpty ? "" : " · " + lastWho)
        } ?? "Never"
        let due = Schedule.isDue(instruction)

        return Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
            GridRow {
                InfoCell(label: "Owner", value: name.isEmpty ? "--" : name)
                InfoCell(label: "Frequency", value: instruction.frequency.isEmpty ? "--" : instruction.frequency)
            }
            GridRow {
                InfoCell(label: "Time", value: instruction.timeEstimate > 0 ? "\(instruction.timeEstimate) min" : "--")
                InfoCell(label: "Done", value: Formatting.plural(instruction.completionCount, "time"))
            }
            GridRow {
                InfoCell(label: "Last done", value: lastDone)
                InfoCell(label: "Next due", value: Schedule.describeNextDue(instruction), highlight: due)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: Mark Done

    private var markDoneButton: some View {
        Button {
            markDone()
        } label: {
            Label(justDone ? "Done!" : "Mark Done", systemImage: "checkmark.circle.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .tint(Palette.success)
    }

    /// Asked once and then remembered: a chooser in front of every Mark Done
    /// would be a tax on the one action the app most wants to be effortless.
    private func markDone() {
        if let id = local.lastDoneByID, let person = people.first(where: { $0.uid == id }) {
            completeDone(by: person)
        } else {
            chooser = .markDone
        }
    }

    private func completeDone(by person: Person?) {
        Library.recordCompletion(instruction, by: person)
        // The job is finished, so the ticks have done their work.
        local.setTicked([], for: instruction)
        justDone = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { justDone = false }

        // Correcting the name has to be easier than being asked every time,
        // or the remembering is a trap rather than a convenience.
        toasts.show(person.map { "✓ Done · \($0.name)" } ?? "✓ Done — no name recorded",
                    actionLabel: "Not you?") {
            chooser = .amend
        }
    }

    // MARK: Photos, links, related

    @ViewBuilder
    private func gallery(_ photos: [InstructionPhoto]) -> some View {
        // Photos pinned to a step are shown beside that step already.
        let loose = photos.filter { pinnedStep($0) == nil }
        if !loose.isEmpty {
            SectionCard(title: "Photos", systemImage: "photo.on.rectangle") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(loose) { photo in
                            Button {
                                fullScreenPhoto = photo
                            } label: {
                                Thumbnail(data: photo.thumbData ?? photo.imageData, size: 96)
                            }
                        }
                    }
                }
            }
        }
    }

    private func pinnedStep(_ photo: InstructionPhoto) -> Int? {
        guard let step = photo.step, step >= 0, step < instruction.steps.count else { return nil }
        return step
    }

    @ViewBuilder
    private var links: some View {
        let links = instruction.links
        if !links.isEmpty {
            SectionCard(title: "Links", systemImage: "link") {
                ForEach(links, id: \.self) { link in
                    if let url = URL(string: link.url) {
                        Link(link.title.isEmpty ? link.url : link.title, destination: url)
                    } else {
                        Text(link.title)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var related: some View {
        if !instruction.related.isEmpty {
            SectionCard(title: "Related", systemImage: "arrow.triangle.branch") {
                ForEach(instruction.related, id: \.self) { number in
                    // Looked up rather than stored, so renaming an instruction
                    // updates every instruction that points at it.
                    if let target = Library.instruction(number: number, in: context) {
                        NavigationLink(value: target) {
                            HStack {
                                Text(target.number).monospacedDigit().bold().foregroundStyle(.tint)
                                Text(target.title).foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                            }
                        }
                    } else {
                        HStack {
                            Text(Numbers.normalize(number)).monospacedDigit().bold()
                            Text("No longer exists").italic()
                        }
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

struct InfoCell: View {
    let label: String
    let value: String
    var highlight = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(highlight ? Palette.danger : .primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(status.isEmpty ? "Active" : status)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch InstructionStatus(rawValue: status) {
        case .draft: return .orange
        case .reviewNeeded: return .yellow
        case .archived: return .gray
        default: return Palette.success
        }
    }
}

/// A text section that folds away, with a dot showing whether it has anything.
struct FoldingText: View {
    let title: String
    let systemImage: String
    let text: String
    @State private var open = false

    var body: some View {
        let filled = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        DisclosureGroup(isExpanded: $open) {
            Text(filled ? text : "--")
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)
        } label: {
            HStack {
                Label(title, systemImage: systemImage).font(.headline)
                Spacer()
                Circle()
                    .fill(filled ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
                    .frame(width: 8, height: 8)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }
}

struct PhotoViewer: View {
    let photo: InstructionPhoto
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let data = photo.imageData ?? photo.thumbData, let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.largeTitle)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.5))
            }
            .padding()
        }
    }
}
