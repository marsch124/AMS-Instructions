import Foundation
import Observation

// State that belongs to this device, not to the library: where you are in a job,
// how you like the list sorted, who you were last time. Like localStorage in the
// web app, none of it syncs through iCloud and none of it goes into a backup —
// your half-ticked checklist is not something to carry to another phone.
@Observable
final class LocalState {
    private let defaults: UserDefaults

    private enum Key {
        static let stepProgress = "stepProgress"
        static let lastDoneBy = "lastDoneBy"
        static let lastRevisedBy = "lastRevisedBy"
        static let sort = "instructionSort"
        static let openGroups = "openInstructionGroups"
        static let lastExport = "lastExportTime"
        static let currentRun = "currentRun"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        stepProgress = (try? JSONDecoder().decode([String: StepProgress].self,
                                                  from: defaults.data(forKey: Key.stepProgress) ?? Data())) ?? [:]
        lastDoneByID = defaults.string(forKey: Key.lastDoneBy)
        lastRevisedByID = defaults.string(forKey: Key.lastRevisedBy)
        sort = SortOrder(rawValue: defaults.string(forKey: Key.sort) ?? "") ?? .number
        openGroups = Set(defaults.stringArray(forKey: Key.openGroups) ?? [])
        let export = defaults.double(forKey: Key.lastExport)
        lastExport = export > 0 ? Date(timeIntervalSince1970: export) : nil
        currentRun = (try? JSONDecoder().decode(Run.self, from: defaults.data(forKey: Key.currentRun) ?? Data()))
    }

    // MARK: Step ticks

    struct StepProgress: Codable {
        /// How many steps the instruction had when these were ticked. Ticks are
        /// positions, so if the steps were rewritten since, they are dropped
        /// rather than left pointing at the wrong lines.
        var count: Int
        var ticked: [Int]
    }

    private var stepProgress: [String: StepProgress] = [:] {
        didSet { defaults.set(try? JSONEncoder().encode(stepProgress), forKey: Key.stepProgress) }
    }

    func tickedSteps(for instruction: Instruction) -> Set<Int> {
        guard let entry = stepProgress[instruction.uid], entry.count == instruction.steps.count else { return [] }
        return Set(entry.ticked)
    }

    func setTicked(_ ticked: Set<Int>, for instruction: Instruction) {
        if ticked.isEmpty {
            stepProgress[instruction.uid] = nil
        } else {
            stepProgress[instruction.uid] = StepProgress(count: instruction.steps.count, ticked: ticked.sorted())
        }
    }

    // MARK: People remembered between uses

    var lastDoneByID: String? = nil {
        didSet { defaults.set(lastDoneByID, forKey: Key.lastDoneBy) }
    }

    var lastRevisedByID: String? = nil {
        didSet { defaults.set(lastRevisedByID, forKey: Key.lastRevisedBy) }
    }

    // MARK: Instructions list

    /// Remembered between visits: a sort hides nothing, unlike a filter.
    var sort: SortOrder = .number {
        didSet { defaults.set(sort.rawValue, forKey: Key.sort) }
    }

    var openGroups: Set<String> = [] {
        didSet { defaults.set(Array(openGroups), forKey: Key.openGroups) }
    }

    // MARK: Backups

    var lastExport: Date? = nil {
        didSet { defaults.set(lastExport?.timeIntervalSince1970 ?? 0, forKey: Key.lastExport) }
    }

    // MARK: Run a Set

    struct Run: Codable, Equatable {
        var id: String
        var name: String
        var numbers: [String]
        var ticked: [String]
    }

    /// One run at a time. It survives the app being closed, but like the step
    /// ticks it is where you are right now, not data worth backing up.
    var currentRun: Run? = nil {
        didSet {
            if let currentRun {
                defaults.set(try? JSONEncoder().encode(currentRun), forKey: Key.currentRun)
            } else {
                defaults.removeObject(forKey: Key.currentRun)
            }
        }
    }
}
