import Foundation

// Search, sort and the plain-text form of an instruction.
enum Search {
    // Number, title and category are searched too, but are left out of this
    // list: they are printed on the row, so "matched in Title" would only
    // state the obvious.
    private static let fields: [(label: String, text: (Instruction) -> String)] = [
        ("Description", { $0.summary }),
        ("Steps", { $0.steps.joined(separator: "\n") }),
        ("Warnings", { $0.warnings }),
        ("Equipment", { $0.equipment }),
        ("Preparations", { $0.preparations }),
        ("After use", { $0.afterUse }),
        ("Maintenance", { $0.maintenance }),
        ("Notes", { $0.notes }),
        ("Tags", { $0.tags.joined(separator: "\n") }),
        ("Location", { $0.location }),
        ("Location", { $0.locationDetail }),
        ("Owner", { $0.owner })
    ]

    struct Match {
        let matched: Bool
        let fields: [String]
    }

    static func match(_ instruction: Instruction, term: String) -> Match {
        let term = term.lowercased()
        let onRow = [instruction.title, instruction.number, instruction.category]
            .contains { $0.lowercased().contains(term) }

        var found: [String] = []
        for field in fields where field.text(instruction).lowercased().contains(term) {
            if !found.contains(field.label) { found.append(field.label) }
        }
        return Match(matched: onRow || !found.isEmpty, fields: found)
    }
}

enum SortOrder: String, CaseIterable, Identifiable {
    case number, title, due, changed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .number: return "Number"
        case .title: return "Title A–Z"
        case .due: return "Most overdue first"
        case .changed: return "Recently changed"
        }
    }

    var short: String {
        switch self {
        case .number: return "Number"
        case .title: return "Title"
        case .due: return "Overdue"
        case .changed: return "Changed"
        }
    }

    var blurb: String {
        switch self {
        case .number: return "The order on your printed cards."
        case .title: return "When you remember the words, not the digits."
        case .due: return "Anything that cannot fall due sits at the bottom."
        case .changed: return "What you have been working on lately."
        }
    }

    func sorted(_ items: [Instruction]) -> [Instruction] {
        items.sorted(by: areInIncreasingOrder)
    }

    private func areInIncreasingOrder(_ a: Instruction, _ b: Instruction) -> Bool {
        switch self {
        case .number:
            return a.number < b.number
        case .title:
            let order = a.title.localizedCaseInsensitiveCompare(b.title)
            return order == .orderedSame ? a.number < b.number : order == .orderedAscending
        case .due:
            // Never-due instructions sort last: "no repeat" above a month-overdue
            // job would make the order actively misleading.
            switch (Schedule.nextDue(a), Schedule.nextDue(b)) {
            case (nil, nil): return a.number < b.number
            case (nil, _): return false
            case (_, nil): return true
            case let (x?, y?): return x == y ? a.number < b.number : x < y
            }
        case .changed:
            let x = SortOrder.lastChanged(a), y = SortOrder.lastChanged(b)
            return x == y ? a.number < b.number : x > y
        }
    }

    /// Marking Done and adding an audit write no revision, so neither counts.
    static func lastChanged(_ instruction: Instruction) -> Date {
        instruction.revisions.last?.timestamp ?? instruction.createdAt
    }
}

enum InstructionText {
    /// The instruction as plain text for sending in a message. Owner, audits
    /// and revision numbers matter inside the app and mean nothing outside it.
    static func make(_ instruction: Instruction) -> String {
        var lines = ["\(instruction.number) — \(instruction.title)"]

        let meta = [
            instruction.category,
            instruction.frequency,
            instruction.timeEstimate > 0 ? "\(instruction.timeEstimate) min" : ""
        ].filter { !$0.isEmpty }
        if !meta.isEmpty { lines.append(meta.joined(separator: " · ")) }

        func section(_ label: String, _ value: String) {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            lines.append("")
            lines.append(label + trimmed)
        }

        section("", instruction.summary)
        // The warning goes above the steps: it has to be read before starting.
        section("⚠️ ", instruction.warnings)
        section("Equipment: ", instruction.equipment)
        section("Before you start: ", instruction.preparations)

        if !instruction.steps.isEmpty {
            lines.append("")
            for (index, step) in instruction.steps.enumerated() {
                lines.append("\(index + 1). \(step)")
            }
        }

        section("Afterwards: ", instruction.afterUse)
        section("Notes: ", instruction.notes)

        lines.append("")
        lines.append("Sent from AMS Instructions")
        return lines.joined(separator: "\n")
    }
}
