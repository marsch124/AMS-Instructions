import SwiftUI
import SwiftData

// Plan My Time — "I have an hour, what should I do?". The app fills the time
// with the most pressing jobs for where you are; you adjust the list, then work
// through it with the Run a Set checklist. A plan can be kept as a routine.

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
                                              routineUID: routine.uid)
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

    @Environment(\.modelContext) private var context
    @Environment(LocalState.self) private var local
    @Environment(ToastCenter.self) private var toasts
    @Query private var instructions: [Instruction]
    @Query private var routines: [Routine]

    @State private var plan: [Instruction] = []
    @State private var loaded = false
    @State private var naming = false
    @State private var routineName = ""
    @State private var confirmReplace = false
    @State private var running = false
    @State private var showingRest = false

    var body: some View {
        let used = Planner.total(plan)
        let chosen = Set(plan.map(\.uid))
        let others = Planner.candidates(instructions, place: draft.place, kinds: draft.kinds)
            .filter { !chosen.contains($0.uid) }
        let split = Planner.split(others, left: draft.budget - used, plan: plan)

        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(Formatting.plural(plan.count, "job")).font(.headline)
                        Spacer()
                        Text("\(used) of \(draft.budget) min")
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(used > draft.budget ? Palette.warm : Color.primary)
                    }
                    ProgressView(value: Double(min(used, draft.budget)), total: Double(max(draft.budget, 1)))
                        .tint(used > draft.budget ? Palette.warm : Palette.home)
                    if used > draft.budget {
                        Text("\(used - draft.budget) min over your time").font(.caption).foregroundStyle(Palette.warm)
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                if plan.isEmpty {
                    Text("Nothing fits yet. Add jobs from the lists below, or pick more time or another place.")
                        .foregroundStyle(.secondary)
                }
                ForEach(plan) { instruction in
                    NavigationLink(value: instruction) { row(instruction) }
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
                        Text("More from \(draft.place == .anywhere ? "everywhere" : draft.place.label.lowercased()) (\(split.rest.count))")
                    }
                } footer: {
                    Text("These take longer than the time left.")
                }
            }

            Section {
                Button {
                    if local.currentRun == nil { start() } else { confirmReplace = true }
                } label: {
                    Label("Start", systemImage: "play.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(plan.isEmpty)
                .listRowBackground(Color.clear)

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
            }
        }
        .navigationTitle(draft.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { EditButton() }
        }
        .onAppear(perform: load)
        .navigationDestination(isPresented: $running) { RunView() }
        .alert("Save as routine", isPresented: $naming) {
            TextField("e.g. Saturday RV hour", text: $routineName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { saveNew() }
        } message: {
            Text("It appears under Plan My Time and in Run a Set, and syncs to your other devices.")
        }
        .confirmationDialog("Replace the run in progress?", isPresented: $confirmReplace, titleVisibility: .visible) {
            Button("Start \(draft.name)", role: .destructive) { start() }
        } message: {
            Text("The ticks in your current run are discarded. Anything already marked Done stays done.")
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

    private func addRow(_ instruction: Instruction) -> some View {
        HStack {
            Button {
                withAnimation { plan.append(instruction) }
            } label: {
                Image(systemName: "plus.circle.fill").font(.title3)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Add \(instruction.title)")
            NavigationLink(value: instruction) { row(instruction) }
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
            let candidates = Planner.candidates(instructions, place: draft.place, kinds: draft.kinds)
            plan = Planner.suggest(budget: draft.budget, from: candidates).plan
        } else {
            let byNumber = Dictionary(instructions.map { ($0.number, $0) }, uniquingKeysWith: { a, _ in a })
            plan = draft.numbers.compactMap { byNumber[$0] }
        }
    }

    private func start() {
        local.currentRun = LocalState.Run(id: "plan:" + (draft.routineUID ?? UUID().uuidString),
                                          name: draft.name, numbers: plan.map(\.number), ticked: [])
        running = true
    }

    private func saveNew() {
        let name = routineName.trimmingCharacters(in: .whitespaces)
        let routine = Routine(name: name.isEmpty ? draft.name : name)
        context.insert(routine)
        save(into: routine)
    }

    private func save(into routine: Routine) {
        routine.numbers = plan.map(\.number)
        routine.minutes = draft.budget
        routine.place = draft.place.rawValue
        routine.kinds = Array(draft.kinds).sorted()
        try? context.save()
        toasts.show("✓ Routine \"\(routine.name)\" saved")
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
