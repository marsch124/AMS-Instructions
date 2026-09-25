import SwiftUI
import SwiftData

/// Where an instruction is opened by its number (scan, related list, a to-do).
struct InstructionNumberRoute: Hashable {
    let number: String
}

extension View {
    /// Every tab's NavigationStack can open an instruction, by record or number.
    func instructionDestinations() -> some View {
        navigationDestination(for: Instruction.self) { instruction in
            InstructionDetailView(instruction: instruction)
        }
        .navigationDestination(for: InstructionNumberRoute.self) { route in
            InstructionByNumberView(number: route.number)
        }
    }
}

struct InstructionByNumberView: View {
    let number: String
    @Environment(\.modelContext) private var context

    var body: some View {
        if let instruction = Library.instruction(number: number, in: context) {
            InstructionDetailView(instruction: instruction)
        } else {
            ContentUnavailableView("No instruction \(Numbers.normalize(number))",
                                   systemImage: "questionmark.square.dashed",
                                   description: Text("Nothing in the library has this number."))
        }
    }
}

struct CategoryBadge: View {
    let category: String

    var body: some View {
        Text(Categories.label(category))
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Categories.color(category), in: Capsule())
            .foregroundStyle(.white)
    }
}

struct OwnerPill: View {
    let name: String
    let colors: OwnerColors

    var body: some View {
        Label(name, systemImage: "person.fill")
            .font(.caption.weight(.medium))
            .labelStyle(.titleAndIcon)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(colors.color(for: name).opacity(0.18), in: Capsule())
            .foregroundStyle(colors.color(for: name))
    }
}

struct Thumbnail: View {
    let data: Data?
    var size: CGFloat = 44

    var body: some View {
        if let data, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

/// One instruction in a list. The same row is used everywhere — browsing,
/// searching, Due, Library Health — so a result looks the same wherever it is.
struct InstructionRow: View {
    let instruction: Instruction
    var ownerName: String = ""
    var colors = OwnerColors(people: [])
    var thumb: Data?
    var note: String?

    var body: some View {
        HStack(spacing: 12) {
            Thumbnail(data: thumb)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(instruction.number)
                        .font(.subheadline.monospacedDigit().weight(.bold))
                        .foregroundStyle(.tint)
                    Text(instruction.title)
                        .font(.body)
                        .lineLimit(2)
                }
                HStack(spacing: 6) {
                    Circle()
                        .fill(Categories.color(instruction.category))
                        .frame(width: 8, height: 8)
                    Text(Categories.label(instruction.category))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // No pill where nobody is named: a "No owner" mark on two
                    // hundred rows would drown the ones that have one.
                    if !ownerName.isEmpty {
                        OwnerPill(name: ownerName, colors: colors)
                    }
                }
                if let note {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .italic()
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// The owner as a name to print, whether it was stored as a person id or as a
/// bare name from imported data. A dangling id falls back to the stored name.
func ownerName(of instruction: Instruction, people: [Person]) -> String {
    if let id = instruction.ownerID, let person = people.first(where: { $0.uid == id }) {
        return person.name
    }
    return instruction.owner.trimmingCharacters(in: .whitespaces)
}

// MARK: - Toasts

/// Brief confirmation that goes away on its own, optionally with one button
/// ("Undo", "Not you?"). One with a button stays up longer, because it has to
/// be read and acted on rather than merely noticed.
@Observable
final class ToastCenter {
    struct Toast: Identifiable {
        let id = UUID()
        let message: String
        let actionLabel: String?
        let action: (() -> Void)?
    }

    var current: Toast?

    func show(_ message: String, actionLabel: String? = nil, action: (() -> Void)? = nil) {
        let toast = Toast(message: message, actionLabel: actionLabel, action: action)
        current = toast
        let delay: Double = action == nil ? 2.4 : 6
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            if self?.current?.id == toast.id { self?.current = nil }
        }
    }
}

struct ToastOverlay: ViewModifier {
    @Environment(ToastCenter.self) private var toasts

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let toast = toasts.current {
                HStack(spacing: 12) {
                    Text(toast.message)
                        .font(.subheadline.weight(.medium))
                    if let label = toast.actionLabel, let action = toast.action {
                        Button(label) {
                            toasts.current = nil
                            action()
                        }
                        .font(.subheadline.weight(.bold))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(.regularMaterial, in: Capsule())
                .shadow(radius: 6, y: 2)
                .padding(.bottom, 64)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .id(toast.id)
            }
        }
        .animation(.spring(duration: 0.3), value: toasts.current?.id)
    }
}

// MARK: - Who did it?

/// A list of people, resolving to the one picked, or nil for "don't record a
/// name". Nobody is credited by default: the only ways out are an explicit tap
/// on a name, or no name at all.
struct PersonChooser: View {
    let title: String
    let message: String
    let onChoose: (Person?) -> Void

    @Query(sort: \Person.name) private var people: [Person]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let colors = OwnerColors(people: people)
        NavigationStack {
            List {
                if !message.isEmpty {
                    Text(message).font(.callout).foregroundStyle(.secondary)
                }
                Section {
                    ForEach(people) { person in
                        Button {
                            onChoose(person)
                            dismiss()
                        } label: {
                            OwnerPill(name: person.name, colors: colors)
                        }
                    }
                    Button(people.isEmpty ? "Nobody is in your People list yet" : "Don’t record a name") {
                        onChoose(nil)
                        dismiss()
                    }
                    .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onChoose(nil)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct SectionCard<Content: View>: View {
    let title: String
    var systemImage: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let systemImage {
                Label(title, systemImage: systemImage).font(.headline)
            } else {
                Text(title).font(.headline)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }
}
