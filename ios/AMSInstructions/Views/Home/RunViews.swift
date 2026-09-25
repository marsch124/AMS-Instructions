import SwiftUI
import SwiftData

// Run a Set — working through several instructions as one checklist.

struct RunSet: Identifiable {
    let id: String
    let name: String
    let instructions: [Instruction]
}

enum RunSets {
    /// Membership is worked out fresh here, but a started run keeps its own
    /// list of numbers — otherwise "Everything due now" would shrink as you
    /// ticked things off, and the run would never finish.
    static func available(_ instructions: [Instruction]) -> [RunSet] {
        var sets: [RunSet] = []
        let byNumber: (Instruction, Instruction) -> Bool = { $0.number < $1.number }

        let trip = instructions.filter { $0.frequency == "Before each trip" }.sorted(by: byNumber)
        if !trip.isEmpty { sets.append(RunSet(id: "trip", name: "Before each trip", instructions: trip)) }

        let due = Schedule.dueList(instructions).map(\.instruction)
        if !due.isEmpty { sets.append(RunSet(id: "due", name: "Everything due now", instructions: due)) }

        let favourites = instructions.filter(\.isFavorite).sorted(by: byNumber)
        if !favourites.isEmpty { sets.append(RunSet(id: "favourites", name: "Favourites", instructions: favourites)) }

        let byCategory = Dictionary(grouping: instructions) { $0.category.isEmpty ? "General" : $0.category }
        for category in Categories.ordered(byCategory.keys) {
            sets.append(RunSet(id: "category:" + category, name: Categories.label(category),
                               instructions: (byCategory[category] ?? []).sorted(by: byNumber)))
        }
        return sets
    }
}

struct RunPickerView: View {
    @Environment(LocalState.self) private var local
    @Query private var instructions: [Instruction]
    @State private var confirmReplace: RunSet?
    @State private var openRun = false

