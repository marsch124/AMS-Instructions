import SwiftUI
import SwiftData

// Library Health — what the library itself needs, rather than what the RV does.
struct HealthView: View {
    @Environment(\.modelContext) private var context
    @Environment(ToastCenter.self) private var toasts
    @Query private var instructions: [Instruction]
    @Query(sort: \Person.name) private var people: [Person]

    @State private var ownerID = ""
    @State private var confirmingOwner = false
    @State private var confirmingWarning = false

    /// Deliberately honest about being a placeholder: identical confident
    /// boilerplate is what teaches people to skim past warnings.
    static let placeholderWarning = "No specific hazard has been recorded for this job yet. Until one is, treat it with the usual care: the vehicle stable and level, anything powered switched off and isolated, and the whole procedure read through before you start. Replace this with the real hazard once you know what it is."

    struct HealthGroup: Identifiable {
        let key: String
        let title: String
        let blurb: String
        let items: [Instruction]
        var id: String { key }
    }

    private var groups: [HealthGroup] {
        [
            HealthGroup(key: "overdue", title: "Overdue", blurb: "Past the date their frequency implies.",
                  items: Schedule.dueList(instructions).map(\.instruction)),
            HealthGroup(key: "never", title: "Never done",
                  blurb: "They have a frequency but have never been marked Done, so their clock has never started.",
                  items: instructions.filter(Schedule.isNeverDone)),
            HealthGroup(key: "noowner", title: "No owner", blurb: "Nobody is named as responsible.",
                  items: instructions.filter { $0.owner.trimmingCharacters(in: .whitespaces).isEmpty }),
            HealthGroup(key: "unfinished", title: "Draft or Review Needed",
                  blurb: "Missing something the app counts as making an instruction complete.",
                  items: instructions.filter { $0.status == InstructionStatus.draft.rawValue || $0.status == InstructionStatus.reviewNeeded.rawValue }),
            HealthGroup(key: "nowarning", title: "Safety work with no warning",
                  blurb: "Safety and Maintenance instructions that carry no warning text. Not every one needs a warning — but it is worth a second look.",
                  items: instructions.filter {
                      ["Safety", "Maintenance"].contains($0.category)
                          && $0.warnings.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                  })
        ]
    }

