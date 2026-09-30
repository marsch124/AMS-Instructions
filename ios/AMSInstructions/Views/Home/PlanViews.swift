import SwiftUI
import SwiftData

// Plan My Time — "I have an hour, what should I do?". The app fills the time
// with the most pressing jobs for where you are; you adjust the list, then work
// through it as a checklist. A plan can be kept as a routine.

/// A plan being put together: fresh from the setup screen, or a saved routine.
struct PlanDraft: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var budget: Int
    var place: PlanPlace
    var kinds: Set<String>
    /// Empty for a fresh plan: the app suggests one.
    var numbers: [String]
    var routineUID: String?
    /// The checklist this plan runs as; kept when the plan is reopened mid-run.
    var runID: String = "plan:" + UUID().uuidString
}

struct PlanSetupView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Routine.createdAt) private var routines: [Routine]

    @State private var budget = 60
    @State private var place = PlanPlace.rv
    @State private var kinds: Set<String> = []
    @State private var draft: PlanDraft?

    var body: some View {
        Form {
            Section("How much time?") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 70))], spacing: 8) {
                    ForEach(Planner.budgets, id: \.self) { minutes in
                        chip(Formatting.minutes(minutes), selected: budget == minutes) { budget = minutes }
                    }
                }
                .padding(.vertical, 4)
            }

            Section("Where are you?") {
                Picker("Where", selection: $place) {
                    ForEach(PlanPlace.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .onChange(of: place) { _, _ in kinds = [] }
            }

            Section {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 8) {
                    ForEach(place.categories, id: \.self) { category in
                        chip(Categories.label(category), selected: kinds.contains(category),
                             colour: Categories.color(category)) {
                            if kinds.contains(category) { kinds.remove(category) } else { kinds.insert(category) }
                        }
                    }
                }
                .padding(.vertical, 4)
            } header: {
                Text("Only these kinds (optional)")
            } footer: {
                Text(kinds.isEmpty ? "Nothing chosen: every kind from this place." : "Only the kinds you picked.")
            }

            Section {
                Button {
                    draft = PlanDraft(name: "\(Formatting.minutes(budget)) · \(place.short)", budget: budget,
                                      place: place, kinds: kinds, numbers: [], routineUID: nil)
                } label: {
                    Label("Suggest a Plan", systemImage: "wand.and.stars")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .listRowBackground(Color.clear)
            } footer: {
                Text("Overdue jobs come first, then those due this week, then the ones not done for longest.")
            }

            if !routines.isEmpty {
                Section("Your routines") {
                    ForEach(routines) { routine in
                        Button {
                            draft = PlanDraft(name: routine.name, budget: max(routine.minutes, 15),
                                              place: PlanPlace(rawValue: routine.place) ?? .anywhere,
                                              kinds: Set(routine.kinds), numbers: routine.numbers,
                                              routineUID: routine.uid, runID: "plan:" + routine.uid)
                        } label: {
                            LabeledContent(routine.name,
                                           value: "\(Formatting.plural(routine.numbers.count, "job")) · \(Formatting.minutes(routine.minutes))")
                                .foregroundStyle(.primary)
                        }
                    }
                    .onDelete { offsets in
                        for index in offsets { context.delete(routines[index]) }
                        try? context.save()
                    }
                }
            }
        }
        .navigationTitle("Plan My Time")
        .navigationDestination(item: $draft) { draft in
            PlanEditView(draft: draft)
        }
    }

    private func chip(_ title: String, selected: Bool, colour: Color? = nil,
                      action: @escaping () -> Void) -> some View {
        PlanChip(title: title, selected: selected, colour: colour, action: action)
    }
}

/// A tappable choice: time, or a kind of job.
struct PlanChip: View {
    let title: String
    let selected: Bool
    var colour: Color?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(selected ? .bold : .regular))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background((colour ?? Color.accentColor).opacity(selected ? 0.22 : 0.08),
                            in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10)
                    .stroke(selected ? (colour ?? Color.accentColor) : .clear, lineWidth: 1.5))
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.primary)
    }
}

struct PlanEditView: View {
    let draft: PlanDraft
    /// True when opened from the running checklist: Update goes back to it.
    var openedFromRun = false

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(LocalState.self) private var local
    @Environment(ToastCenter.self) private var toasts
    @Query private var instructions: [Instruction]
    @Query private var routines: [Routine]

