import Foundation

// The backup file, exactly as the web app wrote it: `version`, an ISO
// `timestamp`, and five lists. Dates inside are milliseconds since 1970.
//
// Decoding is deliberately forgiving. Backups were written by many versions of
// the web app, so a field can be missing, null, or a number where a string was
// expected. A backup that restores with one odd field blanked is far better
// than one that refuses to restore at all.
struct BackupFile: Codable {
    var version: Int = 1
    var timestamp: String?
    var instructions: [InstructionDTO] = []
    var favorites: [String] = []
    var people: [PersonDTO] = []
    var audits: [AuditDTO] = []
    var actions: [ActionDTO] = []

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.int(.version) ?? 1
        timestamp = c.string(.timestamp)
        instructions = c.list(.instructions)
        favorites = (try? c.decodeIfPresent([LenientString].self, forKey: .favorites))?.compactMap(\.value) ?? []
        people = c.list(.people)
        audits = c.list(.audits)
        actions = c.list(.actions)
    }
}

struct InstructionDTO: Codable {
    var id: String?
    var number: String?
    var title: String?
    var category: String?
    var `where`: String?
    var whereDetailed: String?
    var description: String?
    var owner: String?
    var ownerId: String?
    var status: String?
    var frequency: String?
    var timeEstimate: Int?
    var difficulty: Int?
    var tags: [String]?
    var warnings: String?
    var equipment: String?
    var preparations: String?
    var steps: [String]?
    var afterUse: String?
    var maintenance: String?
    var notes: String?
    var photos: [PhotoDTO]?
    var links: [LinkDTO]?
    var related: [String]?
    var completionCount: Int?
    var lastCompleted: Double?
    var completionLog: [CompletionDTO]?
    var createdAt: Double?
    var revisionHistory: [RevisionDTO]?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        number = c.string(.number)
        title = c.string(.title)
        category = c.string(.category)
        `where` = c.string(.`where`)
        whereDetailed = c.string(.whereDetailed)
        description = c.string(.description)
        owner = c.string(.owner)
        ownerId = c.string(.ownerId)
        status = c.string(.status)
        frequency = c.string(.frequency)
        timeEstimate = c.int(.timeEstimate)
        difficulty = c.int(.difficulty)
        tags = c.strings(.tags)
        warnings = c.string(.warnings)
        equipment = c.string(.equipment)
        preparations = c.string(.preparations)
        steps = c.strings(.steps)
        afterUse = c.string(.afterUse)
        maintenance = c.string(.maintenance)
        notes = c.string(.notes)
        photos = c.optionalList(.photos)
        links = c.optionalList(.links)
        related = c.strings(.related)
        completionCount = c.int(.completionCount)
        lastCompleted = c.double(.lastCompleted)
        completionLog = c.optionalList(.completionLog)
        createdAt = c.double(.createdAt)
        revisionHistory = c.optionalList(.revisionHistory)
    }
}

struct PhotoDTO: Codable {
    var name: String?
    var data: String?
    var thumb: String?
    var width: Int?
    var height: Int?
    var originalSize: Int?
    var addedAt: Double?
    var step: Int?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        data = c.string(.data)
        thumb = c.string(.thumb)
        width = c.int(.width)
        height = c.int(.height)
        originalSize = c.int(.originalSize)
        addedAt = c.double(.addedAt)
        step = c.int(.step)
    }
}

struct LinkDTO: Codable {
    var title: String?
    var url: String?

    init(title: String?, url: String?) {
        self.title = title
        self.url = url
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.string(.title)
        url = c.string(.url)
    }
}

struct RevisionDTO: Codable {
    var version: Int?
    var timestamp: Double?
    var authorId: String?
    var authorName: String?
    var author: String?
    var changes: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.int(.version)
        timestamp = c.double(.timestamp)
        authorId = c.string(.authorId)
        authorName = c.string(.authorName)
        author = c.string(.author)
        changes = c.string(.changes)
    }
}

struct CompletionDTO: Codable {
    var at: Double?
    var byId: String?
    var byName: String?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = c.double(.at)
        byId = c.string(.byId)
        byName = c.string(.byName)
    }
}

