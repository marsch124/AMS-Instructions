import SwiftUI
import UIKit
import SwiftData

enum AppTab: Hashable {
    case home, instructions, actions, settings

    var accent: Color {
        switch self {
        case .home: return Palette.home
        case .instructions: return Palette.instructions
        case .actions: return Palette.actions
        case .settings: return Palette.settings
        }
    }
}

/// Shared between tabs so one tab can send you to another (the Home to-do card
/// opens the Actions tab, for instance).
@Observable
final class Navigator {
    var tab: AppTab = .home
    /// Bumped when a tab is tapped while already showing, to send that tab
    /// back to its start screen (see `backToStart`).
    var startRequests: [AppTab: Int] = [:]

    func backToStart(_ tab: AppTab) {
        startRequests[tab, default: 0] += 1
    }
}

/// Tapping the tab you are already on takes you back to its start screen,
/// however deep you have gone — as in Apple's own apps.
private struct BackToStart: ViewModifier {
    let tab: AppTab
    @Binding var path: NavigationPath
    @Environment(Navigator.self) private var navigator

    func body(content: Content) -> some View {
        content.onChange(of: navigator.startRequests[tab, default: 0]) { _, _ in
            path = NavigationPath()
        }
    }
}

extension View {
    func backToStart(_ tab: AppTab, path: Binding<NavigationPath>) -> some View {
        modifier(BackToStart(tab: tab, path: path))
    }
}

struct RootView: View {
    @State private var navigator = Navigator()
    @State private var toasts = ToastCenter()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<ActionItem> { $0.status != "done" }) private var openActions: [ActionItem]
    @State private var keyboardShown = false

    var body: some View {
        // The four tabs stay alive on top of each other, so each keeps its place
        // (an open instruction, a scroll position) while you are elsewhere.
        VStack(spacing: 0) {
            ZStack {
                page(.home) { HomeView() }
                page(.instructions) { InstructionListView() }
                page(.actions) { ActionsView() }
                page(.settings) { SettingsView() }
            }
            // Hidden while typing, as Apple's tab bar is, so the keyboard
            // does not push it up over the screen.
            if !keyboardShown {
                ColourTabBar(selection: $navigator.tab, actionsBadge: openActions.count) { navigator.backToStart($0) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardShown = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardShown = false
        }
        // Every accent on a screen takes the colour of the tab you are in.
        .tint(navigator.tab.accent)
        .modifier(ToastOverlay())
        // Leaving the app is the moment to take the automatic backup: nothing
        // is being edited, and it is the last chance before the app may be closed.
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                try? context.save()
                AutoBackup.save(from: context)
                FileSync.shared.appWillResignActive()
            case .active:
                // Another device may have changed the library meanwhile.
                FileSync.shared.syncNow()
            default:
                break
            }
        }
        .environment(navigator)
        .environment(toasts)
    }

    private func page<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        let shown = navigator.tab == tab
        return content()
            .opacity(shown ? 1 : 0)
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
    }
}
