import Foundation

/// Everything a new instruction needs, as the guided "New from Photos" flow
/// collects it. Claude fills in a first version from the photos; you correct it.
struct InstructionDraft {
    var title = ""
    var summary = ""
    var category = "General"
    var location = ""
    var locationDetail = ""
    var warnings = ""
    var equipment = ""
    var preparations = ""
    var steps: [String] = []
    var afterUse = ""
    var maintenance = ""
    var frequency = ""
    var timeEstimate = 0
    var difficulty = 0
    var tags: [String] = []
    var notes = ""
    /// Per photo: the step it belongs to (0-based), or nil for the gallery.
    var photoSteps: [Int?] = []
}

/// Asks Claude to draft an instruction from photos of the item.
///
/// One request to the Anthropic Messages API. Swift has no official Anthropic
/// SDK, so it is plain HTTP. The answer is constrained to a JSON schema
/// (structured outputs), so it always decodes into the fields above.
enum AIDraft {
    static let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
    static let model = "claude-opus-5"

    enum Failure: LocalizedError {
        case noKey
        case keyRejected
        case busy
        case declined
        case unreadable
        case server(Int, String)

        var errorDescription: String? {
            switch self {
            case .noKey:
                return "No API key yet. Add it under Settings → AI Drafts."
            case .keyRejected:
                return "The API key was not accepted. Check it under Settings → AI Drafts."
            case .busy:
                return "Claude is busy right now. Try again in a minute."
            case .declined:
                return "Claude declined to draft this one. Fill it in yourself."
            case .unreadable:
                return "The draft came back in a form the app could not read. Try again."
            case .server(let code, let message):
                return "Claude could not make a draft (\(code)): \(message)"
            }
        }
    }

    /// `photos` are JPEGs, already shrunk by PhotoProcessing.
    static func make(photos: [Data], hint: String, key: String) async throws -> InstructionDraft {
        var content: [[String: Any]] = photos.map { data in
            ["type": "image",
             "source": ["type": "base64", "media_type": "image/jpeg", "data": data.base64EncodedString()]]
        }
        var ask = "Here \(photos.count == 1 ? "is 1 photo" : "are \(photos.count) photos") of the item, numbered 1 to \(photos.count) in the order shown. Draft the instruction for it."
        let hint = hint.trimmingCharacters(in: .whitespacesAndNewlines)
        if !hint.isEmpty { ask += "\n\nWhat the owner says about it: " + hint }
        content.append(["type": "text", "text": ask])

        let body: [String: Any] = [
            "model": model,
            "max_tokens": 16000,
            "thinking": ["type": "adaptive"],
            "output_config": [
                "effort": "medium",
                "format": ["type": "json_schema", "schema": schema]
            ],
            // If a safety check declines the request, Anthropic retries it on
            // its recommended fallback model instead of just refusing.
            "fallbacks": "default",
            "system": systemPrompt,
            "messages": [["role": "user", "content": content]]
        ]

        var request = URLRequest(url: endpoint, timeoutInterval: 180)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(key, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]

        guard status == 200 else {
            switch status {
            case 401, 403: throw Failure.keyRejected
            case 429, 529: throw Failure.busy
            default:
                let message = ((json["error"] as? [String: Any])?["message"] as? String) ?? "no details"
                throw Failure.server(status, message)
            }
        }
        if json["stop_reason"] as? String == "refusal" { throw Failure.declined }

        // Thinking blocks come first; the answer is the text block.
        let blocks = json["content"] as? [[String: Any]] ?? []
        guard let text = blocks.last(where: { $0["type"] as? String == "text" })?["text"] as? String,
              let answer = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else {
            throw Failure.unreadable
        }
        return draft(from: answer, photoCount: photos.count)
    }

