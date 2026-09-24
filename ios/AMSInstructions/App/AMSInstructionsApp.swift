import SwiftUI
import SwiftData

@main
struct AMSInstructionsApp: App {
    let container: ModelContainer
    @State private var local = LocalState()

    init() {
        container = Self.makeContainer()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(local)
        }
        .modelContainer(container)
    }

    /// The library syncs through the app's iCloud container when the app is
    /// signed with the iCloud capability. If that cannot be set up — no iCloud
    /// account, or a build signed without the capability — the same library is
    /// kept on this device only, rather than the app refusing to open.
    private static func makeContainer() -> ModelContainer {
        let schema = Schema(AppSchema.models)
        do {
            let synced = ModelConfiguration(schema: schema, cloudKitDatabase: .automatic)
            return try ModelContainer(for: schema, configurations: synced)
        } catch {
            print("[Store] iCloud store unavailable, using on-device store: \(error)")
        }
        do {
            let local = ModelConfiguration(schema: schema, cloudKitDatabase: .none)
            return try ModelContainer(for: schema, configurations: local)
        } catch {
            fatalError("Could not open the instruction library: \(error)")
        }
    }
}
