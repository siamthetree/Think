import Foundation

public enum FeedNetworkResult {
    case notModified(etag: String?, lastModified: String?, cacheControlTTL: TimeInterval?)
    case success(data: Data, etag: String?, lastModified: String?, redirectedURL: URL?, cacheControlTTL: TimeInterval?)
    case rateLimited(retryAfter: TimeInterval)
    case serverError(statusCode: Int, retryAfter: TimeInterval?)
    case clientError(statusCode: Int)
}

public actor FeedNetworkClient {
    private let session: URLSession
    private let rateLimiter: HostRateLimiter
    private let userAgent: String
    private let defaultTimeout: TimeInterval
    
    public init(
        rateLimiter: HostRateLimiter,
        userAgent: String = "ChintaPaperPress/2.0 (iOS; RSS Refresh Engine; +https://chinta.app)",
        timeout: TimeInterval = 15.0
    ) {
        self.rateLimiter = rateLimiter
        self.userAgent = userAgent
        self.defaultTimeout = timeout
        
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout * 2
        config.httpShouldSetCookies = false
        self.session = URLSession(configuration: config)
    }
    
    public func fetchFeed(
        url: URL,
        etag: String?,
        lastModified: String?
    ) async throws -> FeedNetworkResult {
        await rateLimiter.acquire(for: url)
        defer {
            Task { [rateLimiter] in
                await rateLimiter.release(for: url)
            }
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml;q=0.9, */*;q=0.8", forHTTPHeaderField: "Accept")
        
        if let etag = etag, !etag.isEmpty {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }
        if let lastModified = lastModified, !lastModified.isEmpty {
            request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since")
        }
        
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        
        let statusCode = httpResponse.statusCode
        let headers = httpResponse.allHeaderFields
        
        let newEtag = headers["Etag"] as? String ?? headers["ETag"] as? String
        let newLastModified = headers["Last-Modified"] as? String ?? headers["last-modified"] as? String
        let cacheTTL = parseCacheControlMaxAge(headers["Cache-Control"] as? String)
        
        // Check for 301 Permanent Redirect
        var redirectedURL: URL? = nil
        if let finalURL = httpResponse.url, finalURL != url {
            redirectedURL = finalURL
        }
        
        switch statusCode {
        case 304:
            return .notModified(
                etag: newEtag ?? etag,
                lastModified: newLastModified ?? lastModified,
                cacheControlTTL: cacheTTL
            )
            
        case 200...299:
            return .success(
                data: data,
                etag: newEtag,
                lastModified: newLastModified,
                redirectedURL: redirectedURL,
                cacheControlTTL: cacheTTL
            )
            
        case 429:
            let retrySeconds = parseRetryAfter(headers["Retry-After"] as? String) ?? 300
            return .rateLimited(retryAfter: retrySeconds)
            
        case 500...599:
            let retrySeconds = parseRetryAfter(headers["Retry-After"] as? String)
            return .serverError(statusCode: statusCode, retryAfter: retrySeconds)
            
        default:
            return .clientError(statusCode: statusCode)
        }
    }
    
    private func parseCacheControlMaxAge(_ header: String?) -> TimeInterval? {
        guard let header = header else { return nil }
        let components = header.components(separatedBy: ",")
        for comp in components {
            let trimmed = comp.trimmingCharacters(in: .whitespaces)
            if trimmed.lowercased().hasPrefix("max-age=") {
                let valStr = trimmed.dropFirst("max-age=".count)
                if let seconds = Double(valStr) {
                    return seconds
                }
            }
        }
        return nil
    }
    
    private func parseRetryAfter(_ header: String?) -> TimeInterval? {
        guard let header = header?.trimmingCharacters(in: .whitespaces), !header.isEmpty else {
            return nil
        }
        
        // 1. Numeric seconds
        if let seconds = Double(header) {
            return max(seconds, 30)
        }
        
        // 2. HTTP Date format (RFC 2822 / 1123)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
        if let targetDate = formatter.date(from: header) {
            let interval = targetDate.timeIntervalSinceNow
            return max(interval, 30)
        }
        
        return nil
    }
}
