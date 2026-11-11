import Foundation

public struct FeedAdaptiveScheduler {
    public static let minimumInterval: TimeInterval = 900    // 15 minutes
    public static let maximumInterval: TimeInterval = 21600  // 6 hours
    
    public static func computeNextInterval(
        feed: Feed,
        newItemsCount: Int,
        feedHintTTLMinutes: Int?,
        cacheControlTTL: TimeInterval?
    ) -> (newInterval: TimeInterval, nextDate: Date) {
        var interval = feed.currentInterval
        
        // 1. Adaptive Cadence Streaks
        if newItemsCount > 0 {
            let successStreak = feed.consecutiveNewItemsCount + 1
            if successStreak >= 3 {
                interval = max(Self.minimumInterval, interval * 0.75)
            }
        } else {
            let emptyStreak = feed.consecutiveEmptyCount + 1
            if emptyStreak >= 3 {
                interval = min(Self.maximumInterval, interval * 1.5)
            }
        }
        
        // 2. Feed Hints: <ttl>, <sy:update*>, Cache-Control
        var candidateHintSeconds: TimeInterval? = nil
        if let hintMinutes = feedHintTTLMinutes, hintMinutes > 0 {
            candidateHintSeconds = TimeInterval(hintMinutes * 60)
        }
        if let cacheTTL = cacheControlTTL, cacheTTL > 0 {
            if let existing = candidateHintSeconds {
                candidateHintSeconds = max(existing, cacheTTL)
            } else {
                candidateHintSeconds = cacheTTL
            }
        }
        
        // "Use the larger of the hint and my minimum interval."
        if let hint = candidateHintSeconds {
            let respectedHint = max(hint, Self.minimumInterval)
            interval = min(Self.maximumInterval, max(interval, respectedHint))
        }
        
        // Hard boundary clamp
        interval = min(Self.maximumInterval, max(Self.minimumInterval, interval))
        
        let nextDate = Date.now.addingTimeInterval(interval)
        return (interval, nextDate)
    }
    
    public static func computeBackoffInterval(consecutiveErrors: Int, retryAfter: TimeInterval?) -> (interval: TimeInterval, nextDate: Date) {
        if let retry = retryAfter, retry > 0 {
            let bounded = min(Self.maximumInterval, max(Self.minimumInterval, retry))
            return (bounded, Date.now.addingTimeInterval(bounded))
        }
        
        // Exponential backoff: 15m * (1.5 ^ errors) capped at 6h
        let exponent = min(Double(consecutiveErrors), 5.0)
        let backoff = Self.minimumInterval * pow(1.5, exponent)
        let clamped = min(Self.maximumInterval, max(Self.minimumInterval, backoff))
        return (clamped, Date.now.addingTimeInterval(clamped))
    }
}
