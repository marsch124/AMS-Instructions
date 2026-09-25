import Foundation
import SwiftData

// One instruction — the same record the web app kept in IndexedDB.
//
// Every stored property has a default and nothing is marked unique: both are
// rules CloudKit sync sets for SwiftData. Uniqueness of `number` is therefore
// enforced by the app (see Library.instruction(number:)), not the database.
//
// Small nested lists (links, revision history, the done log) are kept as JSON
// in a Data field rather than as arrays of structs. SwiftData's handling of
// arrays of Codable structs has been unreliable across iOS 17 releases, and
// JSON is exactly the shape they arrive in from a backup anyway.
@Model
final class Instruction {
    /// The web app's `id` (e.g. "instr_lib_100"). Kept so a backup restored
    /// twice updates the same instruction instead of adding a copy.
    var uid: String = ""
    var number: String = ""
    var title: String = ""
    var category: String = "General"
    var location: String = ""          // "where" in the web app
    var locationDetail: String = ""    // "whereDetailed"
    var summary: String = ""           // "description"
    var owner: String = ""
    var ownerID: String?
    var status: String = InstructionStatus.draft.rawValue
    var frequency: String = ""
    var timeEstimate: Int = 0
    var difficulty: Int = 0
    var tags: [String] = []
    var warnings: String = ""
    var equipment: String = ""
    var preparations: String = ""
    var steps: [String] = []
    var afterUse: String = ""
    var maintenance: String = ""
    var notes: String = ""
    var related: [String] = []
    var completionCount: Int = 0
    var lastCompleted: Date?
    var createdAt: Date = Date()
    var isFavorite: Bool = false
    var lastViewedAt: Date?

    var linksData: Data?
    var revisionsData: Data?
    var completionLogData: Data?

    init(uid: String = "instr_" + String(Int(Date().timeIntervalSince1970 * 1000)),
         number: String = "",
         title: String = "") {
        self.uid = uid
        self.number = number
        self.title = title
    }

    var links: [InstructionLink] {
        get { JSONField.decode(linksData) ?? [] }
        set { linksData = JSONField.encode(newValue) }
    }

    var revisions: [Revision] {
        get { JSONField.decode(revisionsData) ?? [] }
        set { revisionsData = JSONField.encode(newValue) }
    }

    /// Newest first, so the head is "who did it last".
    var completionLog: [CompletionEntry] {
        get { JSONField.decode(completionLogData) ?? [] }
        set { completionLogData = JSONField.encode(newValue) }
    }

    var isArchived: Bool { status == InstructionStatus.archived.rawValue }
}

enum InstructionStatus: String, CaseIterable {
    case active = "Active"
    case draft = "Draft"
    case reviewNeeded = "Review Needed"
    case archived = "Archived"
}

struct InstructionLink: Codable, Hashable {
    var title: String
    var url: String
}

struct Revision: Codable, Hashable {
    var version: Int
    var timestamp: Date
    var authorID: String?
    var authorName: String
    var changes: String
}

struct CompletionEntry: Codable, Hashable {
    var at: Date
    var byID: String?
    var byName: String
}

enum JSONField {
    static func decode<T: Decodable>(_ data: Data?) -> T? {
        guard let data else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func encode<T: Encodable>(_ value: T) -> Data? {
        try? JSONEncoder().encode(value)
    }
}
