import SwiftUI
import SwiftData
import PhotosUI
import UIKit

/// Creating an instruction the other way round: photos first, then a guided
/// walk through every field, one topic per page. With an API key, Claude
/// drafts the fields from the photos and you correct them.
struct NewFromPhotosView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(LocalState.self) private var local
    @Query(sort: \Person.name) private var people: [Person]
    @Query private var instructions: [Instruction]

    private enum Stage { case photos, drafting, guide, saved }

    private enum Page: Int, CaseIterable {
        case what, place, category, safety, needs, steps, after, schedule, people, review

        var title: String {
            switch self {
            case .what: return "What is it?"
            case .place: return "Where is it?"
            case .category: return "Which category?"
            case .safety: return "Anything dangerous?"
            case .needs: return "What do you need?"
            case .steps: return "The steps"
            case .after: return "Afterwards"
            case .schedule: return "How often, how long?"
            case .people: return "Who, and anything else?"
            case .review: return "Check and save"
            }
        }

        var explanation: String {
            switch self {
            case .what:
                return "A short title you would recognise on a label, and a sentence on what this instruction is for."
            case .place:
                return "So that you, or someone else, can find the item."
            case .category:
                return "Groups it in the list and gives it its colour."
            case .safety:
                return "Gas, electricity, pressure, heat, water damage… Leave it empty if there is nothing to watch out for."
            case .needs:
                return "Tools and materials to have at hand, and anything to do before starting."
            case .steps:
                return "One action per step, in order. Each step becomes a tick box when you follow the instruction."
            case .after:
                return "What to do when finished, and any regular upkeep."
            case .schedule:
                return "The frequency puts it on Home when it is due. Time and difficulty help you plan."
            case .people:
                return "Who looks after it, words to find it by, and anything else worth noting."
            case .review:
                return "The number is the next free one — it goes on the label as AMS#. Save, and you can still edit everything later."
            }
        }
    }

    struct Shot: Identifiable {
        let id = UUID()
        var data: Data
        var thumb: Data
        var width: Int
        var height: Int
        var originalSize: Int
        var stepID: UUID?
    }

    struct StepLine: Identifiable {
        let id = UUID()
        var text: String
    }

    private static let maxPhotos = 5

    @State private var stage = Stage.photos
    @State private var shots: [Shot] = []
    @State private var hint = ""
    @State private var takingPhoto = false
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var draftTask: Task<Void, Never>?
    @State private var aiProblem: String?
    @State private var drafted = false

    @State private var page = Page.what
    @State private var draft = InstructionDraft()
    @State private var stepLines: [StepLine] = []
    @State private var minutes = ""
    @State private var tagsText = ""
    @State private var ownerID = ""
    @State private var number = ""
    @State private var saveProblem: String?

    @State private var saved: Instruction?
    @State private var printingLabel = false

    var body: some View {
        NavigationStack {
            Group {
                switch stage {
                case .photos: photoStage
                case .drafting: draftingStage
                case .guide: guideStage
                case .saved: savedStage
                }
            }
            .navigationTitle("New from Photos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if stage != .saved {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            draftTask?.cancel()
                            dismiss()
                        }
                    }
                }
            }
        }
        .interactiveDismissDisabled(!shots.isEmpty && stage != .saved)
        .sheet(isPresented: $takingPhoto) {
            CameraPicker { image in
                takingPhoto = false
                if let data = image?.jpegData(compressionQuality: 0.95) { add(data) }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $printingLabel) {
            if let saved { LabelSheet(instructions: [saved]) }
        }
        .onChange(of: pickerItems) { _, items in
            Task { await addPicked(items) }
        }
    }

    // MARK: 1. Photos

    private var photoStage: some View {
        Form {
            Section {
                Text("Take 2–5 photos of the item: the whole thing, and close-ups of switches, labels or type plates. They become the instruction's photos, and teach Scan → Item to recognise it.")
                    .font(.callout)
            }

            Section {
                if !shots.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(shots) { shot in
                                VStack(spacing: 4) {
                                    Thumbnail(data: shot.thumb, size: 84)
                                    Button("Remove", role: .destructive) {
                                        shots.removeAll { $0.id == shot.id }
                                    }
                                    .font(.caption)
                                    .buttonStyle(.borderless)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                if shots.count < Self.maxPhotos {
                    Button {
                        takingPhoto = true
                    } label: {
                        Label(shots.isEmpty ? "Take Photo" : "Take Another Photo", systemImage: "camera")
                    }
                    PhotosPicker(selection: $pickerItems,
                                 maxSelectionCount: Self.maxPhotos - shots.count,
                                 matching: .images) {
                        Label("Choose from Photo Library", systemImage: "photo.on.rectangle")
                    }
                }
            } header: {
                Text("Photos (\(shots.count) of \(Self.maxPhotos))")
            }

            Section {
                TextField("e.g. \"switching the heater to gas\"", text: $hint, axis: .vertical)
                    .lineLimit(1...4)
            } header: {
                Text("What should the instruction cover? (optional)")
            } footer: {
                Text("A few words help Claude write the right steps.")
            }

            if let aiProblem {
                Section {
                    Text(aiProblem).foregroundStyle(Palette.danger)
                }
            }

            Section {
                if APIKeyStore.hasKey {
                    Button {
                        startDraft()
                    } label: {
                        Label("Draft with Claude", systemImage: "sparkles")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(shots.isEmpty)
                    .listRowBackground(Color.clear)

                    Button("Fill It In Myself") { startGuide(with: InstructionDraft()) }
                        .frame(maxWidth: .infinity)
                        .disabled(shots.isEmpty)
                        .listRowBackground(Color.clear)
                } else {
                    Button {
                        startGuide(with: InstructionDraft())
                    } label: {
                        Text("Continue").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(shots.isEmpty)
                    .listRowBackground(Color.clear)
                }
            } footer: {
                if APIKeyStore.hasKey {
                    Text("Claude looks at the photos and fills in every page for you to check. It sends the photos to Anthropic and costs a few cents.")
                } else {
                    Text("To have Claude draft it from the photos, add an API key under Settings → AI Drafts.")
                }
            }
        }
    }

    // MARK: 2. Drafting

    private var draftingStage: some View {
        VStack(spacing: 20) {
            Spacer()
            ProgressView()
                .controlSize(.large)
            Text("Claude is looking at your photos…")
                .font(.headline)
            Text("This usually takes 20–60 seconds.")
                .foregroundStyle(.secondary)
            Button("Stop and Fill In Myself") {
                draftTask?.cancel()
                startGuide(with: InstructionDraft())
            }
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(24)
    }

    // MARK: 3. The guide

    private var guideStage: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                ProgressView(value: Double(page.rawValue + 1), total: Double(Page.allCases.count))
                Text("Page \(page.rawValue + 1) of \(Page.allCases.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(page.title).font(.title2.bold())
                        Text(page.explanation).font(.callout).foregroundStyle(.secondary)
                        if drafted && page != .review {
                            Label("Drafted by Claude from your photos — check and correct it.", systemImage: "sparkles")
                                .font(.caption)
                                .foregroundStyle(Palette.instructions)
                        }
                    }
                    .padding(.vertical, 4)
                }
                pageContent
            }

            HStack {
                if page != .what {
                    Button {
                        move(-1)
                    } label: {
                        Label("Back", systemImage: "chevron.left")
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
                if page == .review {
                    Button {
                        save()
                    } label: {
                        Label("Save Instruction", systemImage: "checkmark")
                            .font(.headline)
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Button {
                        move(1)
                    } label: {
                        Label("Next", systemImage: "chevron.right")
                            .labelStyle(TrailingIconLabelStyle())
                            .font(.headline)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding()
            .background(.bar)
        }
        .alert("Can’t save yet", isPresented: Binding(get: { saveProblem != nil }, set: { if !$0 { saveProblem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(saveProblem ?? "")
        }
    }

    @ViewBuilder
    private var pageContent: some View {
        switch page {
        case .what:
            Section("Title") {
                TextField("e.g. Heater – switch on", text: $draft.title, axis: .vertical)
            }
            Section("Description") {
                TextField("What it is and what this achieves", text: $draft.summary, axis: .vertical)
                    .lineLimit(2...6)
            }

        case .place:
            Section {
                Picker("Location", selection: $draft.location) {
                    Text("-- Select --").tag("")
                    ForEach(Categories.locations, id: \.self) { Text($0).tag($0) }
                }
                TextField("Exactly where, e.g. under the bed, left", text: $draft.locationDetail, axis: .vertical)
            }

        case .category:
            ForEach(Categories.groups, id: \.name) { group in
                Section(group.name) {
                    ForEach(group.categories, id: \.self) { category in
                        Button {
                            draft.category = category
                        } label: {
                            HStack {
                                Circle().fill(Categories.color(category)).frame(width: 12, height: 12)
                                Text(Categories.label(category)).foregroundStyle(.primary)
                                Spacer()
                                if draft.category == category {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                    }
                }
            }

        case .safety:
            Section("Safety warnings") {
                TextField("Anything to watch out for", text: $draft.warnings, axis: .vertical)
                    .lineLimit(3...8)
            }

        case .needs:
            Section("Equipment") {
                TextField("Tools and materials", text: $draft.equipment, axis: .vertical)
                    .lineLimit(2...6)
            }
            Section("Preparations") {
                TextField("Before you start", text: $draft.preparations, axis: .vertical)
                    .lineLimit(2...6)
            }

        case .steps:
            Section {
                ForEach($stepLines) { $line in
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(stepPosition(line.id)).").foregroundStyle(.secondary).monospacedDigit()
                        TextField("What to do", text: $line.text, axis: .vertical)
                    }
                }
                .onDelete { stepLines.remove(atOffsets: $0) }
                .onMove { stepLines.move(fromOffsets: $0, toOffset: $1) }

                Button {
                    stepLines.append(StepLine(text: ""))
                } label: {
                    Label("Add Step", systemImage: "plus")
                }
            } header: {
                Text("Steps")
            } footer: {
                Text("Swipe a step left to delete it.")
            }

            if !shots.isEmpty {
                Section("Which step does each photo show?") {
                    ForEach($shots) { $shot in
                        HStack(spacing: 12) {
                            Thumbnail(data: shot.thumb, size: 56)
                            Picker("Show", selection: $shot.stepID) {
                                Text("In the photo gallery").tag(UUID?.none)
                                ForEach(Array(stepLines.enumerated()), id: \.element.id) { index, line in
                                    Text("Step \(index + 1)" + (line.text.isEmpty ? "" : " — " + String(line.text.prefix(30))))
                                        .tag(UUID?.some(line.id))
                                }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                        }
                    }
                }
            }

        case .after:
            Section("After use") {
                TextField("When finished", text: $draft.afterUse, axis: .vertical)
                    .lineLimit(2...6)
            }
            Section("Maintenance") {
                TextField("Regular upkeep", text: $draft.maintenance, axis: .vertical)
                    .lineLimit(2...6)
            }

        case .schedule:
            Section {
                Picker("Frequency", selection: $draft.frequency) {
                    Text("-- Select --").tag("")
                    ForEach(Schedule.frequencies, id: \.self) { Text($0).tag($0) }
                }
                HStack {
                    Text("Time estimate")
                    Spacer()
                    TextField("min", text: $minutes)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80)
                    Text("min").foregroundStyle(.secondary)
                }
                Picker("Difficulty", selection: $draft.difficulty) {
                    Text("-- Select --").tag(0)
                    Text("★ Easy").tag(1)
                    Text("★★ Medium").tag(2)
                    Text("★★★ Hard").tag(3)
                }
            }

        case .people:
            Section {
                Picker("Owner", selection: $ownerID) {
                    Text("-- Select --").tag("")
                    ForEach(people) { Text($0.name).tag($0.uid) }
                }
            } footer: {
                if people.isEmpty {
                    Text("Add people under Settings → Manage People.")
                }
            }
            Section("Tags") {
                TextField("Separated by commas", text: $tagsText)
                    .textInputAutocapitalization(.never)
            }
            Section("Notes") {
                TextField("Model numbers, settings, anything else", text: $draft.notes, axis: .vertical)
                    .lineLimit(2...6)
            }

        case .review:
            Section {
                HStack {
                    Text("Number")
                    Spacer()
                    Text("AMS#").foregroundStyle(.secondary)
                    TextField("001", text: $number)
                        .keyboardType(.numberPad)
                        .frame(width: 60)
                }
            }
            Section("Summary") {
                reviewRow("Title", draft.title, page: .what)
                reviewRow("Location", [draft.location, draft.locationDetail].filter { !$0.isEmpty }.joined(separator: " · "), page: .place)
                reviewRow("Category", Categories.label(draft.category), page: .category)
                reviewRow("Warnings", draft.warnings, page: .safety)
                reviewRow("Steps", filledSteps.isEmpty ? "" : Formatting.plural(filledSteps.count, "step"), page: .steps)
                reviewRow("Frequency", draft.frequency, page: .schedule)
                reviewRow("Owner", people.first { $0.uid == ownerID }?.name ?? "", page: .people)
                reviewRow("Photos", Formatting.plural(shots.count, "photo"), page: .steps)
            }
        }
    }

    private func reviewRow(_ label: String, _ value: String, page target: Page) -> some View {
        Button {
            page = target
        } label: {
            HStack(alignment: .firstTextBaseline) {
                Text(label).foregroundStyle(.primary)
                Spacer()
                Text(value.isEmpty ? "Empty – tap to fill in" : value)
                    .foregroundStyle(value.isEmpty ? Palette.warm : .secondary)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
            }
        }
    }

    // MARK: 4. Saved

    private var savedStage: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(Palette.success)
            if let saved {
                Text(Labels.code(saved.number)).font(.title.bold())
                Text(saved.title).font(.headline).multilineTextAlignment(.center)
                Text("Saved as \(saved.status). The photos also teach Scan → Item to recognise it.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                printingLabel = true
            } label: {
                Label("Print Label", systemImage: "tag")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button {
                dismiss()
            } label: {
                Text("Done").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            Spacer()
        }
        .padding(24)
    }

    // MARK: Actions

    private var filledSteps: [String] {
        stepLines.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private func stepPosition(_ id: UUID) -> Int {
        (stepLines.firstIndex { $0.id == id } ?? 0) + 1
    }

    private func move(_ delta: Int) {
        guard let next = Page(rawValue: page.rawValue + delta) else { return }
        withAnimation { page = next }
    }

    private func add(_ original: Data) {
        guard shots.count < Self.maxPhotos, let prepared = PhotoProcessing.prepare(original) else { return }
        shots.append(Shot(data: prepared.data, thumb: prepared.thumb,
                          width: prepared.width, height: prepared.height, originalSize: original.count))
    }

    private func addPicked(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) { add(data) }
        }
        pickerItems = []
    }

    private func startDraft() {
        guard let key = APIKeyStore.key else { return }
        aiProblem = nil
        stage = .drafting
        let photos = shots.map(\.data)
        let hint = hint
        draftTask = Task { @MainActor in
            do {
                let result = try await AIDraft.make(photos: photos, hint: hint, key: key)
                guard !Task.isCancelled else { return }
                drafted = true
                startGuide(with: result)
            } catch {
                guard !Task.isCancelled else { return }
                aiProblem = error.localizedDescription
                stage = .photos
            }
        }
    }

    private func startGuide(with result: InstructionDraft) {
        draft = result
        stepLines = result.steps.map { StepLine(text: $0) }
        if stepLines.isEmpty { stepLines = [StepLine(text: "")] }
        for index in shots.indices {
            let step = index < result.photoSteps.count ? result.photoSteps[index] : nil
            shots[index].stepID = step.flatMap { $0 < stepLines.count ? stepLines[$0].id : nil }
        }
        minutes = result.timeEstimate > 0 ? String(result.timeEstimate) : ""
        tagsText = result.tags.joined(separator: ", ")
        if ownerID.isEmpty, let id = local.lastRevisedByID, people.contains(where: { $0.uid == id }) {
            ownerID = id
        }
        number = Numbers.next(after: instructions.map(\.number))
        page = .what
        stage = .guide
    }

    private func save() {
        let number = Numbers.normalize(self.number)
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let steps = filledSteps

        var missing: [String] = []
        if number.isEmpty { missing.append("a number") }
        if title.isEmpty { missing.append("a title (page 1)") }
        if steps.isEmpty { missing.append("at least one step (page 6)") }
        guard missing.isEmpty else {
            saveProblem = "Please add " + missing.joined(separator: ", ") + "."
            return
        }
        if let clash = Library.instruction(number: number, in: context) {
            saveProblem = "AMS#\(number) is already used by \"\(clash.title)\". Choose another number."
            return
        }

        let owner = people.first { $0.uid == ownerID }
        let target = Instruction()
        context.insert(target)
        target.number = number
        target.title = title
        target.category = draft.category
        target.location = draft.location
        target.locationDetail = draft.locationDetail.trimmingCharacters(in: .whitespacesAndNewlines)
        target.summary = draft.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        target.owner = owner?.name ?? ""
        target.ownerID = owner?.uid
        target.frequency = draft.frequency
        target.timeEstimate = Int(minutes.trimmingCharacters(in: .whitespaces)) ?? 0
        target.difficulty = draft.difficulty
        target.tags = tagsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        target.warnings = draft.warnings.trimmingCharacters(in: .whitespacesAndNewlines)
        target.equipment = draft.equipment.trimmingCharacters(in: .whitespacesAndNewlines)
        target.preparations = draft.preparations.trimmingCharacters(in: .whitespacesAndNewlines)
        target.steps = steps
        target.afterUse = draft.afterUse.trimmingCharacters(in: .whitespacesAndNewlines)
        target.maintenance = draft.maintenance.trimmingCharacters(in: .whitespacesAndNewlines)
        target.notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        target.status = StatusRules.calculated(title: title, summary: target.summary, steps: steps,
                                               frequency: target.frequency, timeEstimate: target.timeEstimate,
                                               owner: target.owner, warnings: target.warnings).rawValue
        target.createdAt = Date()
        target.revisions = [Revision(version: 1, timestamp: Date(), authorID: owner?.uid,
                                     authorName: owner?.name ?? "System",
                                     changes: drafted ? "Created from photos (drafted by Claude)" : "Created from photos")]

        // Steps left empty are dropped, so work out each photo's step by
        // position among the steps that remain.
        let keptIDs = stepLines.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map(\.id)
        for (index, shot) in shots.enumerated() {
            let photo = InstructionPhoto(instructionUID: target.uid)
            context.insert(photo)
            photo.name = "Photo \(index + 1)"
            photo.imageData = shot.data
            photo.thumbData = shot.thumb
            photo.width = shot.width
            photo.height = shot.height
            photo.originalSize = shot.originalSize
            photo.step = shot.stepID.flatMap { keptIDs.firstIndex(of: $0) }
            photo.sortIndex = index
        }
        try? context.save()
        saved = target
        stage = .saved
        teachRecognition(for: target.uid)
    }

    /// The photos double as teaching photos for Scan → Item.
    private func teachRecognition(for uid: String) {
        let photos = shots.prefix(Recognition.maxPhotosPerInstruction).map { ($0.data, $0.thumb) }
        Task.detached(priority: .utility) {
            var prints: [(Data, Data)] = []
            for (data, thumb) in photos {
                guard let image = UIImage(data: data),
                      let print = try? Recognition.featurePrint(for: image),
                      let archived = Recognition.archive(print) else { continue }
                prints.append((archived, thumb))
            }
            await MainActor.run {
                for (archived, thumb) in prints {
                    let stored = RecognitionPrint(instructionUID: uid)
                    stored.printData = archived
                    stored.thumbData = thumb
                    context.insert(stored)
                }
                try? context.save()
            }
        }
    }
}

/// "Next ›" rather than "‹ Next".
private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.title
            configuration.icon
        }
    }
}
