import Foundation
import SwiftData
import BackgroundTasks

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
    
    // MARK: - App Launch & Foreground Refresh
    public func onAppLaunch(modelContext: ModelContext) async {
        registerBackgroundTask()
        await refreshDueFeeds(modelContext: modelContext)
    }
    
    // MARK: - Pull to Refresh (Manual Override)
    public func pullToRefresh(feed: Feed, modelContext: ModelContext) async {
        await refreshSingleFeed(feed: feed, isManualOverride: true, modelContext: modelContext)
    }
    
    public func pullToRefreshAll(modelContext: ModelContext) async {
        guard !isRefreshingAll else { return }
        isRefreshingAll = true
        defer { isRefreshingAll = false }
        
        let descriptor = FetchDescriptor<Feed>()
        guard let feeds = try? modelContext.fetch(descriptor) else { return }
        
        await withTaskGroup(of: Void.self) { group in
            for feed in feeds {
                group.addTask {
                    await self.refreshSingleFeed(feed: feed, isManualOverride: true, modelContext: modelContext)
                }
            }
        }
    }
    
    // MARK: - Periodic / Due Feeds Refresh
    public func refreshDueFeeds(modelContext: ModelContext) async {
        let now = Date.now
        let descriptor = FetchDescriptor<Feed>(
            predicate: #Predicate<Feed> { feed in
                feed.nextFetchDate <= now && (feed.backoffUntilDate == nil || feed.backoffUntilDate! <= now)
            }
        )
        
        guard let dueFeeds = try? modelContext.fetch(descriptor), !dueFeeds.isEmpty else { return }
        
        await withTaskGroup(of: Void.self) { group in
            for feed in dueFeeds {
                group.addTask {
                    await self.refreshSingleFeed(feed: feed, isManualOverride: false, modelContext: modelContext)
                }
            }
        }
    }
    
    // MARK: - Single Feed Refresh Core Engine
    private func refreshSingleFeed(feed: Feed, isManualOverride: Bool, modelContext: ModelContext) async {
        let now = Date.now
        
        if !isManualOverride, let backoff = feed.backoffUntilDate, backoff > now {
            return
        }
        
        feed.lastFetchDate = now
        
        do {
            let result = try await networkClient.fetchFeed(
                url: feed.url,
                etag: feed.etag,
                lastModified: feed.lastModified
            )
            
            switch result {
            case .notModified(let newEtag, let newLastMod, let cacheTTL):
                handleNotModified(feed: feed, etag: newEtag, lastModified: newLastMod, cacheTTL: cacheTTL)
                
            case .success(let data, let newEtag, let newLastMod, let redirectedURL, let cacheTTL):
                try handleSuccess(
                    feed: feed,
                    data: data,
                    etag: newEtag,
                    lastModified: newLastMod,
                    redirectedURL: redirectedURL,
                    cacheTTL: cacheTTL,
                    modelContext: modelContext
                )
                
            case .rateLimited(let retryAfter):
                handleFailure(feed: feed, errorMessage: "HTTP 429 Too Many Requests", retryAfter: retryAfter)
                
            case .serverError(let statusCode, let retryAfter):
                handleFailure(feed: feed, errorMessage: "HTTP \(statusCode) Server Error", retryAfter: retryAfter)
                
            case .clientError(let statusCode):
                handleFailure(feed: feed, errorMessage: "HTTP \(statusCode) Client Error", retryAfter: nil)
            }
            
        } catch {
            handleFailure(feed: feed, errorMessage: error.localizedDescription, retryAfter: nil)
        }
        
        try? modelContext.save()
    }
    
    // MARK: - Handling 304 Not Modified
    private func handleNotModified(feed: Feed, etag: String?, lastModified: String?, cacheTTL: TimeInterval?) {
        feed.etag = etag ?? feed.etag
        feed.lastModified = lastModified ?? feed.lastModified
        feed.consecutiveErrorCount = 0
        feed.isFailing = false
        feed.backoffUntilDate = nil
        feed.lastErrorMessage = nil
        feed.consecutiveNewItemsCount = 0
        feed.consecutiveEmptyCount += 1
        
        let (interval, nextDate) = FeedAdaptiveScheduler.computeNextInterval(
            feed: feed,
            newItemsCount: 0,
            feedHintTTLMinutes: nil,
            cacheControlTTL: cacheTTL
        )
        feed.currentInterval = interval
        feed.nextFetchDate = nextDate
    }
    
    // MARK: - Handling 200 OK & Parsing
    private func handleSuccess(
        feed: Feed,
        data: Data,
        etag: String?,
        lastModified: String?,
        redirectedURL: URL?,
        cacheTTL: TimeInterval?,
        modelContext: ModelContext
    ) throws {
        if let redirectedURL = redirectedURL, redirectedURL != feed.url {
            feed.url = redirectedURL
        }
        
        feed.etag = etag
        feed.lastModified = lastModified
        feed.consecutiveErrorCount = 0
        feed.isFailing = false
        feed.backoffUntilDate = nil
        feed.lastErrorMessage = nil
        feed.lastSuccessfulFetchDate = Date.now
        
        let payload = try parserService.parse(data: data, originalURL: feed.url)
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
            feed: feed,
            newItemsCount: newParsedItems.count,
            feedHintTTLMinutes: payload.hintTTLMinutes,
            cacheControlTTL: cacheTTL
        )
        feed.currentInterval = interval
        feed.nextFetchDate = nextDate
        
        FeedRetentionManager.prune(feed: feed, modelContext: modelContext)
    }
    
    // MARK: - Handling Errors & 5-Strike Failing Mode
    private func handleFailure(feed: Feed, errorMessage: String, retryAfter: TimeInterval?) {
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
    }
    
    // MARK: - Background Refresh (BGAppRefreshTask)
    public func registerBackgroundTask() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else { return }
            self.handleBackgroundRefresh(task: refreshTask)
        }
        scheduleNextBackgroundRefresh()
    }
    
    public func scheduleNextBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date.now.addingTimeInterval(900)
        try? BGTaskScheduler.shared.submit(request)
    }
    
    private func handleBackgroundRefresh(task: BGAppRefreshTask) {
        scheduleNextBackgroundRefresh()
        
        let container = try? ModelContainer(for: Feed.self, FeedItem.self)
        guard let context = container.map({ ModelContext($0) }) else {
            task.setTaskCompleted(success: false)
            return
        }
        
        let refreshJob = Task {
            await self.refreshDueFeeds(modelContext: context)
            task.setTaskCompleted(success: true)
        }
        
        task.expirationHandler = {
            refreshJob.cancel()
        }
    }
}
