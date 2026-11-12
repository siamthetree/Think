import Foundation
import SwiftData
import BackgroundTasks

public struct FeedFetchCandidate: Sendable {
    public let feedID: UUID
    public let url: URL
    public let etag: String?
    public let lastModified: String?
}

@ModelActor
public actor FeedDataStore {
    public func seedDefaultsIfNeeded() {
        let descriptor = FetchDescriptor<Feed>()
        let count = (try? modelContext.fetchCount(descriptor)) ?? 0
        guard count == 0 else { return }
        
        let defaults: [(String, String)] = [
            ("The Daily Star", "https://www.thedailystar.net/rss.xml"),
            ("Prothom Alo (English)", "https://en.prothomalo.com/feed"),
            ("প্রথম আলো (Prothom Alo)", "https://www.prothomalo.com/feed"),
            ("BBC World News", "https://feeds.bbci.co.uk/news/world/rss.xml"),
            ("The Guardian World", "https://www.theguardian.com/world/rss")
        ]
        
        for (title, urlStr) in defaults {
            if let url = URL(string: urlStr) {
                let feed = Feed(title: title, url: url)
                modelContext.insert(feed)
            }
        }
        try? modelContext.save()
    }
    
    public func fetchAllCandidates() -> [FeedFetchCandidate] {
        let descriptor = FetchDescriptor<Feed>()
        guard let feeds = try? modelContext.fetch(descriptor) else { return [] }
        return feeds.map {
            FeedFetchCandidate(
                feedID: $0.id,
                url: $0.url,
                etag: $0.etag,
                lastModified: $0.lastModified
            )
        }
    }
    
    public func fetchCandidate(feedID: UUID, isManualOverride: Bool) -> FeedFetchCandidate? {
        let descriptor = FetchDescriptor<Feed>(
            predicate: #Predicate<Feed> { feed in
                feed.id == feedID
            }
        )
        guard let feed = try? modelContext.fetch(descriptor).first else { return nil }
        let now = Date.now
        if !isManualOverride, let backoff = feed.backoffUntilDate, backoff > now {
            return nil
        }
        feed.lastFetchDate = now
        try? modelContext.save()
        return FeedFetchCandidate(
            feedID: feed.id,
            url: feed.url,
            etag: feed.etag,
            lastModified: feed.lastModified
        )
    }
    
    public func fetchDueCandidates(now: Date = Date.now) -> [FeedFetchCandidate] {
        // Avoid force-unwrapping backoffUntilDate! inside #Predicate for iOS 17 SwiftData safety
        let descriptor = FetchDescriptor<Feed>(
            predicate: #Predicate<Feed> { feed in
                feed.nextFetchDate <= now
            }
        )
        guard let candidates = try? modelContext.fetch(descriptor) else { return [] }
        
        var result: [FeedFetchCandidate] = []
        for feed in candidates {
            if let backoff = feed.backoffUntilDate, backoff > now {
                continue
            }
            feed.lastFetchDate = now
            result.append(
                FeedFetchCandidate(
                    feedID: feed.id,
                    url: feed.url,
                    etag: feed.etag,
                    lastModified: feed.lastModified
                )
            )
        }
        if !result.isEmpty {
            try? modelContext.save()
        }
        return result
    }
    
    public func applyNotModified(
        feedID: UUID,
        etag: String?,
        lastModified: String?,
        cacheTTL: TimeInterval?
    ) {
        guard let feed = fetchFeedModel(id: feedID) else { return }
        feed.etag = etag ?? feed.etag
        feed.lastModified = lastModified ?? feed.lastModified
        feed.consecutiveErrorCount = 0
        feed.isFailing = false
        feed.backoffUntilDate = nil
        feed.lastErrorMessage = nil
        feed.consecutiveNewItemsCount = 0
        feed.consecutiveEmptyCount += 1
        
        let (interval, nextDate) = FeedAdaptiveScheduler.computeNextInterval(
            currentInterval: feed.currentInterval,
            consecutiveNewItemsCount: feed.consecutiveNewItemsCount,
            consecutiveEmptyCount: feed.consecutiveEmptyCount,
            newItemsCount: 0,
            feedHintTTLMinutes: nil,
            cacheControlTTL: cacheTTL
        )
        feed.currentInterval = interval
        feed.nextFetchDate = nextDate
        try? modelContext.save()
    }
    
    public func applySuccess(
        feedID: UUID,
        payload: ParsedFeedPayload,
        etag: String?,
        lastModified: String?,
        permanentRedirectURL: URL?,
        cacheTTL: TimeInterval?
    ) {
        guard let feed = fetchFeedModel(id: feedID) else { return }
        
        // Only rewrite feed.url on permanent 301/308 redirects
        if let permanentRedirectURL = permanentRedirectURL, permanentRedirectURL != feed.url {
            feed.url = permanentRedirectURL
        }
        
        feed.etag = etag
        feed.lastModified = lastModified
        feed.consecutiveErrorCount = 0
        feed.isFailing = false
        feed.backoffUntilDate = nil
        feed.lastErrorMessage = nil
        feed.lastSuccessfulFetchDate = Date.now
        
        if feed.title == "Untitled Feed" || feed.title.isEmpty, let newTitle = payload.title {
            feed.title = newTitle
        }
        if feed.siteURL == nil { feed.siteURL = payload.siteURL }
        if feed.feedDescription == nil { feed.feedDescription = payload.feedDescription }
        
        let existingKeys = Set(feed.items.map { $0.deduplicationKey })
        var newParsedItems = payload.items.filter { !existingKeys.contains($0.deduplicationKey) }
        
        if !feed.isInitialFetchDone {
            if newParsedItems.count > feed.initialItemLimit {
                newParsedItems = Array(newParsedItems.prefix(feed.initialItemLimit))
            }
            feed.isInitialFetchDone = true
        }
        
        for p in newParsedItems {
            let item = FeedItem(
                deduplicationKey: p.deduplicationKey,
                guid: p.guid,
                title: p.title,
                link: p.link,
                summary: p.summary,
                contentHTML: p.contentHTML,
                author: p.author,
                publishedDate: p.publishedDate,
                imageURL: p.imageURL
            )
            item.feed = feed
            feed.items.append(item)
            modelContext.insert(item)
        }
        
        if !newParsedItems.isEmpty {
            feed.consecutiveNewItemsCount += 1
            feed.consecutiveEmptyCount = 0
        } else {
            feed.consecutiveNewItemsCount = 0
            feed.consecutiveEmptyCount += 1
        }
        
        let (interval, nextDate) = FeedAdaptiveScheduler.computeNextInterval(
            currentInterval: feed.currentInterval,
            consecutiveNewItemsCount: feed.consecutiveNewItemsCount,
            consecutiveEmptyCount: feed.consecutiveEmptyCount,
            newItemsCount: newParsedItems.count,
            feedHintTTLMinutes: payload.hintTTLMinutes,
            cacheControlTTL: cacheTTL
        )
        feed.currentInterval = interval
        feed.nextFetchDate = nextDate
        
        FeedRetentionManager.prune(feed: feed, modelContext: modelContext)
        try? modelContext.save()
    }
    
    public func applyPermanentFailure(feedID: UUID, statusCode: Int) {
        guard let feed = fetchFeedModel(id: feedID) else { return }
        feed.consecutiveErrorCount += 1
        feed.isFailing = true
        feed.lastErrorMessage = "HTTP \(statusCode) Permanent Error (Automatic retries paused)"
        // Do not retry 404 / 410 responses forever; pause until manual user retry
        feed.backoffUntilDate = Date.distantFuture
        feed.nextFetchDate = Date.distantFuture
        try? modelContext.save()
    }
    
    public func applyTransientFailure(feedID: UUID, errorMessage: String, retryAfter: TimeInterval?) {
        guard let feed = fetchFeedModel(id: feedID) else { return }
        feed.consecutiveErrorCount += 1
        feed.lastErrorMessage = errorMessage
        
        if feed.consecutiveErrorCount >= 5 {
            feed.isFailing = true
        }
        
        let (interval, nextDate) = FeedAdaptiveScheduler.computeBackoffInterval(
            consecutiveErrors: feed.consecutiveErrorCount,
            retryAfter: retryAfter
        )
        feed.backoffUntilDate = nextDate
        feed.nextFetchDate = nextDate
        feed.currentInterval = interval
        try? modelContext.save()
    }
    
    private func fetchFeedModel(id: UUID) -> Feed? {
        let descriptor = FetchDescriptor<Feed>(
            predicate: #Predicate<Feed> { feed in
                feed.id == id
            }
        )
        return try? modelContext.fetch(descriptor).first
    }
}

