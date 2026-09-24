import SwiftUI
import SwiftData

// Filters on the Instructions tab.
//
// Search answers "where did I write that?". Filters answer "what needs my
// attention?". Chosen within one group they widen (Anna OR Martin); chosen
// across groups they narrow (Anna AND overdue).
//
// Nothing is remembered between launches: a filter set yesterday and forgotten
// would show a short list today and look like data loss.

enum FilterGroup: String, CaseIterable {
    case person, due, status, gaps, marks
}

struct FilterState: Equatable {
    var chosen: [FilterGroup: Set<String>] = [:]

    var count: Int { chosen.values.reduce(0) { $0 + $1.count } }
    var isActive: Bool { count > 0 }

    func isOn(_ group: FilterGroup, _ key: String) -> Bool {
        chosen[group]?.contains(key) ?? false
    }

    mutating func toggle(_ group: FilterGroup, _ key: String) {
        var set = chosen[group] ?? []
        if set.contains(key) { set.remove(key) } else { set.insert(key) }
        chosen[group] = set.isEmpty ? nil : set
    }

    func passes(_ instruction: Instruction, context: FilterContext) -> Bool {
        chosen.allSatisfy { group, keys in
            keys.isEmpty || keys.contains { FilterRules.matches(group, $0, instruction, context) }
        }
    }
}

/// Everything a filter needs that isn't on the instruction itself, worked out
/// once per screenful rather than once per row.
struct FilterContext {
    let people: [Person]
    let openTodos: Set<String>
    let audited: Set<String>
    let withPhotos: Set<String>
    let now = Date()

    init(people: [Person], actions: [ActionItem], audits: [Audit], photos: [InstructionPhoto]) {
        withPhotos = Set(photos.map(\.instructionUID))
        self.people = people.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        openTodos = Set(actions.filter { !$0.isDone }.compactMap(\.instructionUID))
        audited = Set(audits.map(\.instructionUID))
    }
}

enum FilterRules {
    struct Chip: Identifiable {
        let key: String
        let label: String
        let systemImage: String
        var id: String { key }
    }

    struct Section: Identifiable {
        let group: FilterGroup
        let title: String
        let chips: [Chip]
        var id: FilterGroup { group }
    }

    static func sections(people: [Person]) -> [Section] {
        [
            Section(group: .person, title: "Whose job it is",
                    chips: people.map { Chip(key: $0.uid, label: $0.name, systemImage: "person") }
                        + [Chip(key: "none", label: "Nobody named", systemImage: "questionmark.circle")]),
            Section(group: .due, title: "When it's due", chips: [
                Chip(key: "overdue", label: "Overdue", systemImage: "clock.badge.exclamationmark"),
                Chip(key: "soon", label: "Due within a week", systemImage: "calendar"),
                Chip(key: "never", label: "Never done", systemImage: "hourglass"),
                Chip(key: "noclock", label: "No repeat", systemImage: "repeat")
            ]),
            Section(group: .status, title: "Status", chips: [
                Chip(key: "Active", label: "Active", systemImage: "checkmark.seal"),
                Chip(key: "Draft", label: "Draft", systemImage: "doc.text"),
                Chip(key: "Review Needed", label: "Review Needed", systemImage: "exclamationmark.bubble"),
                Chip(key: "Archived", label: "Archived", systemImage: "archivebox")
            ]),
            Section(group: .gaps, title: "Gaps worth a second look", chips: [
                Chip(key: "warning", label: "No warning", systemImage: "exclamationmark.triangle"),
                Chip(key: "photo", label: "No photo", systemImage: "photo.badge.exclamationmark"),
                Chip(key: "steps", label: "Barely any steps", systemImage: "list.bullet")
            ]),
            Section(group: .marks, title: "Quick marks", chips: [
                Chip(key: "favourite", label: "Favourite", systemImage: "star"),
                Chip(key: "hasphoto", label: "Has a photo", systemImage: "photo"),
                Chip(key: "todo", label: "Has an open to-do", systemImage: "checklist"),
                Chip(key: "unaudited", label: "Never audited", systemImage: "magnifyingglass")
            ])
        ]
    }

    static func matches(_ group: FilterGroup, _ key: String, _ i: Instruction, _ c: FilterContext) -> Bool {
        switch group {
        case .person:
            if key == "none" { return i.owner.trimmingCharacters(in: .whitespaces).isEmpty }
            guard let person = c.people.first(where: { $0.uid == key }) else { return false }
            // An owner can be a person id or a bare name — match either, or the
            // same person would quietly miss half their work.
            if let id = i.ownerID { return id == key }
            return i.owner.trimmingCharacters(in: .whitespaces).lowercased() == person.name.lowercased()
        case .due:
            switch key {
            case "overdue":
                return Schedule.isDue(i, now: c.now)
            case "soon":
                guard let at = Schedule.nextDue(i) else { return false }
                return at > c.now && at <= c.now.addingTimeInterval(Double(Schedule.dueSoonDays) * Schedule.day)
            case "never": return Schedule.isNeverDone(i)
            case "noclock": return !Schedule.hasClock(i)
            default: return true
            }
        case .status:
            return i.status == key
        case .gaps:
            switch key {
            case "warning": return i.warnings.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            case "photo": return !c.withPhotos.contains(i.uid)
            case "steps": return i.steps.count < 2
            default: return true
            }
        case .marks:
            switch key {
            case "favourite": return i.isFavorite
            case "hasphoto": return c.withPhotos.contains(i.uid)
            case "todo": return c.openTodos.contains(i.uid)
            case "unaudited": return !c.audited.contains(i.uid)
            default: return true
            }
        }
    }
}

struct FilterPanel: View {
    @Binding var filters: FilterState
    let instructions: [Instruction]
    let context: FilterContext
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(FilterRules.sections(people: context.people)) { section in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(section.title).font(.headline)
                            FlowLayout(spacing: 8) {
                                ForEach(section.chips) { chip in
                                    chipButton(section.group, chip)
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Clear") { filters = FilterState() }
                        .disabled(!filters.isActive)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // Counts are against the whole library, not the other filters: they answer
    // "how much of this is there?", which doesn't shift under your finger.
    private func chipButton(_ group: FilterGroup, _ chip: FilterRules.Chip) -> some View {
        let count = instructions.filter { FilterRules.matches(group, chip.key, $0, context) }.count
        let on = filters.isOn(group, chip.key)
        return Button {
            filters.toggle(group, chip.key)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: chip.systemImage)
                Text(chip.label)
                Text("\(count)")
                    .font(.caption.monospacedDigit().weight(.bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(.quaternary, in: Capsule())
            }
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary), in: Capsule())
            .foregroundStyle(on ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
        }
        .buttonStyle(.plain)
        // A chip nothing matches is shown greyed rather than hidden: "0 overdue"
        // is worth knowing. One already on stays tappable, to switch it off.
        .disabled(count == 0 && !on)
        .opacity(count == 0 && !on ? 0.4 : 1)
    }
}

/// Lays chips out left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: min(widest, width), height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += lineHeight + spacing
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
