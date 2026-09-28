import Foundation

// When things fall due. Same rules as the web app (db.js):
//
// Only frequencies that describe a clock appear here. "Before each trip",
// "Every session" and "As-needed" are triggered by an event, not by a date,
// so they can never fall due.
//
// An instruction that has never been marked Done has no clock to start from,
// so it is NOT due — otherwise the 205-instruction starter library would show
// a hundred red items on day one.
enum Schedule {
    static let frequencyDays: [String: Int] = [
        "Daily": 1,
        "Weekly": 7,
        "Monthly": 30,
        "Seasonally": 91,
        "Yearly": 365
    ]

    static let frequencies = [
        "Daily", "Weekly", "Monthly", "Seasonally", "Yearly",
        "Before each trip", "Every session", "As-needed"
    ]

    static let dueSoonDays = 7
    static let day: TimeInterval = 24 * 60 * 60

    static func hasClock(_ instruction: Instruction) -> Bool {
        frequencyDays[instruction.frequency] != nil
    }

    static func nextDue(_ instruction: Instruction) -> Date? {
        guard let last = instruction.lastCompleted, !instruction.isArchived,
              let days = frequencyDays[instruction.frequency] else { return nil }
        return last.addingTimeInterval(Double(days) * day)
    }

    static func isDue(_ instruction: Instruction, now: Date = Date()) -> Bool {
        guard let due = nextDue(instruction) else { return false }
        return due <= now
    }

    static func isNeverDone(_ instruction: Instruction) -> Bool {
        hasClock(instruction) && instruction.lastCompleted == nil && !instruction.isArchived
    }

    /// Everything that has fallen due, most overdue first.
    static func dueList(_ instructions: [Instruction], now: Date = Date()) -> [(instruction: Instruction, dueAt: Date)] {
        instructions
            .compactMap { i in nextDue(i).map { (instruction: i, dueAt: $0) } }
            .filter { $0.dueAt <= now }
            .sorted { $0.dueAt < $1.dueAt }
    }

    /// How late something is, in whole days.
    static func overdueBy(_ dueAt: Date, now: Date = Date()) -> String {
        let days = Int(floor(now.timeIntervalSince(dueAt) / day))
        if days <= 0 { return "due today" }
        if days == 1 { return "1 day late" }
        if days < 60 { return "\(days) days late" }
        return "\(Int((Double(days) / 30).rounded())) months late"
    }

    static func dueIn(_ dueAt: Date, now: Date = Date()) -> String {
        let days = Int(ceil(dueAt.timeIntervalSince(now) / day))
        if days <= 1 { return "Tomorrow" }
        if days < 60 { return "In \(days) days" }
        return "In \(Int((Double(days) / 30).rounded())) months"
    }

    /// The Next Due line. Where there is no date it says why.
    static func describeNextDue(_ instruction: Instruction, now: Date = Date()) -> String {
        if instruction.isArchived { return "Archived" }
        if !hasClock(instruction) { return "--" }
        guard let due = nextDue(instruction) else { return "After 1st Done" }
        return due <= now ? overdueBy(due, now: now) : dueIn(due, now: now)
    }
}

enum StatusRules {
    /// Draft without the core, Active when everything is filled in, otherwise
    /// Review Needed. Same test as calculateStatus() in the web app.
    static func calculated(title: String, summary: String, steps: [String], frequency: String,
                           timeEstimate: Int, owner: String, warnings: String) -> InstructionStatus {
        let hasCore = !title.isEmpty && !summary.isEmpty && !steps.isEmpty
        let hasDetails = !frequency.isEmpty && timeEstimate > 0 && !owner.isEmpty
        let hasSafety = !warnings.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if !hasCore { return .draft }
        return hasDetails && hasSafety ? .active : .reviewNeeded
    }
}

enum Numbers {
    /// "7" → "007". Anything that is not a number is returned trimmed.
    static func normalize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if trimmed.count < 3 {
            return String(repeating: "0", count: 3 - trimmed.count) + trimmed
        }
        return trimmed
    }

    /// One past the highest number in use: "042" when 041 is the highest.
    static func next(after used: [String]) -> String {
        normalize(String((used.compactMap { Int($0) }.max() ?? 0) + 1))
    }
}
