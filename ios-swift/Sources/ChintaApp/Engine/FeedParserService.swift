import Foundation
import CryptoKit

public struct ParsedFeedItem: Sendable {
    public let deduplicationKey: String
    public let guid: String?
    public let title: String
    public let link: URL?
    public let summary: String?
    public let contentHTML: String?
    public let author: String?
    public let publishedDate: Date
    public let imageURL: URL?
}

public struct ParsedFeedPayload: Sendable {
    public let title: String?
    public let siteURL: URL?
    public let feedDescription: String?
    public let hintTTLMinutes: Int?
    public let items: [ParsedFeedItem]
}

public final class FeedParserService: Sendable {
    /// Deterministic fallback base epoch (2000-01-01T00:00:00Z) so undated items never appear as brand-new breaking news
    public static let undatedFallbackEpoch: TimeInterval = 946684800

    private static let exactTrackingParams: Set<String> = [
        "fbclid", "gclid", "dclid", "msclkid", "twclid", "igshid",
        "mc_cid", "mc_eid", "_hsenc", "_hsmi", "vero_id",
        "oly_enc_id", "oly_anon_id", "rb_clickid", "s_kwcid", "mkt_tok"
    ]

    private static let knownTrackerHostSubstrings: [String] = [
        "feeds.feedburner.com/~r/",
        "substack.com/o/",
        "list-manage.com/track/",
        "doubleclick.net",
        "google-analytics.com",
        "pixel.wp.com",
        "convertkit-mail.com"
    ]

    public init() {}

    public static func stripTrackingParams(_ rawURLString: String?) -> String? {
        guard let raw = rawURLString?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        guard var components = URLComponents(string: raw) else {
            return raw
        }
        if let queryItems = components.queryItems, !queryItems.isEmpty {
            let filtered = queryItems.filter { item in
                let lower = item.name.lowercased()
                if lower.hasPrefix("utm_") { return false }
                if exactTrackingParams.contains(lower) { return false }
                return true
            }
            components.queryItems = filtered.isEmpty ? nil : filtered
        }
        return components.url?.absoluteString ?? raw
    }

    public static func isTrackerURL(_ rawURLString: String?) -> Bool {
        guard let raw = rawURLString?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !raw.isEmpty else {
            return false
        }
        for pattern in knownTrackerHostSubstrings {
            if raw.contains(pattern) {
                return true
            }
        }
        return false
    }