    var body: some View {
        List {
            Section {
                Text("Work through several instructions as one checklist. Tap any of them to open it in full — you’ll come back here afterwards.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            // An unfinished run is offered back first: starting a second one
            // would throw the first away.
            if let run = local.currentRun {
                Section("In progress") {
                    Button {
                        openRun = true
                    } label: {
                        LabeledContent(run.name, value: "\(run.ticked.count) of \(run.numbers.count) done")
                    }
                }
            }

            Section("Start a run") {
                ForEach(RunSets.available(instructions)) { set in
                    Button {
                        if local.currentRun == nil { start(set) } else { confirmReplace = set }
                    } label: {
                        LabeledContent(set.name, value: "\(set.instructions.count)")
                    }
                }
            }
        }
        .navigationTitle("Run a Set")
        .navigationDestination(isPresented: $openRun) {
            RunView()
        }
        .confirmationDialog("Replace the run in progress?",
                            isPresented: Binding(get: { confirmReplace != nil }, set: { if !$0 { confirmReplace = nil } }),
                            titleVisibility: .visible, presenting: confirmReplace) { set in
            Button("Start \(set.name)", role: .destructive) { start(set) }
        } message: { _ in
            Text("The ticks in your current run are discarded. Anything already marked Done stays done.")
        }
    }

    private func start(_ set: RunSet) {
        local.currentRun = LocalState.Run(id: set.id, name: set.name,
                                          numbers: set.instructions.map(\.number), ticked: [])
        openRun = true
    }
}

struct RunView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(LocalState.self) private var local
    @Environment(ToastCenter.self) private var toasts
    @Query(sort: \Person.name) private var people: [Person]
    @Query private var instructions: [Instruction]

    @State private var choosing = false
    @State private var amending = false
    @State private var confirmAbandon = false
    @State private var lastFinished: [String] = []

    var body: some View {
        if let run = local.currentRun {
            runList(run)
        } else {
            ContentUnavailableView("No run in progress", systemImage: "checklist",
                                   description: Text("Start one under Settings → Run a Set."))
                .sheet(isPresented: $amending) { amendChooser }
        }
    }

    private func runList(_ run: LocalState.Run) -> some View {
        let byNumber = Dictionary(instructions.map { ($0.number, $0) }, uniquingKeysWith: { a, _ in a })
        return List {
            Section {
                Text("\(run.ticked.count) of \(run.numbers.count) done")
                    .font(.headline)
                    .foregroundStyle(.tint)
            }
            Section {
                // An instruction deleted mid-run is skipped rather than left as
                // a row that cannot be opened.
                ForEach(run.numbers.filter { byNumber[$0] != nil }, id: \.self) { number in
                    let instruction = byNumber[number]!
                    let done = run.ticked.contains(number)
                    HStack(spacing: 12) {
                        Button {
                            toggle(number)
                        } label: {
                            Image(systemName: done ? "checkmark.square.fill" : "square")
                                .font(.title2)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(done ? "Mark as not done" : "Mark as done")

                        NavigationLink(value: instruction) {
                            HStack {
                                Text(instruction.number).monospacedDigit().bold()
                                Text(instruction.title)
                                    .strikethrough(done)
                                    .foregroundStyle(done ? .secondary : .primary)
                            }
                        }
                    }
                }
            }
            Section {
                Button {
                    finish()
                } label: {
                    Label(run.ticked.isEmpty ? "Finish run" : "Finish — mark \(run.ticked.count) as Done",
                          systemImage: "checkmark.circle.fill")
                }
                .disabled(run.ticked.isEmpty)

                Button("Abandon this run", role: .destructive) { confirmAbandon = true }
            }
        }
        .navigationTitle(run.name)
        .sheet(isPresented: $choosing) {
            PersonChooser(title: "Who did it?",
                          message: "Recorded against everything you ticked in this run.") { person in
                local.lastDoneByID = person?.uid
                complete(by: person)
            }
        }
        .sheet(isPresented: $amending) { amendChooser }
        .confirmationDialog("Abandon this run?", isPresented: $confirmAbandon, titleVisibility: .visible) {
            Button("Abandon", role: .destructive) {
                local.currentRun = nil
                dismiss()
            }
        } message: {
            Text("The ticks for this run are discarded. Anything already marked Done stays done.")
        }
    }

    private var amendChooser: some View {
        PersonChooser(title: "Who did it?",
                      message: "This replaces the name on what you just marked done.") { person in
            local.lastDoneByID = person?.uid
            for number in lastFinished {
                if let instruction = Library.instruction(number: number, in: context) {
                    Library.amendLastCompletion(instruction, to: person)
                }
            }
            try? context.save()
            toasts.show(person.map { "✓ \(lastFinished.count) recorded as \($0.name)" }
                        ?? "✓ Name removed from \(lastFinished.count)")
        }
    }

    private func toggle(_ number: String) {
        guard var run = local.currentRun else { return }
        if let index = run.ticked.firstIndex(of: number) {
            run.ticked.remove(at: index)
        } else {
            run.ticked.append(number)
        }
        local.currentRun = run
    }

    /// Asked once for the whole run, not once per instruction: a departure
    /// checklist is one person working through one list.
    private func finish() {
        if let id = local.lastDoneByID, let person = people.first(where: { $0.uid == id }) {
            complete(by: person)
        } else {
            choosing = true
        }
    }

    private func complete(by person: Person?) {
        guard let run = local.currentRun else { return }
        // Only what was actually ticked is recorded; untouched ones are left alone.
        for number in run.ticked {
            if let instruction = Library.instruction(number: number, in: context) {
                Library.recordCompletion(instruction, by: person)
            }
        }
        try? context.save()
        lastFinished = run.ticked
        local.currentRun = nil

        let count = run.ticked.count
        let message = count == 1 ? "✓ Run finished — 1 marked as Done" : "✓ Run finished — \(count) marked as Done"
        toasts.show(person.map { message + " · " + $0.name } ?? message, actionLabel: "Not you?") {
            amending = true
        }
    }
}
