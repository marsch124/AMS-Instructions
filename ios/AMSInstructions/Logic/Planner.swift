import Foundation

/// Where you are when planning: decides which instructions are offered.
enum PlanPlace: String, CaseIterable, Identifiable {
    case rv, home, anywhere

    var id: String { rawValue }

    var label: String {
        switch self {
        case .rv: return "In the RV"
        case .home: return "At Home"
        case .anywhere: return "Anywhere"
        }
    }

    var short: String {
        switch self {
        case .rv: return "RV"
        case .home: return "Home"
        case .anywhere: return "Anywhere"
        }
    }

    /// The categories that belong here, from the RV and Life groups; anywhere
    /// means every category, sports included.
    var categories: [String] {
        switch self {
        case .rv: return Categories.groups.first { $0.name == "RV" }?.categories ?? []
        case .home: return Categories.groups.first { $0.name == "Life" }?.categories ?? []
        case .anywhere: return Categories.order
        }
    }

    func contains(_ category: String) -> Bool {
        let category = category.isEmpty ? "General" : category
        return self == .anywhere || categories.contains(category)
    }
}

/// Filling a stretch of free time with jobs, most pressing first.
enum Planner {
    static let budgets = [15, 30, 45, 60, 90, 120]
    /// Used for a job without a time estimate.
    static let assumedMinutes = 10

    static func minutes(for instruction: Instruction) -> Int {
        instruction.timeEstimate > 0 ? instruction.timeEstimate : assumedMinutes
    }

    static func isEstimated(_ instruction: Instruction) -> Bool {
        instruction.timeEstimate <= 0
    }

    static func total(_ instructions: [Instruction]) -> Int {
        instructions.reduce(0) { $0 + minutes(for: $1) }
    }

    /// Everything that could go into a plan here, most pressing first:
    /// overdue (longest overdue first), then due within a week, then the ones
    /// not done for the longest time — never done before any done.
    static func candidates(_ instructions: [Instruction], place: PlanPlace, kinds: Set<String>,
                           now: Date = Date()) -> [Instruction] {
        let soon = now.addingTimeInterval(Double(Schedule.dueSoonDays) * Schedule.day)
        let pool = instructions.filter { instruction in
            !instruction.isArchived
                && !instruction.steps.isEmpty
                && place.contains(instruction.category)
                && (kinds.isEmpty || kinds.contains(instruction.category.isEmpty ? "General" : instruction.category))
        }
        func tier(_ instruction: Instruction) -> Int {
            guard let due = Schedule.nextDue(instruction) else { return 2 }
            if due <= now { return 0 }
            return due <= soon ? 1 : 2
        }
        return pool.sorted { a, b in
            let ta = tier(a), tb = tier(b)
            if ta != tb { return ta < tb }
            if ta < 2 {
                return (Schedule.nextDue(a) ?? now) < (Schedule.nextDue(b) ?? now)
            }
            switch (a.lastCompleted, b.lastCompleted) {
            case (nil, nil): return a.number < b.number
            case (nil, _): return true
            case (_, nil): return false
            case let (x?, y?): return x < y
            }
        }
    }

    struct Suggestion {
        var plan: [Instruction]
        var alsoFits: [Instruction]
        var rest: [Instruction]
    }

    /// Takes jobs in order of priority while they still fit the time.
    static func suggest(budget: Int, from candidates: [Instruction]) -> Suggestion {
        var plan: [Instruction] = []
        var left = budget
        for instruction in candidates where minutes(for: instruction) <= left {
            plan.append(instruction)
            left -= minutes(for: instruction)
        }
        let chosen = Set(plan.map(\.uid))
        let others = candidates.filter { !chosen.contains($0.uid) }
        return split(others, left: left, plan: plan)
    }

    /// The jobs not in the plan, as those that fit the time left and the rest.
    static func split(_ others: [Instruction], left: Int, plan: [Instruction]) -> Suggestion {
        Suggestion(plan: plan,
                   alsoFits: others.filter { minutes(for: $0) <= left },
                   rest: others.filter { minutes(for: $0) > left })
    }
}
