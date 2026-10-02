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
    @Query private var allInstructions: [Instruction]

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
    @State private var steps: [StepDraft] = [StepDraft(text: "")]
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

    /// The step a photo is being added to, and how.
    @State private var addingTo: UUID?
    @State private var choosingSource = false
    @State private var takingPhoto = false
    @State private var pickingForStep = false
    @State private var stepPickerItems: [PhotosPickerItem] = []
    @FocusState private var focusedStep: UUID?

    private static let autoStatus = "Auto"
    private static let ownerNamePrefix = "name:"
    private static let maxPhotos = StepsSection.maxPhotos

    struct PhotoDraft: Identifiable {
        let id = UUID()
        var existing: InstructionPhoto?
        var name: String
        var data: Data
        var thumb: Data
        var width: Int
        var height: Int
        var originalSize: Int
        /// The step it belongs to; nil for Other Photos.
        var stepID: UUID?
    }

    struct StepDraft: Identifiable {
        let id = UUID()
        var text: String
    }

    var body: some View {
        NavigationStack {
            Form {
                basics
                ownership
                scheduling
                content
                otherPhotos
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
                Task { await addPhotos(items, to: nil) }
            }
            .onChange(of: stepPickerItems) { _, items in
                Task { await addPhotos(items, to: addingTo) }
            }
            .confirmationDialog("Add a photo to step \(stepPosition(addingTo))", isPresented: $choosingSource,
                                titleVisibility: .visible) {
                Button("Take Photo") { takingPhoto = true }
                Button("Choose from Library") { pickingForStep = true }
            }
            .sheet(isPresented: $takingPhoto) {
                CameraPicker { image in
                    takingPhoto = false
                    if let data = image?.jpegData(compressionQuality: 0.95) { addPhoto(data, to: addingTo) }
                }
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: $pickingForStep, selection: $stepPickerItems,
                          maxSelectionCount: max(1, Self.maxPhotos - photos.count), matching: .images)
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
            HStack {
                Text("AMS#").foregroundStyle(.secondary)
                TextField("Number (e.g. 001)", text: $number)
                    .keyboardType(.numberPad)
            }
            // Two instructions may never share a number: say so while typing,
            // with the next free one a tap away.
            if let clash = numberClash {
                VStack(alignment: .leading, spacing: 6) {
                    Label("\(Labels.code(clash.number)) is already \u{201C}\(clash.title)\u{201D}.",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(Palette.warm)
                    Button("Use \(Labels.code(nextFreeNumber)) instead") { number = nextFreeNumber }
                        .buttonStyle(.bordered)
                }
            }
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
            stepsSection
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

    /// Each step its own box, with its own photos and Add Photo button right
    /// under it — the photo goes where you are looking.
    private var stepsSection: some View {
        Section {
            ForEach($steps) { $step in
                VStack(alignment: .leading, spacing: 8) {
                    Text("Step \(stepPosition(step.id))")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    TextField("What to do", text: $step.text, axis: .vertical)
                        .focused($focusedStep, equals: step.id)
                        .onChange(of: step.text) { _, _ in splitLines(of: step.id) }

                    let stepPhotos = photos.filter { $0.stepID == step.id }
                    if !stepPhotos.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(stepPhotos) { photo in removablePhoto(photo) }
                            }
                            .padding(.top, 6)
                        }
                    }

                    if photos.count < Self.maxPhotos {
                        Button {
                            focusedStep = nil
                            addingTo = step.id
                            choosingSource = true
                        } label: {
                            Label(stepPhotos.isEmpty ? "Add Photo" : "Add Another Photo", systemImage: "camera.fill")
                                .font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.vertical, 4)
            }
            .onDelete(perform: deleteSteps)
            .onMove { steps.move(fromOffsets: $0, toOffset: $1) }

            Button {
                let new = StepDraft(text: "")
                steps.append(new)
                focusedStep = new.id
            } label: {
                Label("Add Step", systemImage: "plus.circle.fill")
            }
        } header: {
            Text("Instructions")
        } footer: {
            Text("Press Return at the end of a step to start the next one. Swipe a step left to delete it; touch and hold to move it.")
        }
    }

    private func removablePhoto(_ photo: PhotoDraft) -> some View {
        Thumbnail(data: photo.thumb, size: 72)
            .overlay(alignment: .topTrailing) {
                Button {
                    photos.removeAll { $0.id == photo.id }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.6))
                }
                .buttonStyle(.borderless)
                .offset(x: 6, y: -6)
                .accessibilityLabel("Remove photo")
            }
    }

    /// Photos for the whole job rather than one step.
    private var otherPhotos: some View {
        let stepList = steps
        let general = $photos.filter { $0.wrappedValue.stepID == nil }
        return Section {
            ForEach(general, id: \.wrappedValue.id) { $photo in
                HStack(alignment: .top, spacing: 12) {
                    Thumbnail(data: photo.thumb, size: 60)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(photo.name).font(.subheadline).lineLimit(1)
                        Text(sizeLine(photo)).font(.caption).foregroundStyle(.secondary)
                        if !stepList.isEmpty {
                            Menu {
                                ForEach(Array(stepList.enumerated()), id: \.element.id) { index, step in
                                    Button("Step \(index + 1)" + (step.text.isEmpty ? "" : " — " + String(step.text.prefix(30)))) {
                                        photo.stepID = step.id
                                    }
                                }
                            } label: {
                                Label("Move to a Step", systemImage: "arrow.turn.down.right")
                                    .font(.caption)
                            }
                        }
                    }
                }
            }
            .onDelete { offsets in
                let ids = offsets.map { general[$0].wrappedValue.id }
                photos.removeAll { ids.contains($0.id) }
            }

            if photos.count < Self.maxPhotos {
                PhotosPicker(selection: $pickerItems,
                             maxSelectionCount: Self.maxPhotos - photos.count,
                             matching: .images) {
                    Label("Add Photo", systemImage: "photo.badge.plus")
                }
            }
        } header: {
            Text("Other Photos")
        } footer: {
            Text("Photos of the whole job, shown at the top. Photos for one step go under that step above. Up to \(Self.maxPhotos) in all; swipe a photo to remove it.")
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

    /// The steps with words in them, in order — what gets saved.
    private var filledSteps: [StepDraft] {
        steps.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private var currentSteps: [String] {
        filledSteps.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private func stepPosition(_ id: UUID?) -> Int {
        (steps.firstIndex { $0.id == id } ?? 0) + 1
    }

    /// Return in a step, or pasting several lines, makes new steps after it.
    private func splitLines(of id: UUID) {
        guard let index = steps.firstIndex(where: { $0.id == id }), steps[index].text.contains("\n") else { return }
        let parts = steps[index].text.components(separatedBy: "\n")
        steps[index].text = parts[0]
        let rest = parts.dropFirst().enumerated()
            .filter { offset, text in !text.trimmingCharacters(in: .whitespaces).isEmpty || offset == parts.count - 2 }
            .map { StepDraft(text: $0.element.trimmingCharacters(in: .whitespaces)) }
        steps.insert(contentsOf: rest, at: index + 1)
        if let last = rest.last { focusedStep = last.id }
    }

    /// A deleted step's photos stay, under Other Photos.
    private func deleteSteps(_ offsets: IndexSet) {
        let ids = Set(offsets.map { steps[$0].id })
        for index in photos.indices where photos[index].stepID.map(ids.contains) == true {
            photos[index].stepID = nil
        }
        steps.remove(atOffsets: offsets)
    }

    private var nextFreeNumber: String {
        Numbers.next(after: allInstructions.map(\.number))
    }

    /// Another instruction already using the number typed, if any.
    private var numberClash: Instruction? {
        let typed = Numbers.normalize(number)
        guard !typed.isEmpty else { return nil }
        return allInstructions.first { $0.number == typed && $0.uid != instruction?.uid }
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

        guard let instruction else {
            // A new instruction starts with the next free number.
            number = nextFreeNumber
            return
        }
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
        steps = instruction.steps.map { StepDraft(text: $0) }
        if steps.isEmpty { steps = [StepDraft(text: "")] }
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
                              originalSize: photo.originalSize,
                              stepID: photo.step.flatMap { $0 < steps.count ? steps[$0].id : nil })
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem], to stepID: UUID?) async {
        guard !items.isEmpty else { return }
        for item in items {
            if let original = try? await item.loadTransferable(type: Data.self) { addPhoto(original, to: stepID) }
        }
        pickerItems = []
        stepPickerItems = []
    }

    private func addPhoto(_ original: Data, to stepID: UUID?) {
        guard photos.count < Self.maxPhotos, let prepared = PhotoProcessing.prepare(original) else { return }
        let name = stepID == nil ? "Photo \(photos.count + 1)" : "Step \(stepPosition(stepID)) photo"
        photos.append(PhotoDraft(existing: nil, name: name,
                                 data: prepared.data, thumb: prepared.thumb,
                                 width: prepared.width, height: prepared.height,
                                 originalSize: original.count, stepID: stepID))
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

        savePhotos(for: target)
        try? context.save()
        dismiss()
    }

    private func savePhotos(for target: Instruction) {
        let keptSteps = filledSteps.map(\.id)
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
            // On a step left empty: back to Other Photos.
            photo.step = draft.stepID.flatMap { keptSteps.firstIndex(of: $0) }
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
