import SwiftUI
import SwiftData

@main
struct AMSInstructionsApp: App {
    let container: ModelContainer
    @State private var local = LocalState()

    init() {
        container = Self.makeContainer()
        FileSync.shared.start(container: container)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(local)
        }
        .modelContainer(container)
    }

    /// The library lives on this device. Syncing between devices is a file in
    /// the app's iCloud Drive folder (see FileSync), the same way the other AMS
    /// apps sync — no iCloud database schema to set up.
    private static func makeContainer() -> ModelContainer {
        let schema = Schema(AppSchema.models)
        do {
            let config = ModelConfiguration(schema: schema, cloudKitDatabase: .none)
            return try ModelContainer(for: schema, configurations: config)
        } catch {
            fatalError("Could not open the instruction library: \(error)")
        }
    }
}
