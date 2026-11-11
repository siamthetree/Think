import SwiftUI
import SwiftData

@main
public struct ChintaApp: App {
    let container: ModelContainer
    
    public init() {
        do {
            let schema = Schema([Feed.self, FeedItem.self])
            let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
            self.container = try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Could not initialize SwiftData container: \(error)")
        }
    }
    
    public var body: some Scene {
        WindowGroup {
            AdaptiveViewportContainer { _ in
                MainFeedView()
            }
            .modelContainer(container)
            .preferredColorScheme(.dark)
        }
    }
}
