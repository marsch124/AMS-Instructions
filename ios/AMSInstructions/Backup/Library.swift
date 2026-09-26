import Foundation
import SwiftData
import UIKit

// Everything that reads or writes several records at once: look-ups by number,
// completions, restore and backup. Views call in here rather than each working
// out the rules for themselves.
enum Library {
    /// How many "who did it" entries an instruction keeps.
    static let doneLogLimit = 20

    // MARK: Look-ups

    static func instruction(number: String, in context: ModelContext) -> Instruction? {
        let wanted = Numbers.normalize(number)
        var descriptor = FetchDescriptor<Instruction>(predicate: #Predicate { $0.number == wanted })
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    static func instruction(uid: String, in context: ModelContext) -> Instruction? {
        var descriptor = FetchDescriptor<Instruction>(predicate: #Predicate { $0.uid == uid })
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    static func photos(for instructionUID: String, in context: ModelContext) -> [InstructionPhoto] {
        let descriptor = FetchDescriptor<InstructionPhoto>(
            predicate: #Predicate { $0.instructionUID == instructionUID },
            sortBy: [SortDescriptor(\.sortIndex)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    static func all<T: PersistentModel>(_ type: T.Type, in context: ModelContext) -> [T] {
        (try? context.fetch(FetchDescriptor<T>())) ?? []
    }

    // MARK: Done

    /// A completion. Deliberately no revision entry: marking something done is
    /// not an edit. `person` is optional — the date is worth having on its own.
    static func recordCompletion(_ instruction: Instruction, by person: Person?) {
        let now = Date()
        instruction.completionCount += 1
        instruction.lastCompleted = now
        let entry = CompletionEntry(at: now, byID: person?.uid, byName: person?.name ?? "")
        instruction.completionLog = Array(([entry] + instruction.completionLog).prefix(doneLogLimit))
    }

    /// The "actually, that was Anna" correction. Changes only the name on the
    /// most recent completion; the count does not move.
    static func amendLastCompletion(_ instruction: Instruction, to person: Person?) {
        var log = instruction.completionLog
        guard !log.isEmpty else { return }
        log[0] = CompletionEntry(at: log[0].at, byID: person?.uid, byName: person?.name ?? "")
        instruction.completionLog = log
    }

    // MARK: Restore

    struct RestoreResult {
        var instructions = 0
        var people = 0
        var audits = 0
        var actions = 0
    }

    /// Puts a backup into the library. Anything with the same identity — or, for
    /// an instruction, the same number — is replaced by the backup's version.
    /// Nothing else is deleted.
    @discardableResult
    static func restore(_ backup: BackupFile, into context: ModelContext) throws -> RestoreResult {
        var result = RestoreResult()

        var byUID: [String: Instruction] = [:]
        var byNumber: [String: Instruction] = [:]
        for existing in all(Instruction.self, in: context) {
            byUID[existing.uid] = existing
            byNumber[existing.number] = existing
        }

        for dto in backup.instructions {
            guard let rawNumber = dto.number, !rawNumber.isEmpty else { continue }
            let number = Numbers.normalize(rawNumber)
            let uid = dto.id ?? "instr_\(UUID().uuidString)"

            // Two instructions may not share a number: whatever holds this number
            // now makes way for the backup's version.
            if let clash = byNumber[number], clash.uid != uid {
                deletePhotos(of: clash.uid, in: context)
                deleteRecognition(of: clash.uid, in: context)
                byUID[clash.uid] = nil
                context.delete(clash)
            }

            let instruction: Instruction
            if let existing = byUID[uid] {
                instruction = existing
            } else {
                instruction = Instruction(uid: uid)
                context.insert(instruction)
            }
            apply(dto, number: number, to: instruction)
            byUID[uid] = instruction
            byNumber[number] = instruction

            deletePhotos(of: uid, in: context)
            for (index, photoDTO) in (dto.photos ?? []).enumerated() {
                if let photo = makePhoto(photoDTO, instructionUID: uid, index: index) {
                    context.insert(photo)
                }
            }
            result.instructions += 1
        }

        let favourites = Set(backup.favorites)
        if !favourites.isEmpty {
            for instruction in byUID.values where favourites.contains(instruction.uid) {
                instruction.isFavorite = true
            }
        }

        let people = Dictionary(all(Person.self, in: context).map { ($0.uid, $0) }, uniquingKeysWith: { a, _ in a })
        for dto in backup.people {
            guard let name = dto.name?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { continue }
            let uid = dto.id ?? "person_\(UUID().uuidString)"
            let person = people[uid] ?? {
                let created = Person(name: name)
                created.uid = uid
                context.insert(created)
                return created
            }()
            person.name = name
            person.phone = dto.phone ?? ""
            person.email = dto.email ?? ""
            person.handles = (dto.handles ?? []).map { PersonHandle(label: $0.label ?? "", value: $0.value ?? "") }
            person.createdAt = dto.createdAt.map(Date.init(milliseconds:)) ?? person.createdAt
            person.updatedAt = dto.updatedAt.map(Date.init(milliseconds:)) ?? person.updatedAt
            result.people += 1
        }

        let audits = Dictionary(all(Audit.self, in: context).map { ($0.uid, $0) }, uniquingKeysWith: { a, _ in a })
        for dto in backup.audits {
            let uid = dto.id ?? "audit_\(UUID().uuidString)"
            let audit = audits[uid] ?? {
                let created = Audit(instructionUID: dto.instructionId ?? "")
                created.uid = uid
                context.insert(created)
                return created
            }()
            audit.instructionUID = dto.instructionId ?? ""
            audit.instructionNumber = dto.instructionNumber ?? ""
            audit.auditorID = dto.auditorId
            audit.auditorName = dto.auditorName ?? ""
            audit.timestamp = dto.timestamp.map(Date.init(milliseconds:)) ?? Date()
            audit.findings = dto.findings ?? ""
            audit.convertedToActionID = dto.convertedToActionId
            audit.createdAt = dto.createdAt.map(Date.init(milliseconds:)) ?? audit.timestamp
            result.audits += 1
        }

        let actions = Dictionary(all(ActionItem.self, in: context).map { ($0.uid, $0) }, uniquingKeysWith: { a, _ in a })
        for dto in backup.actions {
            let uid = dto.id ?? "action_\(UUID().uuidString)"
            let action = actions[uid] ?? {
                let created = ActionItem(title: dto.title ?? "")
                created.uid = uid
                context.insert(created)
                return created
            }()
            action.title = dto.title ?? ""
            action.notes = dto.notes ?? ""
            action.priority = dto.priority == "high" ? "high" : "normal"
            action.dueDate = (dto.dueDate?.isEmpty ?? true) ? nil : dto.dueDate
            action.status = dto.status == "done" ? "done" : "open"
            action.instructionUID = dto.instructionId
            action.instructionNumber = dto.instructionNumber
            action.sourceAuditID = dto.sourceAuditId
            action.createdAt = dto.createdAt.map(Date.init(milliseconds:)) ?? Date()
            action.completedAt = dto.completedAt.map(Date.init(milliseconds:))
            result.actions += 1
        }

        let prints = Dictionary(all(RecognitionPrint.self, in: context).map { ($0.uid, $0) }, uniquingKeysWith: { a, _ in a })
        for dto in backup.recognition {
            guard let instructionUID = dto.instructionId,
                  let printData = dto.print.flatMap({ Data(base64Encoded: $0) }) else { continue }
            let uid = dto.id ?? "print_\(UUID().uuidString)"
            let stored = prints[uid] ?? {
                let created = RecognitionPrint(instructionUID: instructionUID)
                created.uid = uid
                context.insert(created)
                return created
            }()
            stored.instructionUID = instructionUID
            stored.printData = printData
            stored.thumbData = DataURI.decode(dto.thumb)
            stored.addedAt = dto.addedAt.map(Date.init(milliseconds:)) ?? Date()
        }

        try context.save()
        return result
    }

    /// The library becomes exactly the backup: anything not in it is removed.
    /// Used by iCloud file sync, so a deletion on one device reaches the others.
    /// (Restoring a backup file by hand still only adds and replaces.)
    @discardableResult
    static func replaceAll(with backup: BackupFile, in context: ModelContext) throws -> RestoreResult {
        all(Instruction.self, in: context).forEach { context.delete($0) }
        all(InstructionPhoto.self, in: context).forEach { context.delete($0) }
        all(Person.self, in: context).forEach { context.delete($0) }
        all(Audit.self, in: context).forEach { context.delete($0) }
        all(ActionItem.self, in: context).forEach { context.delete($0) }
        all(RecognitionPrint.self, in: context).forEach { context.delete($0) }
        try context.save()
        return try restore(backup, into: context)
    }

    private static func apply(_ dto: InstructionDTO, number: String, to instruction: Instruction) {
        instruction.number = number
        instruction.title = dto.title ?? ""
        instruction.category = (dto.category?.isEmpty ?? true) ? "General" : dto.category!
        instruction.location = dto.`where` ?? ""
        instruction.locationDetail = dto.whereDetailed ?? ""
        instruction.summary = dto.description ?? ""
        instruction.owner = dto.owner ?? ""
        instruction.ownerID = (dto.ownerId?.isEmpty ?? true) ? nil : dto.ownerId
        instruction.frequency = dto.frequency ?? ""
        instruction.timeEstimate = dto.timeEstimate ?? 0
        instruction.difficulty = dto.difficulty ?? 0
        instruction.tags = dto.tags ?? []
        instruction.warnings = dto.warnings ?? ""
        instruction.equipment = dto.equipment ?? ""
        instruction.preparations = dto.preparations ?? ""
        instruction.steps = dto.steps ?? []
        instruction.afterUse = dto.afterUse ?? ""
        instruction.maintenance = dto.maintenance ?? ""
        instruction.notes = dto.notes ?? ""
        instruction.related = dto.related ?? []
        instruction.completionCount = dto.completionCount ?? 0
        instruction.lastCompleted = dto.lastCompleted.map(Date.init(milliseconds:))
        instruction.createdAt = dto.createdAt.map(Date.init(milliseconds:)) ?? Date()
        instruction.links = (dto.links ?? []).compactMap { link in
            guard let url = link.url, !url.isEmpty else { return nil }
            return InstructionLink(title: link.title ?? url, url: url)
        }
        instruction.revisions = (dto.revisionHistory ?? []).enumerated().map { index, rev in
            Revision(version: rev.version ?? index + 1,
                     timestamp: rev.timestamp.map(Date.init(milliseconds:)) ?? instruction.createdAt,
                     authorID: rev.authorId,
                     authorName: rev.authorName ?? rev.author ?? "Unknown",
                     changes: rev.changes ?? "")
        }
        instruction.completionLog = (dto.completionLog ?? []).compactMap { entry in
            guard let at = entry.at else { return nil }
            return CompletionEntry(at: Date(milliseconds: at), byID: entry.byId, byName: entry.byName ?? "")
        }

        let status = dto.status ?? ""
        if let known = InstructionStatus(rawValue: status) {
            instruction.status = known.rawValue
        } else {
            instruction.status = StatusRules.calculated(
                title: instruction.title, summary: instruction.summary, steps: instruction.steps,
                frequency: instruction.frequency, timeEstimate: instruction.timeEstimate,
                owner: instruction.owner, warnings: instruction.warnings
            ).rawValue
        }
    }

    static func deletePhotos(of instructionUID: String, in context: ModelContext) {
        for photo in photos(for: instructionUID, in: context) {
            context.delete(photo)
        }
    }

    /// The teaching photos of an instruction that is going away.
    static func deleteRecognition(of instructionUID: String, in context: ModelContext) {
        let descriptor = FetchDescriptor<RecognitionPrint>(predicate: #Predicate { $0.instructionUID == instructionUID })
        for print in (try? context.fetch(descriptor)) ?? [] {
            context.delete(print)
        }
    }

    private static func makePhoto(_ dto: PhotoDTO, instructionUID: String, index: Int) -> InstructionPhoto? {
        guard let image = DataURI.decode(dto.data) else { return nil }
        let photo = InstructionPhoto(instructionUID: instructionUID)
        photo.name = dto.name ?? "Photo \(index + 1)"
        photo.imageData = image
        photo.thumbData = DataURI.decode(dto.thumb) ?? PhotoProcessing.thumbnail(from: image)
        photo.width = dto.width ?? 0
        photo.height = dto.height ?? 0
        photo.originalSize = dto.originalSize ?? 0
        photo.step = dto.step
        photo.sortIndex = index
        photo.addedAt = dto.addedAt.map(Date.init(milliseconds:)) ?? Date()
        return photo
    }

    // MARK: Backup

    static func makeBackup(from context: ModelContext) -> BackupFile {
        var backup = BackupFile()
        backup.timestamp = ISO8601DateFormatter.backup.string(from: Date())

        let photosByInstruction = Dictionary(grouping: all(InstructionPhoto.self, in: context), by: \.instructionUID)

        let instructions = all(Instruction.self, in: context).sorted { $0.number < $1.number }
        backup.instructions = instructions.map { instruction in
            var dto = InstructionDTO()
            dto.id = instruction.uid
            dto.number = instruction.number
            dto.title = instruction.title
            dto.category = instruction.category
            dto.`where` = instruction.location
            dto.whereDetailed = instruction.locationDetail
            dto.description = instruction.summary
            dto.owner = instruction.owner
            dto.ownerId = instruction.ownerID
            dto.status = instruction.status
            dto.frequency = instruction.frequency
            dto.timeEstimate = instruction.timeEstimate
            dto.difficulty = instruction.difficulty
            dto.tags = instruction.tags
            dto.warnings = instruction.warnings
            dto.equipment = instruction.equipment
            dto.preparations = instruction.preparations
            dto.steps = instruction.steps
            dto.afterUse = instruction.afterUse
            dto.maintenance = instruction.maintenance
            dto.notes = instruction.notes
            dto.related = instruction.related
            dto.completionCount = instruction.completionCount
            dto.lastCompleted = instruction.lastCompleted?.milliseconds
            dto.createdAt = instruction.createdAt.milliseconds
            dto.links = instruction.links.map { LinkDTO(title: $0.title, url: $0.url) }
            dto.revisionHistory = instruction.revisions.map { rev in
                var out = RevisionDTO()
                out.version = rev.version
                out.timestamp = rev.timestamp.milliseconds
                out.authorId = rev.authorID
                out.authorName = rev.authorName
                out.changes = rev.changes
                return out
            }
            dto.completionLog = instruction.completionLog.map { entry in
                var out = CompletionDTO()
                out.at = entry.at.milliseconds
                out.byId = entry.byID
                out.byName = entry.byName
                return out
            }
            dto.photos = (photosByInstruction[instruction.uid] ?? [])
                .sorted { $0.sortIndex < $1.sortIndex }
                .compactMap { photo in
                    guard let data = photo.imageData else { return nil }
                    var out = PhotoDTO()
                    out.name = photo.name
                    out.data = DataURI.encode(data)
                    out.thumb = photo.thumbData.map(DataURI.encode)
                    out.width = photo.width
                    out.height = photo.height
                    out.originalSize = photo.originalSize
                    out.addedAt = photo.addedAt.milliseconds
                    out.step = photo.step
                    return out
                }
            return dto
        }

        backup.favorites = instructions.filter(\.isFavorite).map(\.uid)

        backup.people = all(Person.self, in: context).map { person in
            var dto = PersonDTO()
            dto.id = person.uid
            dto.name = person.name
            dto.phone = person.phone
            dto.email = person.email
            dto.handles = person.handles.map { HandleDTO(label: $0.label, value: $0.value) }
            dto.createdAt = person.createdAt.milliseconds
            dto.updatedAt = person.updatedAt.milliseconds
            return dto
        }

        backup.audits = all(Audit.self, in: context).map { audit in
            var dto = AuditDTO()
            dto.id = audit.uid
            dto.instructionId = audit.instructionUID
            dto.instructionNumber = audit.instructionNumber
            dto.auditorId = audit.auditorID
            dto.auditorName = audit.auditorName
            dto.timestamp = audit.timestamp.milliseconds
            dto.findings = audit.findings
            dto.convertedToActionId = audit.convertedToActionID
            dto.createdAt = audit.createdAt.milliseconds
            return dto
        }

        backup.actions = all(ActionItem.self, in: context).map { action in
            var dto = ActionDTO()
            dto.id = action.uid
            dto.title = action.title
            dto.notes = action.notes
            dto.priority = action.priority
            dto.dueDate = action.dueDate
            dto.status = action.status
            dto.instructionId = action.instructionUID
            dto.instructionNumber = action.instructionNumber
            dto.sourceAuditId = action.sourceAuditID
            dto.createdAt = action.createdAt.milliseconds
            dto.completedAt = action.completedAt?.milliseconds
            return dto
        }

        backup.recognition = all(RecognitionPrint.self, in: context).compactMap { stored in
            guard let data = stored.printData else { return nil }
            var dto = RecognitionDTO()
            dto.id = stored.uid
            dto.instructionId = stored.instructionUID
            dto.print = data.base64EncodedString()
            dto.thumb = stored.thumbData.map(DataURI.encode)
            dto.addedAt = stored.addedAt.milliseconds
            return dto
        }

        return backup
    }

    static func encode(_ backup: BackupFile) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        return try encoder.encode(backup)
    }

    static func decode(_ data: Data) throws -> BackupFile {
        try JSONDecoder().decode(BackupFile.self, from: data)
    }

    static func backupFileName(now: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd-HHmm"
        return "AMS-Instructions-backup-\(f.string(from: now)).json"
    }

    // MARK: Starter library

    static func starterLibrary() throws -> BackupFile {
        guard let url = Bundle.main.url(forResource: "starter-library", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try decode(Data(contentsOf: url))
    }

    // MARK: Clear

    /// Deletes instructions, photos, audits and to-dos. People are kept — they
    /// are configuration, not data to wipe.
    static func clearAll(in context: ModelContext) throws {
        // One by one rather than a batch delete: batch deletes bypass the
        // change tracking that iCloud sync relies on, so other devices would
        // never hear about them.
        all(Instruction.self, in: context).forEach { context.delete($0) }
        all(InstructionPhoto.self, in: context).forEach { context.delete($0) }
        all(Audit.self, in: context).forEach { context.delete($0) }
        all(ActionItem.self, in: context).forEach { context.delete($0) }
        all(RecognitionPrint.self, in: context).forEach { context.delete($0) }
        try context.save()
    }
}

// Photos in a backup are data: URIs ("data:image/jpeg;base64,....").
enum DataURI {
    static func decode(_ uri: String?) -> Data? {
        guard let uri, uri.hasPrefix("data:"), let comma = uri.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(uri[uri.index(after: comma)...]), options: .ignoreUnknownCharacters)
    }

    static func encode(_ data: Data) -> String {
        let isPNG = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
        return "data:image/\(isPNG ? "png" : "jpeg");base64," + data.base64EncodedString()
    }
}

// Photos are downscaled on the way in: a full-size iPhone photo is several
// megabytes, and there is no reason to sync or back up more than it takes to
// read a label or see a valve position.
enum PhotoProcessing {
    static let maxEdge: CGFloat = 1400
    static let quality: CGFloat = 0.8
    static let thumbEdge: CGFloat = 240
    static let thumbQuality: CGFloat = 0.7

    struct Prepared {
        let data: Data
        let thumb: Data
        let width: Int
        let height: Int
    }

    static func prepare(_ original: Data) -> Prepared? {
        guard let image = UIImage(data: original),
              let full = resized(image, maxEdge: maxEdge),
              let data = full.jpegData(compressionQuality: quality),
              let small = resized(image, maxEdge: thumbEdge),
              let thumb = small.jpegData(compressionQuality: thumbQuality) else { return nil }
        return Prepared(data: data, thumb: thumb,
                        width: Int(full.size.width * full.scale),
                        height: Int(full.size.height * full.scale))
    }

    static func thumbnail(from data: Data) -> Data? {
        guard let image = UIImage(data: data), let small = resized(image, maxEdge: thumbEdge) else { return nil }
        return small.jpegData(compressionQuality: thumbQuality)
    }

    private static func resized(_ image: UIImage, maxEdge: CGFloat) -> UIImage? {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        guard pixelWidth > 0, pixelHeight > 0 else { return nil }
        let scale = min(1, maxEdge / max(pixelWidth, pixelHeight))
        let size = CGSize(width: max(1, (pixelWidth * scale).rounded()), height: max(1, (pixelHeight * scale).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