    @State private var plan: [Instruction] = []
    @State private var budget: Int
    @State private var place: PlanPlace
    @State private var kinds: Set<String>
    @State private var loaded = false
    @State private var naming = false
    @State private var routineName = ""
    @State private var confirmReplace = false
    @State private var running = false
    @State private var showingRest = false
    @State private var opened: Instruction?

    init(draft: PlanDraft, openedFromRun: Bool = false) {
        self.draft = draft
        self.openedFromRun = openedFromRun
        _budget = State(initialValue: draft.budget)
        _place = State(initialValue: draft.place)
        _kinds = State(initialValue: draft.kinds)
    }

    /// This plan is the checklist running right now.
    private var isRunning: Bool { local.currentRun?.id == draft.runID }

    var body: some View {
        let used = Planner.total(plan)
        let chosen = Set(plan.map(\.uid))
        let others = Planner.candidates(instructions, place: place, kinds: kinds)
            .filter { !chosen.contains($0.uid) }
        let split = Planner.split(others, left: budget - used, plan: plan)

        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(Formatting.plural(plan.count, "job")).font(.headline)
                        Spacer()
                        Text("\(used) of \(budget) min")
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(used > budget ? Palette.warm : Color.primary)
                    }
                    ProgressView(value: Double(min(used, budget)), total: Double(max(budget, 1)))
                        .tint(used > budget ? Palette.warm : Palette.home)
                    if used > budget {
                        Text("\(used - budget) min over your time").font(.caption).foregroundStyle(Palette.warm)
                    }
                }
                .padding(.vertical, 4)
                // Also at the bottom; here so a long plan can start at once.
                startButton
            }

            criteria

            Section {
                if plan.isEmpty {
                    Text("Nothing fits yet. Add jobs from the lists below, or pick more time or another place.")
                        .foregroundStyle(.secondary)
                }
                ForEach(plan) { instruction in
                    openButton(instruction)
                }
                .onDelete { plan.remove(atOffsets: $0) }
                .onMove { plan.move(fromOffsets: $0, toOffset: $1) }
            } header: {
                Text("The plan, in order")
            } footer: {
                if !plan.isEmpty {
                    Text("Swipe a job to remove it. Edit (top right) to change the order.")
                }
            }

            if !split.alsoFits.isEmpty {
                Section("Also fits") {
                    ForEach(split.alsoFits) { instruction in addRow(instruction) }
                }
            }

            if !split.rest.isEmpty {
                Section {
                    DisclosureGroup(isExpanded: $showingRest) {
                        ForEach(split.rest) { instruction in addRow(instruction) }
                    } label: {
                        HStack {
                            Text("Add from \(place.label)")
                            Spacer()
                            Text("\(split.rest.count)")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                } footer: {
                    Text("These take longer than the time left.")
                }
            }

            Section {
                startButton

                Button {
                    if let uid = draft.routineUID, let routine = routines.first(where: { $0.uid == uid }) {
                        save(into: routine)
                    } else {
                        routineName = ""
                        naming = true
                    }
                } label: {
                    Label(draft.routineUID == nil ? "Save as Routine" : "Save Changes to Routine",
                          systemImage: "tray.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(plan.isEmpty)
                .listRowBackground(Color.clear)
            } footer: {
                if isRunning {
                    Text("Updates the checklist in progress. Ticks on jobs still in the plan are kept.")
                }
            }
        }
        .navigationTitle(draft.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { EditButton() }
        }
        .onAppear(perform: load)
        .navigationDestination(item: $opened) { InstructionDetailView(instruction: $0) }
        .navigationDestination(isPresented: $running) {
            RunView(backToPlan: { running = false })
        }
        .alert("Save as routine", isPresented: $naming) {
            TextField("e.g. Saturday RV hour", text: $routineName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { saveNew() }
        } message: {
            Text("It appears under Plan My Time and in Run a Routine, and syncs to your other devices.")
        }
        .confirmationDialog("Replace the run in progress?", isPresented: $confirmReplace, titleVisibility: .visible) {
            Button("Start \(draft.name)", role: .destructive) { start() }
        } message: {
            Text("The ticks in your current run are discarded. Anything already marked Done stays done.")
        }
    }

    private var startButton: some View {
        Button {
            if isRunning { updateRun() }
            else if local.currentRun == nil { start() }
            else { confirmReplace = true }
        } label: {
            Label(isRunning ? "Update Checklist" : "Start",
                  systemImage: isRunning ? "arrow.triangle.2.circlepath" : "play.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .disabled(plan.isEmpty)
    }

    /// Time, place and kinds, changeable at any point — say, when you move
    /// from the RV to the house. Jobs already planned stay put.
    private var criteria: some View {
        Section {
            Picker("Time", selection: $budget) {
                ForEach(Planner.budgets, id: \.self) { Text(Formatting.minutes($0)).tag($0) }
            }
            Picker("Where", selection: $place) {
                ForEach(PlanPlace.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: place) { _, _ in kinds = [] }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 8) {
                ForEach(place.categories, id: \.self) { category in
                    PlanChip(title: Categories.label(category), selected: kinds.contains(category),
                             colour: Categories.color(category)) {
                        if kinds.contains(category) { kinds.remove(category) } else { kinds.insert(category) }
                    }
                }
            }
            .padding(.vertical, 4)
            Button {
                let candidates = Planner.candidates(instructions, place: place, kinds: kinds)
                withAnimation { plan = Planner.suggest(budget: budget, from: candidates).plan }
            } label: {
                Label("Suggest Again", systemImage: "wand.and.stars")
            }
        } header: {
            Text("Time · Place · Kinds")
        } footer: {
            Text("Change these any time: the plan keeps its jobs, and the lists below follow. Suggest Again starts the plan over.")
        }
    }

    private func row(_ instruction: Instruction) -> some View {
        HStack(spacing: 10) {
            Circle().fill(Categories.color(instruction.category)).frame(width: 8, height: 8)
            Text(instruction.number).font(.subheadline.monospacedDigit().bold()).foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(instruction.title).lineLimit(2)
                if let note = dueNote(instruction) {
                    Text(note).font(.caption).foregroundStyle(Schedule.isDue(instruction) ? Palette.danger : Color.secondary)
                }
            }
            Spacer(minLength: 4)
            Text((Planner.isEstimated(instruction) ? "≈" : "") + "\(Planner.minutes(for: instruction)) min")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    /// Opens the instruction from here. A value link would not: this screen
    /// is itself pushed outside the tab's navigation path, and SwiftUI then
    /// ignores value links.
    private func openButton(_ instruction: Instruction) -> some View {
        Button {
            opened = instruction
        } label: {
            HStack {
                row(instruction)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func addRow(_ instruction: Instruction) -> some View {
        HStack {
            Button {
                withAnimation { plan.append(instruction) }
            } label: {
                Image(systemName: "plus.circle.fill").font(.title3)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Add \(instruction.title)")
            openButton(instruction)
        }
    }

    private func dueNote(_ instruction: Instruction) -> String? {
        if let due = Schedule.nextDue(instruction) {
            return due <= Date() ? Schedule.overdueBy(due).capitalizedFirst : "Due " + Schedule.dueIn(due).lowercased()
        }
        if Schedule.isNeverDone(instruction) { return "Never done" }
        return instruction.lastCompleted.map { "Last done " + Formatting.relative($0) }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if draft.numbers.isEmpty {
            let candidates = Planner.candidates(instructions, place: place, kinds: kinds)
            plan = Planner.suggest(budget: budget, from: candidates).plan
        } else {
            let byNumber = Dictionary(instructions.map { ($0.number, $0) }, uniquingKeysWith: { a, _ in a })
            plan = draft.numbers.compactMap { byNumber[$0] }
        }
    }

    private func makeRun(ticked: [String]) -> LocalState.Run {
        LocalState.Run(id: draft.runID, name: draft.name, numbers: plan.map(\.number), ticked: ticked,
                       budget: budget, place: place.rawValue, kinds: Array(kinds).sorted())
    }

    private func start() {
        local.currentRun = makeRun(ticked: [])
        running = true
    }

    /// Mid-run changes: the new list, keeping the ticks that still apply.
    private func updateRun() {
        let numbers = Set(plan.map(\.number))
        let kept = (local.currentRun?.ticked ?? []).filter(numbers.contains)
        local.currentRun = makeRun(ticked: kept)
        toasts.show("✓ Checklist updated")
        if openedFromRun { dismiss() } else { running = true }
    }

    private func saveNew() {
        let name = routineName.trimmingCharacters(in: .whitespaces)
        let routine = Routine(name: name.isEmpty ? draft.name : name)
        context.insert(routine)
        save(into: routine)
    }

    private func save(into routine: Routine) {
        routine.numbers = plan.map(\.number)
        routine.minutes = budget
        routine.place = place.rawValue
        routine.kinds = Array(kinds).sorted()
        try? context.save()
        toasts.show("✓ Routine \"\(routine.name)\" saved")
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
