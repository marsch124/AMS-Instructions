import SwiftUI

/// The tab bar along the bottom. Unlike Apple's, every tab always shows its
/// own colour; the tab you are on is filled, bold, and its whole section of
/// the bar is tinted in its colour, down to the bottom edge of the screen.
struct ColourTabBar: View {
    @Binding var selection: AppTab
    let actionsBadge: Int

    private struct Item {
        let tab: AppTab
        let title: String
        let icon: String
        let selectedIcon: String
    }

    private let items = [
        Item(tab: .home, title: "Home", icon: "house", selectedIcon: "house.fill"),
        Item(tab: .instructions, title: "Instructions", icon: "list.number", selectedIcon: "list.number"),
        Item(tab: .actions, title: "Actions", icon: "checklist", selectedIcon: "checklist"),
        Item(tab: .settings, title: "Settings", icon: "gearshape", selectedIcon: "gearshape.fill")
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.tab) { item in
                button(for: item)
            }
        }
        .background(alignment: .top) {
            Divider()
        }
        .background {
            Color(.systemBackground).opacity(0.97)
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private func button(for item: Item) -> some View {
        let selected = selection == item.tab
        let colour = item.tab.accent
        return Button {
            selection = item.tab
        } label: {
            VStack(spacing: 3) {
                Image(systemName: selected ? item.selectedIcon : item.icon)
                    .font(.system(size: 21, weight: selected ? .bold : .regular))
                    .frame(height: 26)
                    .overlay(alignment: .topTrailing) {
                        if item.tab == .actions && actionsBadge > 0 {
                            Text("\(actionsBadge)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .frame(minWidth: 18, minHeight: 18)
                                .background(Color.red, in: Capsule())
                                .offset(x: 12, y: -6)
                        }
                    }
                Text(item.title)
                    .font(.system(size: 11, weight: selected ? .bold : .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(colour)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            .padding(.bottom, 6)
            .contentShape(Rectangle())
            .background {
                if selected {
                    colour.opacity(0.16)
                        .ignoresSafeArea(edges: .bottom)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title + (item.tab == .actions && actionsBadge > 0 ? ", \(actionsBadge) open" : ""))
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }
}
