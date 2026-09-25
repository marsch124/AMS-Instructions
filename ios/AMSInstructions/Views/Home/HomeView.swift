import SwiftUI
import SwiftData

struct HomeView: View {
    @Environment(Navigator.self) private var navigator
    @Environment(LocalState.self) private var local
    @Query private var instructions: [Instruction]
    @Query(sort: \Person.name) private var people: [Person]
    @Query(filter: #Predicate<ActionItem> { $0.status != "done" }) private var openActions: [ActionItem]
    @Query(sort: \InstructionPhoto.sortIndex) private var photos: [InstructionPhoto]

    @State private var path = NavigationPath()
    @State private var scanning = false
    @State private var exporting = false

    private let backupNudgeAfterDays = 7

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 16) {
                    scanButton
                    nudges
                    favouritesSection
                    recentSection
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Instructions")
            .instructionDestinations()
            .navigationDestination(for: HomeRoute.self) { route in
                switch route {
                case .due: DueListView()
                case .run: RunView()
                }
            }
            .sheet(isPresented: $scanning) {
                ScanView { number in
                    scanning = false
                    path.append(InstructionNumberRoute(number: number))
                }
            }
            .sheet(isPresented: $exporting) {
                BackupExportSheet()
            }
        }
    }

    // MARK: Scan

    private var scanButton: some View {
        Button {
            scanning = true
        } label: {
            VStack(spacing: 10) {
                Image(systemName: "viewfinder")
                    .font(.system(size: 44, weight: .semibold))
                Text("Scan Instruction")
                    .font(.title3.weight(.bold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
            .background(Palette.brand, in: RoundedRectangle(cornerRadius: 20))
            .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Scan or enter instruction number")
    }

    // MARK: Nudges

    @ViewBuilder
    private var nudges: some View {
        if let backup = backupNudge {
            NudgeCard(title: backup.title, detail: backup.detail, systemImage: "externaldrive.badge.icloud",
                      color: Palette.warm) {
                exporting = true
            }
        }

        if let run = local.currentRun {
            NudgeCard(title: run.name, detail: "\(run.ticked.count) of \(run.numbers.count) done · tap to carry on",
                      systemImage: "figure.walk", color: Palette.settings) {
                path.append(HomeRoute.run)
            }
        }

        let due = Schedule.dueList(instructions)
        if let worst = due.first {
            NudgeCard(title: "Due now", detail: "\(due.count) due · oldest \(Schedule.overdueBy(worst.dueAt))",
                      systemImage: "clock.badge.exclamationmark", color: Palette.danger) {
                path.append(HomeRoute.due)
            }
        }

        if !openActions.isEmpty {
            let high = openActions.filter(\.isHighPriority).count
            NudgeCard(title: "To-dos to tackle",
                      detail: "\(openActions.count) open" + (high > 0 ? " · \(high) high-priority" : ""),
                      systemImage: "checklist", color: Palette.actions) {
                navigator.tab = .actions
            }
        }
    }

    private var backupNudge: (title: String, detail: String)? {
        guard !instructions.isEmpty else { return nil }
        guard let last = local.lastExport else {
            return ("Back up your instructions", "Never backed up")
        }
        let days = Int(Date().timeIntervalSince(last) / Schedule.day)
        guard days >= backupNudgeAfterDays else { return nil }
        return ("Back up your instructions", "Last backup \(days) days ago")
    }

    // MARK: Lists

    private var favouritesSection: some View {
        let favourites = instructions.filter(\.isFavorite).sorted { $0.number < $1.number }
        return HomeSection(title: "Favorites") {
            if favourites.isEmpty {
                Text("No favorites yet. Tap ☆ on an instruction to add.")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(favourites) { instruction in
                    card(for: instruction)
                }
            }
        }
    }

    private var recentSection: some View {
        let recent = instructions
            .filter { $0.lastViewedAt != nil }
            .sorted { ($0.lastViewedAt ?? .distantPast) > ($1.lastViewedAt ?? .distantPast) }
            .prefix(5)
        return HomeSection(title: "Recently Viewed") {
            if recent.isEmpty {
                Text("Scanned instructions appear here.")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(Array(recent)) { instruction in
                    card(for: instruction)
                }
            }
        }
    }

    private func card(for instruction: Instruction) -> some View {
        NavigationLink(value: instruction) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Categories.color(instruction.category))
                    .frame(width: 4)
                Thumbnail(data: photos.first { $0.instructionUID == instruction.uid }?.thumbData, size: 40)
                Text(instruction.number)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(Palette.home)
                VStack(alignment: .leading, spacing: 2) {
                    Text(instruction.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                    Text(Categories.label(instruction.category)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .padding(10)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

enum HomeRoute: Hashable {
    case due, run
}

private struct HomeSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title3.weight(.bold))
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct NudgeCard: View {
    let title: String
    let detail: String
    let systemImage: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .foregroundStyle(color)
                    .frame(width: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(detail).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding()
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(color.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// Everything whose frequency says it should have come round again by now.
struct DueListView: View {
    @Query private var instructions: [Instruction]
    @Query private var people: [Person]

    var body: some View {
        let due = Schedule.dueList(instructions)
        let colors = OwnerColors(people: people)
        List {
            if due.isEmpty {
                Text("Nothing is due. An instruction starts its clock the first time you mark it Done.")
                    .foregroundStyle(.secondary)
            }
            ForEach(due, id: \.instruction.uid) { entry in
                NavigationLink(value: entry.instruction) {
                    InstructionRow(instruction: entry.instruction,
                                   ownerName: ownerName(of: entry.instruction, people: people),
                                   colors: colors,
                                   note: "\(entry.instruction.frequency) · \(Schedule.overdueBy(entry.dueAt))")
                }
            }
        }
        .navigationTitle("Due now")
    }
}
