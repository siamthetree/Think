import Foundation

public enum FeedNetworkResult: Sendable {
    case notModified(etag: String?, lastModified: String?, cacheControlTTL: TimeInterval?)
    case success(data: Data, etag: String?, lastModified: String?, permanentRedirectURL: URL?, cacheControlTTL: TimeInterval?)
    case rateLimited(retryAfter: TimeInterval)
    case serverError(statusCode: Int, retryAfter: TimeInterval?)
    case permanentError(statusCode: Int)
    case clientError(statusCode: Int)
}

private final class RedirectTrackingDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var sawRedirect = false
    private var allRedirectsPermanent = true

    var shouldPersistRedirectURL: Bool {
        lock.lock()
        defer { lock.unlock() }
        return sawRedirect && allRedirectsPermanent
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        lock.lock()
        sawRedirect = true
        if response.statusCode != 301 && response.statusCode != 308 {
            allRedirectsPermanent = false
        }
        lock.unlock()

        var sanitizedRedirect = request
        sanitizedRedirect.httpShouldHandleCookies = false
        sanitizedRedirect.setValue(nil, forHTTPHeaderField: "Referer")
        sanitizedRedirect.setValue(FeedNetworkClient.genericStaticUserAgent, forHTTPHeaderField: "User-Agent")
        completionHandler(sanitizedRedirect)
    }
}

public actor FeedNetworkClient {
    /// Generic static User-Agent string so publishers cannot fingerprint the user's device model or OS version
    public static let genericStaticUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

    private let sessionConfig: URLSessionConfiguration
    private let rateLimiter: HostRateLimiter
    private let userAgent: String
    private let defaultTimeout: TimeInterval

    public init(
        rateLimiter: HostRateLimiter,
        userAgent: String = FeedNetworkClient.genericStaticUserAgent,
        timeout: TimeInterval = 15.0
    ) {
        self.rateLimiter = rateLimiter
        self.userAgent = FeedNetworkClient.genericStaticUserAgent
        self.defaultTimeout = timeout

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout * 2
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        self.sessionConfig = config
    }

    public func fetchFeed(
        url: URL,
        etag: String?,
        lastModified: String?
    ) async throws -> FeedNetworkResult {
        try await rateLimiter.acquire(for: url)
        defer {
            Task { [rateLimiter] in
                await rateLimiter.release(for: url)
            }
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.httpShouldHandleCookies = false
        request.setValue(nil, forHTTPHeaderField: "Referer")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml;q=0.9, */*;q=0.8", forHTTPHeaderField: "Accept")

        if let etag = etag, !etag.isEmpty {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }
        if let lastModified = lastModified, !lastModified.isEmpty {
            request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since")
        }

        let redirectDelegate = RedirectTrackingDelegate()
        let session = URLSession(configuration: sessionConfig, delegate: redirectDelegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }

        let statusCode = httpResponse.statusCode
        let headers = httpResponse.allHeaderFields

        let newEtag = headers["Etag"] as? String ?? headers["ETag"] as? String
        let newLastModified = headers["Last-Modified"] as? String ?? headers["last-modified"] as? String
        let cacheTTL = parseCacheControlMaxAge(headers["Cache-Control"] as? String)

        // Only persist feed.url when every redirect hop was a permanent 301 or 308 redirect (never on temporary 302/303/307)
        var permanentRedirectURL: URL? = nil
        if redirectDelegate.shouldPersistRedirectURL,
           let finalURL = httpResponse.url,
           finalURL != url {
            permanentRedirectURL = finalURL
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
                permanentRedirectURL: permanentRedirectURL,
                cacheControlTTL: cacheTTL
            )

        case 404, 410:
            return .permanentError(statusCode: statusCode)

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

        if let seconds = Double(header) {
            return max(seconds, 30)
        }

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
