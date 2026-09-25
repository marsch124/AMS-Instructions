import SwiftUI
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
}

struct RootView: View {
    @State private var navigator = Navigator()
    @State private var toasts = ToastCenter()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<ActionItem> { $0.status != "done" }) private var openActions: [ActionItem]

    var body: some View {
        TabView(selection: $navigator.tab) {
            HomeView()
                .tabItem { Label("Home", systemImage: "house") }
                .tag(AppTab.home)

            InstructionListView()
                .tabItem { Label("Instructions", systemImage: "list.number") }
                .tag(AppTab.instructions)

            ActionsView()
                .tabItem { Label("Actions", systemImage: "checklist") }
                .badge(openActions.count)
                .tag(AppTab.actions)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppTab.settings)
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
}