    public static func sanitizeHTML(_ rawHTML: String?) -> String? {
        guard var html = rawHTML, !html.isEmpty else {
            return rawHTML
        }

        // 1. Strip paired executable and external resource tags
        let pairedForbiddenTags = ["script", "iframe", "object", "embed", "form", "style"]
        for tag in pairedForbiddenTags {
            let pattern = "<\(tag)\\b[^>]*>[\\s\\S]*?<\\/\(tag)>"
            html = html.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
        }

        // 2. Strip standalone forbidden tags
        let standalonePattern = "<\\/?(?:script|iframe|object|embed|form|input|style|link|meta)\\b[^>]*\\/?>"
        html = html.replacingOccurrences(of: standalonePattern, with: "", options: [.regularExpression, .caseInsensitive])

        // 3. Strip inline on* event attributes
        let inlineEventQuotedPattern = "\\s+on[a-zA-Z0-9_-]+\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)"
        html = html.replacingOccurrences(of: inlineEventQuotedPattern, with: "", options: [.regularExpression, .caseInsensitive])

        // 4. Filter <img> tags for 1x1/0x0 dimensions, hidden styles, and tracker URLs, and enforce referrerpolicy="no-referrer"
        if let imgRegex = try? NSRegularExpression(pattern: "<img\\b[^>]*>", options: [.caseInsensitive]) {
            let nsString = html as NSString
            let matches = imgRegex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))
            var rebuilt = ""
            var lastLocation = 0
            for match in matches {
                rebuilt += nsString.substring(with: NSRange(location: lastLocation, length: match.range.location - lastLocation))
                let tagText = nsString.substring(with: match.range)
                if !shouldBlockImageTag(tagText) {
                    rebuilt += enforceNoReferrerOnMediaTag(tagText)
                }
                lastLocation = match.range.location + match.range.length
            }
            rebuilt += nsString.substring(from: lastLocation)
            html = rebuilt
        }

        // 5. Filter <a> tags pointing to known tracker hosts, strip tracking params, and enforce rel="noopener noreferrer" referrerpolicy="no-referrer"
        if let anchorRegex = try? NSRegularExpression(pattern: "<a\\b[^>]*>[\\s\\S]*?<\\/a>", options: [.caseInsensitive]) {
            let nsString = html as NSString
            let matches = anchorRegex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))
            var rebuilt = ""
            var lastLocation = 0
            for match in matches {
                rebuilt += nsString.substring(with: NSRange(location: lastLocation, length: match.range.location - lastLocation))
                let fullAnchor = nsString.substring(with: match.range)
                rebuilt += sanitizeAnchorBlock(fullAnchor)
                lastLocation = match.range.location + match.range.length
            }
            rebuilt += nsString.substring(from: lastLocation)
            html = rebuilt
        }

        // 6. Enforce referrerpolicy="no-referrer" on <video> tags
        if let videoRegex = try? NSRegularExpression(pattern: "<video\\b[^>]*>", options: [.caseInsensitive]) {
            let nsString = html as NSString
            let matches = videoRegex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))
            var rebuilt = ""
            var lastLocation = 0
            for match in matches {
                rebuilt += nsString.substring(with: NSRange(location: lastLocation, length: match.range.location - lastLocation))
                let videoTag = nsString.substring(with: match.range)
                rebuilt += enforceNoReferrerOnMediaTag(videoTag)
                lastLocation = match.range.location + match.range.length
            }
            rebuilt += nsString.substring(from: lastLocation)
            html = rebuilt
        }

        return html
    }

    private static func extractAttribute(_ name: String, in tag: String) -> String? {
        let pattern = "\\b\(name)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }
        let nsTag = tag as NSString
        guard let match = regex.firstMatch(in: tag, options: [], range: NSRange(location: 0, length: nsTag.length)) else {
            return nil
        }
        for groupIndex in 1...3 {
            let range = match.range(at: groupIndex)
            if range.location != NSNotFound {
                return nsTag.substring(with: range)
            }
        }
        return nil
    }

    private static func shouldBlockImageTag(_ tag: String) -> Bool {
        if let src = extractAttribute("src", in: tag) {
            let trimmed = src.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty || isTrackerURL(trimmed) {
                return true
            }
        } else {
            return true
        }

        if let width = extractAttribute("width", in: tag)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           ["0", "1", "0px", "1px"].contains(width) {
            return true
        }

        if let height = extractAttribute("height", in: tag)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           ["0", "1", "0px", "1px"].contains(height) {
            return true
        }

        if let style = extractAttribute("style", in: tag)?.lowercased().replacingOccurrences(of: " ", with: "") {
            if style.contains("display:none") ||
               style.contains("visibility:hidden") ||
               style.contains("opacity:0") ||
               style.contains("width:1px") ||
               style.contains("width:0px") ||
               style.contains("height:1px") ||
               style.contains("height:0px") {
                return true
            }
        }

        return false
    }

    private static func enforceNoReferrerOnMediaTag(_ tag: String) -> String {
        var cleaned = tag.replacingOccurrences(
            of: "\\s+referrerpolicy\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        if let src = extractAttribute("src", in: cleaned), let sanitizedSrc = stripTrackingParams(src), sanitizedSrc != src {
            cleaned = cleaned.replacingOccurrences(of: src, with: sanitizedSrc)
        }
        if cleaned.hasSuffix("/>") {
            return String(cleaned.dropLast(2)) + " referrerpolicy=\"no-referrer\" />"
        } else if cleaned.hasSuffix(">") {
            return String(cleaned.dropLast(1)) + " referrerpolicy=\"no-referrer\">"
        }
        return cleaned
    }

    private static func sanitizeAnchorBlock(_ anchorHTML: String) -> String {
        guard let openTagRange = anchorHTML.range(of: "<a\\b[^>]*>", options: [.regularExpression, .caseInsensitive]) else {
            return anchorHTML
        }
        let openTag = String(anchorHTML[openTagRange])
        if let href = extractAttribute("href", in: openTag) {
            if isTrackerURL(href) || href.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().hasPrefix("javascript:") {
                // Unwrap tracker link text or drop if empty
                let inner = anchorHTML
                    .replacingOccurrences(of: "^<a\\b[^>]*>", with: "", options: [.regularExpression, .caseInsensitive])
                    .replacingOccurrences(of: "<\\/a>$", with: "", options: [.regularExpression, .caseInsensitive])
                return inner
            }
            var updatedOpenTag = openTag
            if let cleanHref = stripTrackingParams(href), cleanHref != href {
                updatedOpenTag = updatedOpenTag.replacingOccurrences(of: href, with: cleanHref)
            }
            updatedOpenTag = updatedOpenTag.replacingOccurrences(
                of: "\\s+rel\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)",
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            updatedOpenTag = updatedOpenTag.replacingOccurrences(
                of: "\\s+referrerpolicy\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)",
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
            if updatedOpenTag.hasSuffix(">") {
                updatedOpenTag = String(updatedOpenTag.dropLast(1)) + " rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">"
            }
            return anchorHTML.replacingCharacters(in: openTagRange, with: updatedOpenTag)
        }
        return anchorHTML
    }

    public func parse(data: Data, originalURL: URL) throws -> ParsedFeedPayload {
        // 1. JSON Feed Detection
        if let jsonObject = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let version = jsonObject["version"] as? String, version.contains("jsonfeed") {
            return try parseJSONFeed(jsonObject: jsonObject, originalURL: originalURL)
        }

        // 2. XML Parser (RSS 2.0 / Atom)
        let xmlParser = XMLFeedDelegate(originalURL: originalURL)
        let parser = XMLParser(data: data)
        parser.delegate = xmlParser
        guard parser.parse() else {
            throw parser.parserError ?? URLError(.cannotParseResponse)
        }

        return xmlParser.resultPayload
    }

    private func parseJSONFeed(jsonObject: [String: Any], originalURL: URL) throws -> ParsedFeedPayload {
        let title = jsonObject["title"] as? String
        let siteURLStr = Self.stripTrackingParams(jsonObject["home_page_url"] as? String)
        let desc = jsonObject["description"] as? String

        var parsedItems: [ParsedFeedItem] = []
        let rawItems = jsonObject["items"] as? [[String: Any]] ?? []

        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallbackISO = ISO8601DateFormatter()

        for (index, itemDict) in rawItems.enumerated() {
            let id = itemDict["id"] as? String
            let itemTitle = (itemDict["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Untitled"
            let urlStr = Self.stripTrackingParams(itemDict["url"] as? String)
            let link = urlStr != nil ? URL(string: urlStr!) : nil
            let summary = Self.sanitizeHTML(itemDict["summary"] as? String)
            let rawContentHTML = itemDict["content_html"] as? String ?? itemDict["content_text"] as? String
            let contentHTML = Self.sanitizeHTML(rawContentHTML)
            let authorName = (itemDict["author"] as? [String: Any])?["name"] as? String
            let rawImageStr = itemDict["image"] as? String ?? itemDict["banner_image"] as? String
            let imageStr = Self.isTrackerURL(rawImageStr) ? nil : Self.stripTrackingParams(rawImageStr)

            let fallbackDate = Date(timeIntervalSince1970: Self.undatedFallbackEpoch - Double(index * 60))
            var pubDate = fallbackDate
            if let dateStr = itemDict["date_published"] as? String {
                pubDate = isoFormatter.date(from: dateStr) ?? fallbackISO.date(from: dateStr) ?? fallbackDate
            }

            let dedupKey = makeDeduplicationKey(guid: id, link: link?.absoluteString, title: itemTitle, date: pubDate)

            parsedItems.append(ParsedFeedItem(
                deduplicationKey: dedupKey,
                guid: id,
                title: itemTitle,
                link: link,
                summary: summary,
                contentHTML: contentHTML,
                author: authorName,
                publishedDate: min(pubDate, Date.now),
                imageURL: imageStr != nil ? URL(string: imageStr!) : nil
            ))
        }

        return ParsedFeedPayload(
            title: title,
            siteURL: siteURLStr != nil ? URL(string: siteURLStr!) : nil,
            feedDescription: desc,
            hintTTLMinutes: nil,
            items: parsedItems
        )
    }

    public static func generateDeduplicationKey(guid: String?, link: String?, title: String, date: Date) -> String {
        // Priority 1: Explicit unique GUID / ID
        if let guid = guid?.trimmingCharacters(in: .whitespacesAndNewlines), !guid.isEmpty {
            return "guid:\(guid)"
        }

        // Priority 2: Canonical Article Link
        if let link = link?.trimmingCharacters(in: .whitespacesAndNewlines), !link.isEmpty {
            return "link:\(link)"
        }

        // Priority 3: SHA256 of Normalized Title + Published Epoch
        let rawInput = "\(title.lowercased())|\(Int(date.timeIntervalSince1970))"
        let hash = SHA256.hash(data: Data(rawInput.utf8))
        let hashString = hash.compactMap { String(format: "%02x", $0) }.joined()
        return "hash:\(hashString)"
    }

    private func makeDeduplicationKey(guid: String?, link: String?, title: String, date: Date) -> String {
        FeedParserService.generateDeduplicationKey(guid: guid, link: link, title: title, date: date)
    }
}

// MARK: - XML Parser Delegate (RSS 2.0 & Atom)
private final class XMLFeedDelegate: NSObject, XMLParserDelegate {
    private let originalURL: URL
    private var isAtom = false
    private var inItemOrEntry = false

    private var currentElement = ""
    private var currentText = ""

    // Channel / Feed level fields
    private var channelTitle: String?
    private var channelLink: String?
    private var channelDesc: String?
    private var ttlMinutes: Int?
    private var syUpdatePeriod: String?
    private var syUpdateFrequency: Int?

    // Item / Entry level fields
    private var itemGuid: String?
    private var itemTitle: String = ""
    private var itemLink: String?
    private var itemSummary: String?
    private var itemContent: String?
    private var itemAuthor: String?
    private var itemDateStr: String?
    private var itemImageURLStr: String?

    private var parsedItems: [ParsedFeedItem] = []

    init(originalURL: URL) {
        self.originalURL = originalURL
    }

    var resultPayload: ParsedFeedPayload {
        var calculatedTTL = ttlMinutes
        if calculatedTTL == nil, let period = syUpdatePeriod?.lowercased() {
            let freq = max(1, syUpdateFrequency ?? 1)
            switch period {
            case "hourly": calculatedTTL = (60 / freq)
            case "daily": calculatedTTL = (1440 / freq)
            case "weekly": calculatedTTL = (10080 / freq)
            default: break
            }
        }

        let cleanChannelLink = FeedParserService.stripTrackingParams(channelLink)

        return ParsedFeedPayload(
            title: channelTitle,
            siteURL: cleanChannelLink != nil ? URL(string: cleanChannelLink!) : nil,
            feedDescription: channelDesc,
            hintTTLMinutes: calculatedTTL,
            items: parsedItems
        )
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        currentElement = elementName.lowercased()
        currentText = ""

        if currentElement == "feed" {
            isAtom = true
        }

        if currentElement == "item" || currentElement == "entry" {
            inItemOrEntry = true
            itemGuid = nil
            itemTitle = ""
            itemLink = nil
            itemSummary = nil
            itemContent = nil
            itemAuthor = nil
            itemDateStr = nil
            itemImageURLStr = nil
        }

        if inItemOrEntry && currentElement == "link" {
            if let href = attributeDict["href"] {
                let rel = attributeDict["rel"] ?? "alternate"
                if rel == "alternate" || itemLink == nil {
                    itemLink = FeedParserService.stripTrackingParams(href)
                }
            }
        }

        if inItemOrEntry && (currentElement == "enclosure" || currentElement == "media:content") {
            if let url = attributeDict["url"], (attributeDict["type"]?.contains("image") == true || url.hasSuffix(".jpg") || url.hasSuffix(".png")) {
                if !FeedParserService.isTrackerURL(url) {
                    itemImageURLStr = FeedParserService.stripTrackingParams(url)
                }
            }
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        currentText += string
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        if let str = String(data: CDATABlock, encoding: .utf8) {
            currentText += str
        }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let tag = elementName.lowercased()
        let trimmed = currentText.trimmingCharacters(in: .whitespacesAndNewlines)

        if !inItemOrEntry {
            switch tag {
            case "title": channelTitle = channelTitle ?? trimmed
            case "link": channelLink = channelLink ?? FeedParserService.stripTrackingParams(trimmed)
            case "description", "subtitle": channelDesc = channelDesc ?? trimmed
            case "ttl": ttlMinutes = Int(trimmed)
            case "sy:updateperiod": syUpdatePeriod = trimmed
            case "sy:updatefrequency": syUpdateFrequency = Int(trimmed)
            default: break
            }
            return
        }

        switch tag {
        case "title":
            itemTitle = trimmed
        case "guid", "id":
            itemGuid = trimmed
        case "link" where !isAtom:
            if itemLink == nil { itemLink = FeedParserService.stripTrackingParams(trimmed) }
        case "description", "summary":
            itemSummary = FeedParserService.sanitizeHTML(trimmed)
        case "content:encoded", "content":
            itemContent = FeedParserService.sanitizeHTML(trimmed)
        case "author", "dc:creator":
            itemAuthor = trimmed
        case "pubdate", "published", "updated", "dc:date":
            if itemDateStr == nil { itemDateStr = trimmed }
        case "item", "entry":
            inItemOrEntry = false
            finalizeCurrentItem()
        default:
            break
        }
    }

    private func finalizeCurrentItem() {
        let resolvedTitle = itemTitle.isEmpty ? "Untitled Story" : itemTitle
        let rawResolvedLink = itemLink != nil ? URL(string: itemLink!, relativeTo: originalURL)?.absoluteURL.absoluteString : nil
        let cleanLinkStr = FeedParserService.stripTrackingParams(rawResolvedLink)
        let resolvedLink = cleanLinkStr != nil ? URL(string: cleanLinkStr!) : nil
        let fallbackDate = Date(timeIntervalSince1970: FeedParserService.undatedFallbackEpoch - Double(parsedItems.count * 60))
        let resolvedDate = parseDate(itemDateStr) ?? fallbackDate

        let dedupKey = FeedParserService.generateDeduplicationKey(
            guid: itemGuid,
            link: resolvedLink?.absoluteString,
            title: resolvedTitle,
            date: resolvedDate
        )

        var resolvedImageURL: URL? = nil
        if let rawImg = itemImageURLStr,
           let absImg = URL(string: rawImg, relativeTo: originalURL)?.absoluteURL.absoluteString,
           !FeedParserService.isTrackerURL(absImg),
           let cleanImg = FeedParserService.stripTrackingParams(absImg) {
            resolvedImageURL = URL(string: cleanImg)
        }

        let item = ParsedFeedItem(
            deduplicationKey: dedupKey,
            guid: itemGuid,
            title: resolvedTitle,
            link: resolvedLink,
            summary: itemSummary,
            contentHTML: itemContent ?? itemSummary,
            author: itemAuthor,
            publishedDate: min(resolvedDate, Date.now),
            imageURL: resolvedImageURL
        )
        parsedItems.append(item)
    }

    private func parseDate(_ dateStr: String?) -> Date? {
        guard let dateStr = dateStr?.trimmingCharacters(in: .whitespacesAndNewlines), !dateStr.isEmpty else {
            return nil
        }

        let rfc822Formatter = DateFormatter()
        rfc822Formatter.locale = Locale(identifier: "en_US_POSIX")
        rfc822Formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        if let d = rfc822Formatter.date(from: dateStr) { return d }

        rfc822Formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
        if let d = rfc822Formatter.date(from: dateStr) { return d }

        rfc822Formatter.dateFormat = "dd MMM yyyy HH:mm:ss Z"
        if let d = rfc822Formatter.date(from: dateStr) { return d }

        let isoFormatter = ISO8601DateFormatter()
        if let d = isoFormatter.date(from: dateStr) { return d }

        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return isoFormatter.date(from: dateStr)
    }
}
