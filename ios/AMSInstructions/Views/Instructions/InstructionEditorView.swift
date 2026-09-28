import SwiftUI
import SwiftData
import PhotosUI

struct InstructionEditorView: View {
    /// nil for a new instruction.
    let instruction: Instruction?
    /// Called after the instruction has been deleted, so a screen showing it can close.
    var onDeleted: () -> Void = {}

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(LocalState.self) private var local
    @Query(sort: \Person.name) private var people: [Person]

    @State private var number = ""
    @State private var title = ""
    @State private var category = "General"
    @State private var location = ""
    @State private var locationDetail = ""
    @State private var summary = ""
    @State private var ownerChoice = ""
    @State private var revisedByID = ""
    @State private var status = "Auto"
    @State private var frequency = ""
    @State private var timeEstimate = ""
    @State private var difficulty = 0
    @State private var tags = ""
    @State private var warnings = ""
    @State private var equipment = ""
    @State private var preparations = ""
    @State private var steps = ""
    @State private var afterUse = ""
    @State private var maintenance = ""
    @State private var notes = ""
    @State private var links = ""
    @State private var related = ""

    @State private var photos: [PhotoDraft] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var loaded = false
    @State private var problem: String?
    @State private var confirmingDelete = false

    private static let autoStatus = "Auto"
    private static let ownerNamePrefix = "name:"
    private static let maxPhotos = 5

    struct PhotoDraft: Identifiable {
        let id = UUID()
        var existing: InstructionPhoto?
        var name: String
        var data: Data
        var thumb: Data
        var width: Int
        var height: Int
        var originalSize: Int
        var step: Int?
    }

