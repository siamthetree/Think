import SwiftUI
import SwiftData
import OSLog

@main
public struct ChintaApp: App {
    private static let logger = Logger(subsystem: "app.chinta.reader", category: "Persistence")
    let container: ModelContainer
    
    public init() {
        let schema = Schema([Feed.self, FeedItem.self])
        let resolvedContainer: ModelContainer
        do {
            let persistentConfig = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
            resolvedContainer = try ModelContainer(for: schema, configurations: [persistentConfig])
        } catch {
            Self.logger.error("Persistent SwiftData store failed (\(error.localizedDescription)); falling back to in-memory store instead of crashing.")
            let memoryConfig = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            // Safe fallback so a corrupted store or schema migration issue never crashes on launch
            if let fallback = try? ModelContainer(for: schema, configurations: [memoryConfig]) {
                resolvedContainer = fallback
            } else {
                resolvedContainer = try! ModelContainer(for: schema)
            }
        }
        self.container = resolvedContainer
        
        // Must register BGTaskScheduler launch handler synchronously before application(_:didFinishLaunchingWithOptions:) returns
        FeedRefreshEngine.registerBackgroundTask(container: resolvedContainer)
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
