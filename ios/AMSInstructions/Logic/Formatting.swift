import Foundation

enum Formatting {
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = Int(now.timeIntervalSince(date))
        let minutes = seconds / 60
        let hours = minutes / 60
        let days = hours / 24
        let weeks = days / 7
        let months = days / 30

        if seconds < 60 { return "Just now" }
        if minutes < 60 { return minutes == 1 ? "1 minute ago" : "\(minutes) minutes ago" }
        if hours < 24 { return hours == 1 ? "1 hour ago" : "\(hours) hours ago" }
        if days == 1 { return "Yesterday" }
        if days < 7 { return "\(days) days ago" }
        if weeks == 1 { return "1 week ago" }
        if weeks < 4 { return "\(weeks) weeks ago" }
        if months == 1 { return "1 month ago" }
        if months < 12 { return "\(months) months ago" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    static func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
        "\(count) " + (count == 1 ? one : (many ?? one + "s"))
    }

    static func dateAndTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    static func bytes(_ count: Int) -> String {
        if count >= 1024 * 1024 { return String(format: "%.1f MB", Double(count) / (1024 * 1024)) }
        return "\(count / 1024) KB"
    }

    /// Action due dates are calendar days stored as "yyyy-MM-dd".
    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func day(from string: String?) -> Date? {
        guard let string, !string.isEmpty else { return nil }
        return dayFormatter.date(from: string)
    }

    static func dayString(_ date: Date) -> String {
        dayFormatter.string(from: date)
    }
}