    var body: some View {
        NavigationStack {
            Form {
                basics
                ownership
                scheduling
                content
                photoSection
                extras
                if instruction != nil {
                    Section {
                        Button("Delete Instruction", role: .destructive) { confirmingDelete = true }
                    }
                }
            }
            .navigationTitle(instruction == nil ? "New Instruction" : "Edit Instruction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .bold()
                }
            }
            .onAppear(perform: load)
            .onChange(of: pickerItems) { _, items in
                Task { await addPhotos(items) }
            }
            .alert("Can’t save yet", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(problem ?? "")
            }
            .confirmationDialog("Delete \"\(instruction?.title ?? "")\"?", isPresented: $confirmingDelete,
                                titleVisibility: .visible) {
                Button("Delete", role: .destructive) { deleteInstruction() }
            }
        }
    }

    // MARK: Sections

    private var basics: some View {
        Section("Basics") {
            TextField("Number (e.g. 001)", text: $number)
                .keyboardType(.numberPad)
            TextField("Title", text: $title)
            Picker("Category", selection: $category) {
                ForEach(Categories.groups, id: \.name) { group in
                    Section(group.name) {
                        ForEach(group.categories, id: \.self) { Text(Categories.label($0)).tag($0) }
                    }
                }
                // A category from an older backup stays selectable.
                if !Categories.order.contains(category) {
                    Text(category).tag(category)
                }
            }
            Picker("Location", selection: $location) {
                Text("-- Select --").tag("")
                ForEach(Categories.locations, id: \.self) { Text($0).tag($0) }
                if !location.isEmpty, !Categories.locations.contains(location) {
                    Text(location).tag(location)
                }
            }
            TextField("Location details", text: $locationDetail, axis: .vertical)
            TextField("Description", text: $summary, axis: .vertical)
                .lineLimit(2...6)
        }
    }

    private var ownership: some View {
        Section("People") {
            Picker("Owner", selection: $ownerChoice) {
                Text("-- Select --").tag("")
                ForEach(people) { Text($0.name).tag($0.uid) }
                if ownerChoice.hasPrefix(Self.ownerNamePrefix) {
                    Text(String(ownerChoice.dropFirst(Self.ownerNamePrefix.count)) + " (not in People)")
                        .tag(ownerChoice)
                }
            }
            Picker("Revised by", selection: $revisedByID) {
                Text("-- Select --").tag("")
                ForEach(people) { Text($0.name).tag($0.uid) }
            }
        }
    }

    private var scheduling: some View {
        Section("Status and schedule") {
            Picker("Status", selection: $status) {
                Text("Auto (based on completeness)").tag(Self.autoStatus)
                ForEach(InstructionStatus.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
            }
            Picker("Frequency", selection: $frequency) {
                Text("-- Select --").tag("")
                ForEach(Schedule.frequencies, id: \.self) { Text($0).tag($0) }
                if !frequency.isEmpty, !Schedule.frequencies.contains(frequency) {
                    Text(frequency).tag(frequency)
                }
            }
            HStack {
                Text("Time estimate")
                Spacer()
                TextField("min", text: $timeEstimate)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80)
                Text("min").foregroundStyle(.secondary)
            }
            Picker("Difficulty", selection: $difficulty) {
                Text("-- Select --").tag(0)
                Text("★ Easy").tag(1)
                Text("★★ Medium").tag(2)
                Text("★★★ Hard").tag(3)
            }
            TextField("Tags, separated by commas", text: $tags)
                .textInputAutocapitalization(.never)
        }
    }

    private var content: some View {
        Group {
            Section {
                TextField("Anything to watch out for", text: $warnings, axis: .vertical)
                    .lineLimit(2...6)
            } header: {
                Text("Safety warnings")
            }
            Section("Equipment") {
                TextField("Tools and materials", text: $equipment, axis: .vertical)
            }
            Section("Preparations") {
                TextField("Before you start", text: $preparations, axis: .vertical)
            }
            Section {
                TextField("One step per line", text: $steps, axis: .vertical)
                    .lineLimit(4...20)
            } header: {
                Text("Instructions")
            } footer: {
                Text("Each line becomes one step you can tick off.")
            }
            Section("After use") {
                TextField("Afterwards", text: $afterUse, axis: .vertical)
            }
            Section("Maintenance") {
                TextField("Upkeep", text: $maintenance, axis: .vertical)
            }
            Section("Notes") {
                TextField("Notes", text: $notes, axis: .vertical)
            }
        }
    }

    private var photoSection: some View {
        let stepTitles = currentSteps
        return Section {
            ForEach($photos) { $photo in
                HStack(alignment: .top, spacing: 12) {
                    Thumbnail(data: photo.thumb, size: 60)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(photo.name).font(.subheadline).lineLimit(1)
                        Text(sizeLine(photo)).font(.caption).foregroundStyle(.secondary)
                        // Built from the steps as they stand, so it keeps up with
                        // steps you are still writing.
                        Picker("Show", selection: $photo.step) {
                            Text("In the photo gallery").tag(Int?.none)
                            ForEach(Array(stepTitles.enumerated()), id: \.offset) { index, text in
                                Text("Step \(index + 1) — " + (text.count > 40 ? String(text.prefix(40)) + "…" : text))
                                    .tag(Int?.some(index))
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                    }
                }
            }
            .onDelete { photos.remove(atOffsets: $0) }

            if photos.count < Self.maxPhotos {
                PhotosPicker(selection: $pickerItems,
                             maxSelectionCount: Self.maxPhotos - photos.count,
                             matching: .images) {
                    Label("Add Photo", systemImage: "photo.badge.plus")
                }
            }
        } header: {
            Text("Photos")
        } footer: {
            Text("Up to \(Self.maxPhotos). Swipe a photo to remove it. Photos are shrunk to a sensible size as they are added.")
        }
    }

    private var extras: some View {
        Group {
            Section {
                TextField("Title|https://…", text: $links, axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
            } header: {
                Text("Links")
            } footer: {
                Text("One per line, as title|address.")
            }
            Section {
                TextField("e.g. 101, 106", text: $related)
                    .keyboardType(.numbersAndPunctuation)
            } header: {
                Text("Related instructions")
            } footer: {
                Text("Numbers, separated by commas.")
            }
        }
    }

    // MARK: Loading

    private var currentSteps: [String] {
        steps.split(separator: "\n", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func sizeLine(_ photo: PhotoDraft) -> String {
        let stored = photo.data.count + photo.thumb.count
        var text = Formatting.bytes(stored)
        if photo.width > 0 { text = "\(photo.width) × \(photo.height) · " + text }
        if photo.originalSize > stored { text += " (was \(Formatting.bytes(photo.originalSize)))" }
        return text
    }

    private func load() {
        guard !loaded else { return }
        loaded = true

        if let id = local.lastRevisedByID, people.contains(where: { $0.uid == id }) {
            revisedByID = id
        }

        guard let instruction else { return }
        number = instruction.number
        title = instruction.title
        category = instruction.category
        location = instruction.location
        locationDetail = instruction.locationDetail
        summary = instruction.summary
        status = instruction.status.isEmpty ? Self.autoStatus : instruction.status
        frequency = instruction.frequency
        timeEstimate = instruction.timeEstimate > 0 ? String(instruction.timeEstimate) : ""
        difficulty = instruction.difficulty
        tags = instruction.tags.joined(separator: ", ")
        warnings = instruction.warnings
        equipment = instruction.equipment
        preparations = instruction.preparations
        steps = instruction.steps.joined(separator: "\n")
        afterUse = instruction.afterUse
        maintenance = instruction.maintenance
        notes = instruction.notes
        links = instruction.links.map { "\($0.title)|\($0.url)" }.joined(separator: "\n")
        related = instruction.related.joined(separator: ", ")

        // The owner can be a person id or a bare name. Both must survive a trip
        // through this editor: opening and saving unchanged must never erase it.
        let name = instruction.owner.trimmingCharacters(in: .whitespaces)
        if let id = instruction.ownerID, people.contains(where: { $0.uid == id }) {
            ownerChoice = id
        } else if let match = people.first(where: { $0.name.lowercased() == name.lowercased() }) {
            ownerChoice = match.uid
        } else if !name.isEmpty {
            ownerChoice = Self.ownerNamePrefix + name
        }

        photos = Library.photos(for: instruction.uid, in: context).compactMap { photo in
            guard let data = photo.imageData else { return nil }
            return PhotoDraft(existing: photo, name: photo.name, data: data,
                              thumb: photo.thumbData ?? data, width: photo.width, height: photo.height,
                              originalSize: photo.originalSize, step: photo.step)
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        for item in items {
            guard photos.count < Self.maxPhotos,
                  let original = try? await item.loadTransferable(type: Data.self),
                  let prepared = PhotoProcessing.prepare(original) else { continue }
            photos.append(PhotoDraft(existing: nil, name: "Photo \(photos.count + 1)",
                                     data: prepared.data, thumb: prepared.thumb,
                                     width: prepared.width, height: prepared.height,
                                     originalSize: original.count, step: nil))
        }
        pickerItems = []
    }

    // MARK: Saving

    private func save() {
        let number = Numbers.normalize(self.number)
        let title = self.title.trimmingCharacters(in: .whitespaces)
        let stepList = currentSteps

        guard !number.isEmpty, !title.isEmpty, !stepList.isEmpty else {
            problem = "Please fill in: Number, Title, and Instructions."
            return
        }

        // Two instructions may not share a number. Say which one has it and
        // leave the editing alone.
        if let clash = Library.instruction(number: number, in: context), clash.uid != instruction?.uid {
            problem = "Number \(number) is already used by \"\(clash.title)\".\n\nGive this one a different number."
            return
        }

        var ownerID: String?
        var ownerName = ""
        if ownerChoice.hasPrefix(Self.ownerNamePrefix) {
            ownerName = String(ownerChoice.dropFirst(Self.ownerNamePrefix.count))
        } else if let person = people.first(where: { $0.uid == ownerChoice }) {
            ownerID = person.uid
            ownerName = person.name
        }

        let reviser = people.first { $0.uid == revisedByID }
        if let reviser { local.lastRevisedByID = reviser.uid }

        let isNew = instruction == nil
        let target = instruction ?? Instruction()
        if isNew { context.insert(target) }

        target.number = number
        target.title = title
        target.category = category
        target.location = location
        target.locationDetail = locationDetail
        target.summary = summary
        target.owner = ownerName
        target.ownerID = ownerID
        target.frequency = frequency
        target.timeEstimate = Int(timeEstimate.trimmingCharacters(in: .whitespaces)) ?? 0
        target.difficulty = difficulty
        target.tags = tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        target.warnings = warnings
        target.equipment = equipment
        target.preparations = preparations
        target.steps = stepList
        target.afterUse = afterUse
        target.maintenance = maintenance
        target.notes = notes
        target.links = links.split(separator: "\n").compactMap { line in
            let parts = line.split(separator: "|", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard let first = parts.first, !first.isEmpty else { return nil }
            return parts.count == 2 ? InstructionLink(title: first, url: parts[1]) : InstructionLink(title: first, url: first)
        }
        target.related = related.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }

        if status == Self.autoStatus {
            target.status = StatusRules.calculated(title: title, summary: summary, steps: stepList,
                                                   frequency: frequency, timeEstimate: target.timeEstimate,
                                                   owner: ownerName, warnings: warnings).rawValue
        } else {
            target.status = status
        }

        let authorName = reviser?.name ?? (ownerName.isEmpty ? "System" : ownerName)
        var revisions = target.revisions
        if isNew {
            target.createdAt = Date()
            revisions = [Revision(version: 1, timestamp: Date(), authorID: reviser?.uid,
                                  authorName: authorName, changes: "Created")]
        } else {
            revisions.append(Revision(version: (revisions.last?.version ?? 0) + 1, timestamp: Date(),
                                      authorID: reviser?.uid, authorName: authorName,
                                      changes: "Updated instruction"))
        }
        target.revisions = revisions

        savePhotos(for: target, stepCount: stepList.count)
        try? context.save()
        dismiss()
    }

    private func savePhotos(for target: Instruction, stepCount: Int) {
        let kept = Set(photos.compactMap { $0.existing?.uid })
        for old in Library.photos(for: target.uid, in: context) where !kept.contains(old.uid) {
            context.delete(old)
        }
        for (index, draft) in photos.enumerated() {
            let photo = draft.existing ?? {
                let created = InstructionPhoto(instructionUID: target.uid)
                context.insert(created)
                return created
            }()
            photo.name = draft.name
            photo.imageData = draft.data
            photo.thumbData = draft.thumb
            photo.width = draft.width
            photo.height = draft.height
            photo.originalSize = draft.originalSize
            // Pinned to a step that no longer exists: back to the gallery.
            photo.step = draft.step.flatMap { $0 < stepCount ? $0 : nil }
            photo.sortIndex = index
        }
    }

    private func deleteInstruction() {
        guard let instruction else { return }
        Library.deletePhotos(of: instruction.uid, in: context)
        Library.deleteRecognition(of: instruction.uid, in: context)
        context.delete(instruction)
        try? context.save()
        dismiss()
        onDeleted()
    }
}
