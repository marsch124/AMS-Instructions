import SwiftUI

/// The greeting at the top of an instruction: who, how long, what to watch
/// out for, and the way into the Guide.
struct WelcomeCard: View {
    let instruction: Instruction
    let name: String?
    let onStart: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(greeting)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.home)
            Text(facts)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let warning = firstWarning {
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Palette.danger)
                    .lineLimit(2)
            }
            Button(action: onStart) {
                Label("Start Guide", systemImage: "play.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .disabled(instruction.steps.isEmpty)
            .padding(.top, 4)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.home.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let part: String
        switch hour {
        case 5..<12: part = "Good morning"
        case 12..<17: part = "Good afternoon"
        case 17..<22: part = "Good evening"
        default: part = "Hello"
        }
        if let name, !name.isEmpty { return "\(part), \(name) 👋" }
        return "\(part) 👋"
    }

    private var facts: String {
        var parts: [String] = []
        if instruction.timeEstimate > 0 { parts.append("≈ \(Formatting.minutes(instruction.timeEstimate))") }
        parts.append(Formatting.plural(instruction.steps.count, "step"))
        switch instruction.difficulty {
        case 1: parts.append("Easy")
        case 2: parts.append("Medium")
        case 3: parts.append("Hard")
        default: break
        }
        return parts.joined(separator: " · ")
    }

    private var firstWarning: String? {
        let text = instruction.warnings.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return text.components(separatedBy: .newlines).first
    }
}

/// An instruction as an easy-to-read guide: one page at a time, in phases —
/// Prepare, Do (a page per step, with its photos), Afterwards. A walk-through
/// only: marking the job Done stays on the instruction screen.
struct GuideView: View {
    let instruction: Instruction
    let photos: [InstructionPhoto]

    @Environment(\.dismiss) private var dismiss
    @State private var index = 0
    @State private var fullScreenPhoto: InstructionPhoto?

    enum Page: Hashable {
        case prepare, step(Int), after, finish
    }

    private var hasPrepare: Bool {
        ![instruction.warnings, instruction.equipment, instruction.preparations]
            .allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private var hasAfter: Bool {
        ![instruction.afterUse, instruction.maintenance]
            .allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private var pages: [Page] {
        var pages: [Page] = []
        if hasPrepare { pages.append(.prepare) }
        pages += instruction.steps.indices.map { Page.step($0) }
        if hasAfter { pages.append(.after) }
        pages.append(.finish)
        return pages
    }

    /// The phases this guide has, in order.
    private var phases: [String] {
        var phases: [String] = []
        if hasPrepare { phases.append("Prepare") }
        phases.append("Do")
        if hasAfter { phases.append("Afterwards") }
        return phases
    }

    var body: some View {
        let pages = pages
        let current = pages[min(index, pages.count - 1)]
        NavigationStack {
            VStack(spacing: 0) {
                header(for: current, pages: pages)
                TabView(selection: $index) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { position, page in
                        ScrollView {
                            content(for: page)
                                .padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .tag(position)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                footer(pages: pages)
            }
            .navigationTitle(Labels.code(instruction.number))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .fullScreenCover(item: $fullScreenPhoto) { PhotoViewer(photo: $0) }
        }
    }

    // MARK: Header and footer

    private func header(for page: Page, pages: [Page]) -> some View {
        let phase = phaseName(page)
        let phaseNumber = (phases.firstIndex(of: phase) ?? 0) + 1
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(page == .finish ? "FINISHED" : "PHASE \(phaseNumber) OF \(phases.count) · \(phase.uppercased())")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Palette.home)
                Spacer()
                if case .step(let step) = page {
                    Text("Step \(step + 1) of \(instruction.steps.count)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            ProgressView(value: Double(index + 1), total: Double(pages.count))
                .tint(Palette.home)
            Text(instruction.title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private func footer(pages: [Page]) -> some View {
        HStack {
            Button {
                withAnimation { index = max(0, index - 1) }
            } label: {
                Label("Back", systemImage: "chevron.left")
                    .frame(minWidth: 90)
            }
            .buttonStyle(.bordered)
            .disabled(index == 0)

            Spacer()

            if index < pages.count - 1 {
                Button {
                    next(from: pages[index])
                } label: {
                    HStack(spacing: 4) {
                        Text("Next")
                        Image(systemName: "chevron.right")
                    }
                    .font(.headline)
                    .frame(minWidth: 110)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .controlSize(.large)
        .padding()
        .background(.bar)
    }

    /// A walk-through: paging on ticks nothing off.
    private func next(from page: Page) {
        withAnimation { index += 1 }
    }

    private func phaseName(_ page: Page) -> String {
        switch page {
        case .prepare: return "Prepare"
        case .step: return "Do"
        case .after: return "Afterwards"
        case .finish: return "Done"
        }
    }

    // MARK: Pages

    @ViewBuilder
    private func content(for page: Page) -> some View {
        switch page {
        case .prepare:
            VStack(alignment: .leading, spacing: 18) {
                Text("Before you start").font(.title.bold())
                if let photo = galleryPhotos.first { photoView(photo) }
                block("Safety", text: instruction.warnings, icon: "exclamationmark.triangle.fill", colour: Palette.danger)
                block("You need", text: instruction.equipment, icon: "wrench.and.screwdriver")
                block("Get ready", text: instruction.preparations, icon: "list.clipboard")
            }
        case .step(let step):
            VStack(alignment: .leading, spacing: 18) {
                Text("Step \(step + 1)")
                    .font(.headline)
                    .foregroundStyle(Palette.home)
                ForEach(stepPhotos(step)) { photoView($0) }
                Text(instruction.steps[step])
                    .font(.title2)
                    .fixedSize(horizontal: false, vertical: true)
                if step == 0, !hasPrepare, let warning = firstWarning {
                    Label(warning, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Palette.danger)
                }
            }
        case .after:
            VStack(alignment: .leading, spacing: 18) {
                Text("Afterwards").font(.title.bold())
                block("When you have finished", text: instruction.afterUse, icon: "arrow.uturn.backward")
                block("Upkeep", text: instruction.maintenance, icon: "gearshape.2")
            }
        case .finish:
            VStack(spacing: 18) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(Palette.success)
                Text("End of the guide").font(.title.bold())
                Text(instruction.title)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Text("Mark the job Done on the instruction screen when it is really finished.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button {
                    dismiss()
                } label: {
                    Label("Close Guide", systemImage: "xmark.circle.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 30)
        }
    }

    @ViewBuilder
    private func block(_ title: String, text: String, icon: String, colour: Color? = nil) -> some View {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label(title, systemImage: icon)
                    .font(.headline)
                    .foregroundStyle(colour ?? Color.primary)
                Text(text)
                    .font(.title3)
                    .foregroundStyle(colour ?? Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background((colour ?? Color.secondary).opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func photoView(_ photo: InstructionPhoto) -> some View {
        Button {
            fullScreenPhoto = photo
        } label: {
            if let data = photo.imageData ?? photo.thumbData, let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show photo full screen")
    }

    // MARK: Photos

    private func stepPhotos(_ step: Int) -> [InstructionPhoto] {
        photos.filter { $0.step == step }
    }

    /// Photos not pinned to any step.
    private var galleryPhotos: [InstructionPhoto] {
        photos.filter { photo in
            guard let step = photo.step else { return true }
            return step >= instruction.steps.count
        }
    }

    private var firstWarning: String? {
        let text = instruction.warnings.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text.components(separatedBy: .newlines).first
    }
}