    /// Checks a key without spending anything: listing models is free.
    static func check(key: String) async throws {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/models?limit=1")!, timeoutInterval: 30)
        request.setValue(key, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        let (data, response) = try await URLSession.shared.data(for: request)
        switch (response as? HTTPURLResponse)?.statusCode ?? 0 {
        case 200: return
        case 401, 403: throw Failure.keyRejected
        case let code:
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            let message = ((json["error"] as? [String: Any])?["message"] as? String) ?? "no details"
            throw Failure.server(code, message)
        }
    }

    // MARK: The answer

    private static func draft(from answer: [String: Any], photoCount: Int) -> InstructionDraft {
        func text(_ key: String) -> String {
            (answer[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        func list(_ key: String) -> [String] {
            (answer[key] as? [Any] ?? []).compactMap { $0 as? String }
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
        func number(_ key: String) -> Int {
            (answer[key] as? NSNumber)?.intValue ?? 0
        }

        var draft = InstructionDraft()
        draft.title = text("title")
        draft.summary = text("description")
        let category = text("category")
        draft.category = Categories.order.contains(category) ? category : "General"
        let location = text("location")
        draft.location = Categories.locations.contains(location) ? location : ""
        draft.locationDetail = text("location_detail")
        draft.warnings = text("warnings")
        draft.equipment = text("equipment")
        draft.preparations = text("preparations")
        // One line per step is how steps are stored.
        draft.steps = list("steps").map { $0.replacingOccurrences(of: "\n", with: " ") }
        draft.afterUse = text("after_use")
        draft.maintenance = text("maintenance")
        let frequency = text("frequency")
        draft.frequency = Schedule.frequencies.contains(frequency) ? frequency : ""
        draft.timeEstimate = max(0, number("time_estimate_minutes"))
        draft.difficulty = min(3, max(0, number("difficulty")))
        draft.tags = list("tags").map { $0.lowercased() }
        draft.notes = text("notes")

        let stepNumbers = (answer["photo_steps"] as? [Any] ?? []).map { ($0 as? NSNumber)?.intValue ?? 0 }
        draft.photoSteps = (0..<photoCount).map { index in
            guard index < stepNumbers.count else { return nil }
            let step = stepNumbers[index]
            return step >= 1 && step <= draft.steps.count ? step - 1 : nil
        }
        return draft
    }

    // MARK: The request

    private static let systemPrompt = """
    You help one person keep a personal library of how-to instructions for things they own and do: \
    their RV, their home, their car and their sports. Each instruction is for one item or task and \
    is printed on the item as a label, so they can scan it and follow it.

    From the photos, work out what the item is and draft its instruction in English. \
    Read any visible text — brand, model, type plate, markings, warnings on the device — and use it. \
    Write for someone standing in front of the item: short, plain, practical sentences.

    - title: what the item or task is, short (e.g. "Truma Combi heater – switch on").
    - description: one or two sentences on what it is and what the instruction achieves.
    - steps: 3 to 12 steps, one action each, in the imperative, in the order they are done. No numbering.
    - warnings: real safety points only (gas, electricity, pressure, heat, water damage); empty if none.
    - equipment and preparations: only what is actually needed; empty if nothing.
    - after_use and maintenance: brief; empty if nothing sensible to say.
    - notes: model numbers, part numbers or settings you read from the photos.
    - photo_steps: for each photo in order, the step number (1-based) it best illustrates, or 0 if it \
    only shows the item in general.
    - Choose category, location and frequency from the allowed values; use "" for location or \
    frequency if the photos give no clue. difficulty: 1 easy, 2 medium, 3 hard, 0 unknown.

    Never invent specific values (pressures, torque, fuse ratings, times) that you cannot see or that \
    are not common knowledge for this exact item. If a step needs such a value, write "(check manual)" \
    in its place. The owner will review everything before saving.
    """

    private static var schema: [String: Any] {
        func string(_ description: String) -> [String: Any] {
            ["type": "string", "description": description]
        }
        let properties: [String: Any] = [
            "title": string("Short title"),
            "description": string("One or two sentences"),
            "category": ["type": "string", "enum": Categories.order],
            "location": ["type": "string", "enum": [""] + Categories.locations],
            "location_detail": string("Where exactly, e.g. 'under the bed, left side'"),
            "warnings": string("Safety warnings, or empty"),
            "equipment": string("Tools and materials, or empty"),
            "preparations": string("What to do before starting, or empty"),
            "steps": ["type": "array", "items": ["type": "string"]],
            "after_use": string("What to do afterwards, or empty"),
            "maintenance": string("Upkeep, or empty"),
            "frequency": ["type": "string", "enum": [""] + Schedule.frequencies],
            "time_estimate_minutes": ["type": "integer"],
            "difficulty": ["type": "integer", "enum": [0, 1, 2, 3]],
            "tags": ["type": "array", "items": ["type": "string"]],
            "notes": string("Model numbers and details read from the photos, or empty"),
            "photo_steps": ["type": "array", "items": ["type": "integer"]]
        ]
        return [
            "type": "object",
            "properties": properties,
            "required": Array(properties.keys).sorted(),
            "additionalProperties": false
        ]
    }
}
