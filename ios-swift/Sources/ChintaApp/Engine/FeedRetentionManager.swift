import Foundation
import SwiftData

public final class FeedRetentionManager {
    public init() {}
    
    public static func prune(feed: Feed, modelContext: ModelContext) {
        let minCount = max(500, feed.maxRetentionCount)
        let minDays = max(30, feed.maxRetentionDays)
        let cutoffDate = Calendar.current.date(byAdding: .day, value: -minDays, to: Date.now) ?? Date.distantPast
        
        let feedID = feed.id
        let descriptor = FetchDescriptor<FeedItem>(
            predicate: #Predicate<FeedItem> { item in
                item.feed?.id == feedID
            },
            sortBy: [SortDescriptor(\.publishedDate, order: .reverse)]
        )
        
        guard let allItems = try? modelContext.fetch(descriptor) else { return }
        
        // Never delete unread or starred items
        var keptCount = 0
        for item in allItems {
            keptCount += 1
            
            if !item.isRead || item.isStarred {
                continue
            }
            
            let isPastCountThreshold = keptCount > minCount
            let isPastDateThreshold = item.publishedDate < cutoffDate
            
            if isPastCountThreshold && isPastDateThreshold {
                modelContext.delete(item)
            }
        }
        
        try? modelContext.save()
    }
}