struct PersonDTO: Codable {
    var id: String?
    var name: String?
    var phone: String?
    var email: String?
    var handles: [HandleDTO]?
    var createdAt: Double?
    var updatedAt: Double?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name)
        phone = c.string(.phone)
        email = c.string(.email)
        handles = c.optionalList(.handles)
        createdAt = c.double(.createdAt)
        updatedAt = c.double(.updatedAt)
    }
}

struct HandleDTO: Codable {
    var label: String?
    var value: String?

    init(label: String?, value: String?) {
        self.label = label
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.string(.label)
        value = c.string(.value)
    }
}

struct AuditDTO: Codable {
    var id: String?
    var instructionId: String?
    var instructionNumber: String?
    var auditorId: String?
    var auditorName: String?
    var timestamp: Double?
    var findings: String?
    var convertedToActionId: String?
    var createdAt: Double?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        instructionId = c.string(.instructionId)
        instructionNumber = c.string(.instructionNumber)
        auditorId = c.string(.auditorId)
        auditorName = c.string(.auditorName)
        timestamp = c.double(.timestamp)
        findings = c.string(.findings)
        convertedToActionId = c.string(.convertedToActionId)
        createdAt = c.double(.createdAt)
    }
}

struct ActionDTO: Codable {
    var id: String?
    var title: String?
    var notes: String?
    var priority: String?
    var dueDate: String?
    var status: String?
    var instructionId: String?
    var instructionNumber: String?
    var sourceAuditId: String?
    var createdAt: Double?
    var completedAt: Double?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        title = c.string(.title)
        notes = c.string(.notes)
        priority = c.string(.priority)
        dueDate = c.string(.dueDate)
        status = c.string(.status)
        instructionId = c.string(.instructionId)
        instructionNumber = c.string(.instructionNumber)
        sourceAuditId = c.string(.sourceAuditId)
        createdAt = c.double(.createdAt)
        completedAt = c.double(.completedAt)
    }
}

// MARK: - Forgiving decoding

/// A string that also accepts a number in its place ("7" or 7).
struct LenientString: Decodable {
    let value: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            value = s
        } else if let i = try? c.decode(Int.self) {
            value = String(i)
        } else if let d = try? c.decode(Double.self) {
            value = String(d)
        } else {
            value = nil
        }
    }
}

/// An element of a list that is skipped, rather than failing the whole list,
/// when it cannot be read.
private struct Skippable<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

extension KeyedDecodingContainer {
    func string(_ key: Key) -> String? {
        (try? decodeIfPresent(LenientString.self, forKey: key))?.value
    }

    func int(_ key: Key) -> Int? {
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return i }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return Int(d) }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Int(s.trimmingCharacters(in: .whitespaces)) }
        return nil
    }

    func double(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: key) {
            if let d = Double(s) { return d }
            // An ISO date where a timestamp was expected.
            if let date = ISO8601DateFormatter.backup.date(from: s) ?? ISO8601DateFormatter().date(from: s) {
                return date.timeIntervalSince1970 * 1000
            }
        }
        return nil
    }

    func strings(_ key: Key) -> [String]? {
        guard let items = try? decodeIfPresent([LenientString].self, forKey: key) else { return nil }
        return items.compactMap(\.value)
    }

    func list<T: Decodable>(_ key: Key) -> [T] {
        guard let items = try? decodeIfPresent([Skippable<T>].self, forKey: key) else { return [] }
        return items.compactMap(\.value)
    }

    func optionalList<T: Decodable>(_ key: Key) -> [T]? {
        guard let items = try? decodeIfPresent([Skippable<T>].self, forKey: key) else { return nil }
        return items.compactMap(\.value)
    }
}

extension ISO8601DateFormatter {
    /// The web app's `new Date().toISOString()` shape: 2026-08-16T12:00:00.000Z
    static let backup: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

extension Date {
    init(milliseconds: Double) {
        self.init(timeIntervalSince1970: milliseconds / 1000)
    }

    var milliseconds: Double {
        (timeIntervalSince1970 * 1000).rounded()
    }
}
