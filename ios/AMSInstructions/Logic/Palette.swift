import SwiftUI
import UIKit

// Colours carried over from the web app's stylesheet.
enum Palette {
    static let brand = Color(hex: 0xFF006E)

    // One accent per tab, so a screen always shows which tab it belongs to.
    static let home = Color(hex: 0xFF006E)
    static let instructions = Color(light: 0x00875A, dark: 0x00C97B)
    static let actions = Color(light: 0xE5372B, dark: 0xFF4438)
    static let settings = Color(light: 0x1878CE, dark: 0x2D9BF0)

    static let danger = Color(light: 0xC81E1E, dark: 0xFF6B6B)
    static let success = Color(hex: 0x10B981)
    static let warm = Color(hex: 0xDD7324)
}

// The order categories appear in: RV, then Life, then Sport — not alphabetical.
// Anything not listed (from an older backup, say) is appended at the end.
enum Categories {
    struct Group {
        let name: String
        let categories: [String]
    }

    static let groups: [Group] = [
        Group(name: "RV", categories: ["General", "Bedroom", "Driving", "Water", "Maintenance", "Safety"]),
        Group(name: "Life", categories: ["Home"]),
        Group(name: "Sport", categories: ["Diving", "Running", "Cycling", "Swimming", "Golf", "Strength", "Mobility", "Meditation"])
    ]

    static let order: [String] = groups.flatMap(\.categories)

    static func label(_ category: String) -> String {
        category == "Water" ? "Water Systems" : category
    }

    static func ordered(_ present: some Collection<String>) -> [String] {
        let set = Set(present)
        return order.filter(set.contains) + set.subtracting(order).sorted()
    }

    static func color(_ category: String) -> Color {
        switch category.lowercased() {
        case "general": return Color(hex: 0x7C3AED)
        case "bedroom": return Color(hex: 0xA855F7)
        case "driving": return Color(hex: 0xF59E0B)
        case "water": return Color(hex: 0x0891B2)
        case "maintenance": return Color(hex: 0xEA580C)
        case "safety": return Color(hex: 0xDC2626)
        case "home": return Color(hex: 0x0EA5E9)
        case "diving": return Color(hex: 0x1E40AF)
        case "running": return Color(hex: 0x16A34A)
        case "cycling": return Color(hex: 0x84CC16)
        case "swimming": return Color(hex: 0x06B6D4)
        case "golf": return Color(hex: 0xCA8A04)
        case "strength": return Color(hex: 0x57534E)
        case "mobility": return Color(hex: 0xEC4899)
        case "meditation": return Color(hex: 0xD946EF)
        default: return .gray
        }
    }

    static let locations = ["In Car", "In RV", "At Home", "Attic", "Cellar", "Garage", "Shed", "Outdoors", "Other"]
}

// A stable colour per person. People get a hue by how long they have been in
// People (oldest first), so adding someone never reshuffles everyone else; a
// name belonging to nobody is hashed into the same set.
struct OwnerColors {
    static let hues: [Double] = [205, 25, 280, 330, 95, 175, 55, 250]

    private let huesByName: [String: Double]

    init(people: [Person]) {
        var map: [String: Double] = [:]
        for (index, person) in people.sorted(by: { $0.createdAt < $1.createdAt }).enumerated() {
            let key = person.name.trimmingCharacters(in: .whitespaces).lowercased()
            if map[key] == nil { map[key] = Self.hues[index % Self.hues.count] }
        }
        huesByName = map
    }

    func hue(for name: String) -> Double {
        let key = name.trimmingCharacters(in: .whitespaces).lowercased()
        if let hue = huesByName[key] { return hue }
        var hash = 0
        for scalar in key.unicodeScalars {
            hash = (hash * 31 + Int(scalar.value)) % 4096
        }
        return Self.hues[hash % Self.hues.count]
    }

    func color(for name: String) -> Color {
        Color(hue: hue(for: name) / 360, saturation: 0.65, brightness: 0.75)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(uiColor: UIColor(hex: hex))
    }

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: 1)
    }
}
