import SwiftUI
import SwiftData

struct InstructionListView: View {
    @Environment(LocalState.self) private var local
    @Environment(\.modelContext) private var context
    @Query private var instructions: [Instruction]
    @Query private var people: [Person]
    @Query private var photos: [InstructionPhoto]
    @Query private var actions: [ActionItem]
    @Query private var audits: [Audit]

    @State private var path = NavigationPath()
    @State private var searchText = ""
    @State private var filters = FilterState()
    @State private var showingFilters = false
    @State private var showingBulk = false
    @State private var editing: EditorTarget?
    @State private var creatingFromPhotos = false

    var body: some View {
        @Bindable var local = local
        let colors = OwnerColors(people: people)
        let thumbs = firstThumbs
        let filterContext = FilterContext(people: people, actions: actions, audits: audits, photos: photos)
        let term = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        let filtering = filters.isActive

        let (shown, matchedFields) = visible(term: term, context: filterContext)

        NavigationStack(path: $path) {
            List {
                summaryRow(shown: shown.count, filtering: filtering, term: term)

                if filtering, !shown.isEmpty {
                    Button {
                        showingBulk = true
                    } label: {
                        Label("Apply to all \(shown.count)…", systemImage: "bolt.fill")
                    }
                }

                if shown.isEmpty {
                    Text(emptyMessage(filtering: filtering, term: term))
                        .foregroundStyle(.secondary)
                } else if !term.isEmpty || filtering {
                    // Searching or filtering shows a flat list: grouping would bury
                    // results behind folded headers.
                    ForEach(local.sort.sorted(shown)) { instruction in
                        row(instruction, colors: colors, thumbs: thumbs, matched: matchedFields[instruction.uid])
                    }
                } else {
                    groupedRows(shown, colors: colors, thumbs: thumbs)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("All Instructions")
            .searchable(text: $searchText, prompt: "Number, title, or anything inside")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Sort", selection: $local.sort) {
                            ForEach(SortOrder.allCases) { order in
                                Text(order.label).tag(order)
                            }
                        }
                    } label: {
                        Label(local.sort.short, systemImage: "arrow.up.arrow.down")
                            .labelStyle(.titleAndIcon)
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        showingFilters = true
                    } label: {
                        Image(systemName: filtering
                              ? "line.3.horizontal.decrease.circle.fill"
                              : "line.3.horizontal.decrease.circle")
                    }
                    .accessibilityLabel(filtering ? "Filters (\(filters.count) on)" : "Filters")

                    Menu {
                        Button {
                            creatingFromPhotos = true
                        } label: {
                            Label("New from Photos", systemImage: "camera")
                        }
                        Button {
                            editing = EditorTarget(instruction: nil)
                        } label: {
                            Label("New (Blank Form)", systemImage: "square.and.pencil")
                        }
                    } label: {
                        Label("New", systemImage: "plus")
                            .labelStyle(.titleAndIcon)
                    }
                }
            }
            .instructionDestinations()
            .sheet(isPresented: $showingFilters) {
                FilterPanel(filters: $filters, instructions: instructions, context: filterContext)
            }
            .sheet(isPresented: $showingBulk) {
                BulkPanel(items: local.sort.sorted(shown), searchTerm: term)
            }
            .sheet(item: $editing) { target in
                InstructionEditorView(instruction: target.instruction)
            }
            .sheet(isPresented: $creatingFromPhotos) {
                NewFromPhotosView()
            }
        }
    }

    // MARK: Pieces

    /// The rows on screen, and for each search hit the hidden fields it matched in.
    private func visible(term: String, context: FilterContext) -> ([Instruction], [String: [String]]) {
        var matchedFields: [String: [String]] = [:]
        let shown = instructions.filter { instruction in
            guard filters.passes(instruction, context: context) else { return false }
            guard !term.isEmpty else { return true }
            let match = Search.match(instruction, term: term)
            if match.matched { matchedFields[instruction.uid] = match.fields }
            return match.matched
        }
        return (shown, matchedFields)
    }

    private var firstThumbs: [String: Data] {
        var result: [String: (index: Int, data: Data)] = [:]
        for photo in photos {
            guard let thumb = photo.thumbData ?? photo.imageData else { continue }
            if let existing = result[photo.instructionUID], existing.index <= photo.sortIndex { continue }
            result[photo.instructionUID] = (photo.sortIndex, thumb)
        }
        return result.mapValues(\.data)
    }

    @ViewBuilder
    private func summaryRow(shown: Int, filtering: Bool, term: String) -> some View {
        HStack {
            if filtering {
                Text("\(shown) of \(instructions.count)" + (term.isEmpty ? "" : " · searched"))
                Spacer()
                Button("Clear filters") { filters = FilterState() }
                    .buttonStyle(.borderless)
            } else if !term.isEmpty {
                Text(shown == 1 ? "1 match" : "\(shown) matches")
            } else {
                let groups = Set(instructions.map(\.category)).count
                Text("\(groups) groups · \(shown)")
                Spacer()
                Button(allOpen ? "Collapse all" : "Expand all") {
                    local.openGroups = allOpen ? [] : Set(instructions.map(\.category))
                }
                .buttonStyle(.borderless)
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    private var allOpen: Bool {
        let groups = Set(instructions.map(\.category))
        return !groups.isEmpty && groups.isSubset(of: local.openGroups)
    }

    private func emptyMessage(filtering: Bool, term: String) -> String {
        if instructions.isEmpty { return "No instructions yet. Tap + to add one, or restore a backup under Settings." }
        if filtering && !term.isEmpty { return "Nothing matches that search inside these filters." }
        if filtering { return "Nothing matches these filters." }
        return "No instructions found."
    }

    @ViewBuilder
    private func groupedRows(_ items: [Instruction], colors: OwnerColors, thumbs: [String: Data]) -> some View {
        let byCategory = Dictionary(grouping: items) { $0.category.isEmpty ? "General" : $0.category }
        ForEach(Categories.ordered(byCategory.keys), id: \.self) { category in
            DisclosureGroup(isExpanded: groupBinding(category)) {
                ForEach(local.sort.sorted(byCategory[category] ?? [])) { instruction in
                    row(instruction, colors: colors, thumbs: thumbs, matched: nil)
                }
            } label: {
                HStack {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Categories.color(category))
                        .frame(width: 12, height: 12)
                    Text(Categories.label(category)).font(.headline)
                    Spacer()
                    Text("\(byCategory[category]?.count ?? 0)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func groupBinding(_ category: String) -> Binding<Bool> {
        Binding(
            get: { local.openGroups.contains(category) },
            set: { open in
                if open { local.openGroups.insert(category) } else { local.openGroups.remove(category) }
            }
        )
    }

    private func row(_ instruction: Instruction, colors: OwnerColors, thumbs: [String: Data], matched: [String]?) -> some View {
        NavigationLink(value: instruction) {
            InstructionRow(instruction: instruction,
                           ownerName: ownerName(of: instruction, people: people),
                           colors: colors,
                           thumb: thumbs[instruction.uid],
                           note: (matched?.isEmpty ?? true) ? nil : "matched in " + matched!.joined(separator: ", "))
        }
        .swipeActions(edge: .trailing) {
            Button {
                editing = EditorTarget(instruction: instruction)
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            .tint(Palette.settings)
        }
    }
}

/// Identifies the editor sheet: nil means a new instruction.
struct EditorTarget: Identifiable {
    let id = UUID()
    let instruction: Instruction?
}