public actor FeedRefreshEngine {
    public static let shared = FeedRefreshEngine()
    public static let backgroundTaskIdentifier = "app.chinta.feedrefresh"
    
    private let networkClient: FeedNetworkClient
    private let parserService: FeedParserService
    private let rateLimiter: HostRateLimiter
    
    private var isRefreshingAll = false
    
    public init() {
        let limiter = HostRateLimiter(maxConcurrent: 4, maxPerHost: 1)
        self.rateLimiter = limiter
        self.networkClient = FeedNetworkClient(rateLimiter: limiter)
        self.parserService = FeedParserService()
    }
    
    // MARK: - Synchronous Background Task Registration (Must be called in App.init before launch finishes)
    nonisolated public static func registerBackgroundTask(container: ModelContainer) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Self.scheduleNextBackgroundRefresh()
            let refreshJob = Task {
                await FeedRefreshEngine.shared.refreshDueFeeds(container: container)
                refreshTask.setTaskCompleted(success: true)
            }
            refreshTask.expirationHandler = {
                refreshJob.cancel()
                refreshTask.setTaskCompleted(success: false)
            }
        }
    }
    
    nonisolated public static func scheduleNextBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date.now.addingTimeInterval(900)
        try? BGTaskScheduler.shared.submit(request)
    }
    
    // MARK: - App Launch & Foreground Refresh
    public func onAppLaunch(container: ModelContainer) async {
        Self.scheduleNextBackgroundRefresh()
        let store = FeedDataStore(modelContainer: container)
        await store.seedDefaultsIfNeeded()
        await refreshDueFeeds(container: container)
    }
    
    // MARK: - Pull to Refresh (Manual Override)
    public func pullToRefresh(feedID: UUID, container: ModelContainer) async {
        let store = FeedDataStore(modelContainer: container)
        guard let candidate = await store.fetchCandidate(feedID: feedID, isManualOverride: true) else {
            return
        }
        await refreshCandidate(candidate, store: store)
    }
    
    public func pullToRefreshAll(container: ModelContainer) async {
        guard !isRefreshingAll else { return }
        isRefreshingAll = true
        defer { isRefreshingAll = false }
        
        let store = FeedDataStore(modelContainer: container)
        let candidates = await store.fetchAllCandidates()
        guard !candidates.isEmpty else { return }
        
        await withTaskGroup(of: Void.self) { group in
            for candidate in candidates {
                group.addTask {
                    await self.refreshCandidate(candidate, store: store)
                }
            }
        }
    }
    
    // MARK: - Periodic / Due Feeds Refresh
    public func refreshDueFeeds(container: ModelContainer) async {
        let store = FeedDataStore(modelContainer: container)
        let dueCandidates = await store.fetchDueCandidates(now: Date.now)
        guard !dueCandidates.isEmpty else { return }
        
        await withTaskGroup(of: Void.self) { group in
            for candidate in dueCandidates {
                group.addTask {
                    await self.refreshCandidate(candidate, store: store)
                }
            }
        }
    }
    
    // MARK: - Single Feed Refresh Core Engine (Sendable-Safe)
    private func refreshCandidate(_ candidate: FeedFetchCandidate, store: FeedDataStore) async {
        do {
            let result = try await networkClient.fetchFeed(
                url: candidate.url,
                etag: candidate.etag,
                lastModified: candidate.lastModified
            )
            
            switch result {
            case .notModified(let newEtag, let newLastMod, let cacheTTL):
                await store.applyNotModified(
                    feedID: candidate.feedID,
                    etag: newEtag,
                    lastModified: newLastMod,
                    cacheTTL: cacheTTL
                )
                
            case .success(let data, let newEtag, let newLastMod, let permanentRedirectURL, let cacheTTL):
                let effectiveURL = permanentRedirectURL ?? candidate.url
                let payload = try parserService.parse(data: data, originalURL: effectiveURL)
                await store.applySuccess(
                    feedID: candidate.feedID,
                    payload: payload,
                    etag: newEtag,
                    lastModified: newLastMod,
                    permanentRedirectURL: permanentRedirectURL,
                    cacheTTL: cacheTTL
                )
                
            case .permanentError(let statusCode):
                await store.applyPermanentFailure(feedID: candidate.feedID, statusCode: statusCode)
                
            case .rateLimited(let retryAfter):
                await store.applyTransientFailure(
                    feedID: candidate.feedID,
                    errorMessage: "HTTP 429 Too Many Requests",
                    retryAfter: retryAfter
                )
                
            case .serverError(let statusCode, let retryAfter):
                await store.applyTransientFailure(
                    feedID: candidate.feedID,
                    errorMessage: "HTTP \(statusCode) Server Error",
                    retryAfter: retryAfter
                )
                
            case .clientError(let statusCode):
                await store.applyTransientFailure(
                    feedID: candidate.feedID,
                    errorMessage: "HTTP \(statusCode) Client Error",
                    retryAfter: nil
                )
            }
            
        } catch is CancellationError {
            return
        } catch {
            await store.applyTransientFailure(
                feedID: candidate.feedID,
                errorMessage: error.localizedDescription,
                retryAfter: nil
            )
        }
    }
}
