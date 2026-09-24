import Foundation
import SwiftData

// Photos live in their own records rather than inside the instruction. A
// CloudKit record tops out at 1 MB, and five photos on one instruction would
// blow straight through that; external storage turns each image into a
// CloudKit asset instead.
@Model
final class InstructionPhoto {
    var uid: String = UUID().uuidString
    var instructionUID: String = ""
    var name: String = ""
    @Attribute(.externalStorage) var imageData: Data?
    @Attribute(.externalStorage) var thumbData: Data?
    var width: Int = 0
    var height: Int = 0
    var originalSize: Int = 0
    /// The step this photo sits under, or nil for the gallery.
    var step: Int?
    var sortIndex: Int = 0
    var addedAt: Date = Date()

    init(instructionUID: String) {
        self.instructionUID = instructionUID
    }
}

@Model
final class Person {
    var uid: String = "person_" + UUID().uuidString
    var name: String = ""
    var phone: String = ""
    var email: String = ""
    var handlesData: Data?
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    init(name: String) {
        self.name = name
    }

    var handles: [PersonHandle] {
        get { JSONField.decode(handlesData) ?? [] }
        set { handlesData = JSONField.encode(newValue) }
    }
}

struct PersonHandle: Codable, Hashable {
    var label: String
    var value: String
}

@Model
final class Audit {
    var uid: String = "audit_" + UUID().uuidString
    var instructionUID: String = ""
    var instructionNumber: String = ""
    var auditorID: String?
    var auditorName: String = ""
    var timestamp: Date = Date()
    var findings: String = ""
    var convertedToActionID: String?
    var createdAt: Date = Date()

    init(instructionUID: String) {
        self.instructionUID = instructionUID
    }
}

@Model
final class ActionItem {
    var uid: String = "action_" + UUID().uuidString
    var title: String = ""
    var notes: String = ""
    /// "normal" or "high", as in the web app.
    var priority: String = "normal"
    /// A calendar day, stored as "yyyy-MM-dd" exactly as the web app kept it,
    /// so a due date never shifts by a day when it crosses a time zone.
    var dueDate: String?
    /// "open" or "done".
    var status: String = "open"
    var instructionUID: String?
    var instructionNumber: String?
    var sourceAuditID: String?
    var createdAt: Date = Date()
    var completedAt: Date?

    init(title: String) {
        self.title = title
    }

    var isDone: Bool { status == "done" }
    var isHighPriority: Bool { priority == "high" }
}

enum AppSchema {
    static let models: [any PersistentModel.Type] = [
        Instruction.self, InstructionPhoto.self, Person.self, Audit.self, ActionItem.self
    ]
}