    var body: some View {
        let groups = groups
        let colors = OwnerColors(people: people)
        List {
            Section {
                Text("Gaps in the library itself, rather than jobs on the RV. Nothing here is wrong as such — it’s what’s worth a second look.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            if groups.allSatisfy({ $0.items.isEmpty }) {
                Text("Nothing to tidy up. Every instruction has an owner, a status and a warning where it needs one.")
            }
            ForEach(groups) { group in
                Section {
                    DisclosureGroup {
                        Text(group.blurb).font(.caption).foregroundStyle(.secondary)
                        if group.items.isEmpty {
                            Text("None — nothing to do here.").foregroundStyle(.secondary)
                        } else {
                            fixer(for: group)
                            ForEach(group.items.sorted { $0.number < $1.number }) { instruction in
                                NavigationLink(value: instruction) {
                                    InstructionRow(instruction: instruction,
                                                   ownerName: ownerName(of: instruction, people: people),
                                                   colors: colors)
                                }
                            }
                        }
                    } label: {
                        HStack {
                            Text(group.title).font(.headline)
                            Spacer()
                            Text("\(group.items.count)")
                                .monospacedDigit()
                                .foregroundStyle(group.items.isEmpty ? .secondary : .primary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Library Health")
        .onAppear {
            if ownerID.isEmpty { ownerID = people.first?.uid ?? "" }
        }
        .confirmationDialog("Set owner on everything without one?", isPresented: $confirmingOwner,
                            titleVisibility: .visible) {
            Button("Set owner") { fillOwners() }
        } message: {
            Text("Instructions that already have an owner are left alone.")
        }
        .confirmationDialog("Add a placeholder warning?", isPresented: $confirmingWarning,
                            titleVisibility: .visible) {
            Button("Add placeholder") { fillWarnings() }
        } message: {
            Text("Each one gets the same holding text, which says plainly that the real hazard has not been recorded yet and asks you to replace it.")
        }
    }

    /// Only two gaps can be closed with one decision for the whole library.
    /// Everything else needs judgement per instruction.
    @ViewBuilder
    private func fixer(for group: HealthGroup) -> some View {
        switch group.key {
        case "noowner":
            if people.isEmpty {
                Text("Add someone under Settings → Manage People first.").foregroundStyle(.secondary)
            } else {
                Picker("Owner", selection: $ownerID) {
                    ForEach(people) { Text($0.name).tag($0.uid) }
                }
                Button("Set as owner on all \(group.items.count)") { confirmingOwner = true }
            }
        case "nowarning":
            Button("Add a placeholder warning to all \(group.items.count)") { confirmingWarning = true }
        default:
            EmptyView()
        }
    }

    private func fillOwners() {
        guard let person = people.first(where: { $0.uid == ownerID }) else { return }
        let items = instructions.filter { $0.owner.trimmingCharacters(in: .whitespaces).isEmpty }
        for instruction in items {
            instruction.owner = person.name
            instruction.ownerID = person.uid
        }
        try? context.save()
        toasts.show("✓ \(person.name) set as owner on \(items.count)")
    }

    private func fillWarnings() {
        let items = instructions.filter {
            ["Safety", "Maintenance"].contains($0.category)
                && $0.warnings.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        for instruction in items {
            instruction.warnings = Self.placeholderWarning
        }
        try? context.save()
        toasts.show("✓ Placeholder warning added to \(items.count)")
    }
}

struct AboutView: View {
    var body: some View {
        List {
            Section("Finding an instruction") {
                Text("Every instruction has a number, shown as AMS#007. Tap Scan on the Home screen and point the camera at its label, or type the number.")
            }
            Section("Printing labels") {
                Text("Open an instruction and tap Print Label, below Mark Done. Choose your tape width, then Send to the printer's app (Brother or DYMO) and print. For many at once: Instructions → filter → Apply to all → Print labels.")
            }
            Section("Recognising an item without a label") {
                Text("On an instruction, under Recognise this item, take 2–3 teaching photos of the item. Later, Scan → Item → Recognise opens the instruction when you point the camera at the item. If it is unsure, it shows the likeliest three to choose from.")
            }
            Section("New from Photos") {
                Text("Instructions → New → New from Photos. Take 2–5 photos of the item, then go through ten short pages — title, place, category, safety, equipment, steps, afterwards, schedule, owner — and save. The photos become the instruction's photos and its teaching photos.")
                Text("With an API key, Draft with Claude fills in every page from the photos first; you check and correct. Without a key the pages start empty.")
            }
            Section("AI Drafts and the API key") {
                Text("Your Claude subscription covers you talking to Claude — in the Claude app or on claude.ai. This app is a separate program, and Anthropic lets a program use Claude only with an API key, billed per use to a separate API account. A draft costs a few cents; $5 of credit lasts for many.")
                Text("To set it up: sign in at console.anthropic.com (the same email works), add a payment method and some credit under Billing, create a key under API Keys, copy it, and paste it here under Settings → AI Drafts → Save Key. The app checks it at once.")
                Text("The key is kept in the iPhone's Keychain, never in backups. Drafting sends the photos to Anthropic; nothing is sent unless you tap Draft with Claude.")
            }
            Section("Doing the job") {
                Text("Tick the steps as you go; your place is kept even if you lock the phone. Tap Mark Done when finished. The app asks who did it once, then remembers — tap “Not you?” to correct it.")
            }
            Section("When things fall due") {
                Text("Daily, weekly, monthly, seasonal and yearly jobs come round again after they are marked Done. Their clock starts the first time you mark them Done, so a new library never starts out overdue.")
            }
            Section("Plan My Time") {
                Text("For when you have a free stretch — say an hour in the RV. Home → Plan My Time: choose how much time you have (15 min to 2 h), where you are (In the RV, At Home, Anywhere) and, if you like, only some kinds of job. Suggest a Plan fills the time with the most pressing jobs: overdue first, then due this week, then the ones not done for longest.")
                Text("Adjust the plan before you start: swipe a job away, Edit to change the order, + to add from Also fits, or open Add from … for jobs that take longer than the time left. A job without a time estimate counts as about 10 minutes (shown with ≈).")
                Text("Start turns the plan into a checklist that shows the time left. Moved on — from the RV to the house, say? Tap Edit Plan, change the place, time or jobs, and Update Checklist: what you already ticked stays ticked. Finish marks the ticked jobs as Done.")
            }
            Section("Routines") {
                Text("A routine is a plan you keep, with a name — “Saturday RV hour”, “Monthly water check”. On a plan, tap Save as Routine. Your routines are listed under Plan My Time and in Settings → Run a Set; open one, adjust it if you like, and Start. Changes to a routine are kept with Save Changes to Routine; swipe it away under Plan My Time to delete it.")
                Text("Routines sync to your other devices and are included in backups.")
            }
            Section("Run a Set") {
                Text("Work through several instructions as one checklist — everything before a trip, everything due, or a whole category. Finishing marks each ticked one as Done.")
            }
            Section("To-dos and audits") {
                Text("Actions holds your to-dos. An audit records who checked an instruction and what they found; a finding can be turned into a to-do.")
            }
            Section("People") {
                Text("Settings → Manage People holds everyone who owns, does or audits jobs, with phone and email. Tap a person to add a photo; it is shown next to their name throughout the app, and their initials are shown when there is none.")
            }
            Section("Your data") {
                Text("The library syncs through your iCloud account to every device signed in to it. The app also keeps two automatic backups on each device, and Back Up Now saves a file you can keep anywhere. Backup files from the web version restore here unchanged.")
            }
        }
        .navigationTitle("How This Works")
    }
}

/// The words the app uses, each in a sentence or two.
struct DefinitionsView: View {
    private let terms: [(String, String)] = [
        ("Instruction", "How to do one job or use one thing: title, where it is, safety, steps, and more. The heart of the app."),
        ("AMS number", "Each instruction's number, shown as AMS#007. It is printed on the label and opens the instruction when scanned."),
        ("Step", "One action in an instruction. Tick steps as you go; the ticks are kept until you mark the job Done."),
        ("Mark Done", "Records that the job was done, when and by whom. It restarts the clock for jobs that repeat."),
        ("Frequency", "How often a job comes round: daily to yearly, or event-based — before each trip, every session, as needed."),
        ("Due / Overdue", "A repeating job falls due a set time after it was last marked Done. Never-done jobs are never overdue."),
        ("Owner", "The person who looks after an instruction. Shown with their photo or initials."),
        ("Category", "The kind of job, e.g. Water Systems, Maintenance, Home, Bike. Categories are grouped as RV, Life and Sport."),
        ("Place", "In Plan My Time: In the RV (the RV categories), At Home (Home) or Anywhere (everything)."),
        ("Plan My Time", "Tell the app how much time you have and where you are; it suggests jobs that fit, most pressing first, for you to adjust and start."),
        ("Plan", "The list of jobs Plan My Time put together, with the minutes they add up to."),
        ("Routine", "A plan saved with a name, to start again whenever you like. Listed under Plan My Time and in Run a Set; synced and backed up."),
        ("Checklist (run)", "Several instructions worked through one after another. Tick each one; Finish marks the ticked ones Done. One runs at a time."),
        ("Run a Set", "Starts a checklist from a ready-made set: before each trip, everything due, favourites, a category, or one of your routines."),
        ("Time estimate", "How many minutes a job takes. Plan My Time counts one without an estimate as about 10 minutes (≈)."),
        ("Label", "A printed sticker with the AMS number and a QR code, made with Print Label for a label printer."),
        ("Teaching photo", "A photo of an item that lets Scan → Item recognise it without a label."),
        ("Audit", "A record that someone checked an instruction, with what they found. A finding can become a to-do."),
        ("Action (to-do)", "Something to fix or do, on the Actions tab, with a priority and a due date."),
        ("AI Draft", "Claude drafting a new instruction from photos (New from Photos). Needs your own API key.")
    ]

    var body: some View {
        List {
            ForEach(terms, id: \.0) { term, meaning in
                VStack(alignment: .leading, spacing: 4) {
                    Text(term).font(.headline)
                    Text(meaning).font(.callout).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
        .navigationTitle("Definitions")
    }
}
