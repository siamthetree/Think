import Foundation
import SwiftData

@Model
public final class Feed {
    @Attribute(.unique) public var id: UUID
    public var title: String
    public var url: URL
    public var siteURL: URL?
    public var feedDescription: String?
    
    // HTTP Conditional Caching
    public var etag: String?
    public var lastModified: String?
    
    // Scheduling & Adaptive Polling
    public var userConfiguredInterval: TimeInterval
    public var currentInterval: TimeInterval
    public var lastFetchDate: Date?
    public var nextFetchDate: Date
    public var lastSuccessfulFetchDate: Date?
    
    // Adaptive Streaks
    public var consecutiveNewItemsCount: Int
    public var consecutiveEmptyCount: Int
    
    // Error Handling & Failing State
    public var consecutiveErrorCount: Int
    public var isFailing: Bool
    public var lastErrorMessage: String?
    public var backoffUntilDate: Date?
    
    // Initial Fetch Tracking & Settings
    public var isInitialFetchDone: Bool
    public var initialItemLimit: Int
    public var maxRetentionCount: Int
    public var maxRetentionDays: Int
    
    // One-to-many relationship
    @Relationship(deleteRule: .cascade, inverse: \FeedItem.feed)
    public var items: [FeedItem] = []
    
    public init(
        title: String,
        url: URL,
        siteURL: URL? = nil,
        feedDescription: String? = nil,
        refreshInterval: TimeInterval = 1800, // 30 minutes
        initialItemLimit: Int = 50,
        maxRetentionCount: Int = 500,
        maxRetentionDays: Int = 30
    ) {
        self.id = UUID()
        self.title = title
        self.url = url
        self.siteURL = siteURL
        self.feedDescription = feedDescription
        self.userConfiguredInterval = min(max(refreshInterval, 900), 21600) // 15m to 6h
        self.currentInterval = self.userConfiguredInterval
        self.nextFetchDate = Date.now
        self.consecutiveNewItemsCount = 0
        self.consecutiveEmptyCount = 0
        self.consecutiveErrorCount = 0
        self.isFailing = false
        self.isInitialFetchDone = false
        self.initialItemLimit = initialItemLimit
        self.maxRetentionCount = maxRetentionCount
        self.maxRetentionDays = maxRetentionDays
    }
}

@Model
public final class FeedItem {
    @Attribute(.unique) public var id: UUID
    public var deduplicationKey: String
    public var guid: String?
    public var title: String
    public var link: URL?
    public var summary: String?
    public var contentHTML: String?
    public var author: String?
    public var publishedDate: Date
    public var fetchedDate: Date
    public var imageURL: URL?
    
    // User State - Protected from Retention Pruning
    public var isRead: Bool
    public var isStarred: Bool
    
    // Parent relationship
    public var feed: Feed?
    
    public init(
        deduplicationKey: String,
        guid: String? = nil,
        title: String,
        link: URL? = nil,
        summary: String? = nil,
        contentHTML: String? = nil,
        author: String? = nil,
        publishedDate: Date = Date.now,
        imageURL: URL? = nil,
        isRead: Bool = false,
        isStarred: Bool = false
    ) {
        self.id = UUID()
        self.deduplicationKey = deduplicationKey
        self.guid = guid
        self.title = title
        self.link = link
        self.summary = summary
        self.contentHTML = contentHTML
        self.author = author
        self.publishedDate = publishedDate
        self.fetchedDate = Date.now
        self.imageURL = imageURL
        self.isRead = isRead
        self.isStarred = isStarred
    }
}
