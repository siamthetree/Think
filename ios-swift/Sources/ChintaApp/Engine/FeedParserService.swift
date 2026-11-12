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
    
    public init() {}
    
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
        let siteURLStr = jsonObject["home_page_url"] as? String
        let desc = jsonObject["description"] as? String
        
        var parsedItems: [ParsedFeedItem] = []
        let rawItems = jsonObject["items"] as? [[String: Any]] ?? []
        
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallbackISO = ISO8601DateFormatter()
        
        for (index, itemDict) in rawItems.enumerated() {
            let id = itemDict["id"] as? String
            let itemTitle = (itemDict["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Untitled"
            let urlStr = itemDict["url"] as? String
            let link = urlStr != nil ? URL(string: urlStr!) : nil
            let summary = itemDict["summary"] as? String
            let contentHTML = itemDict["content_html"] as? String ?? itemDict["content_text"] as? String
            let authorName = (itemDict["author"] as? [String: Any])?["name"] as? String
            let imageStr = itemDict["image"] as? String ?? itemDict["banner_image"] as? String
            
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
        
        return ParsedFeedPayload(
            title: channelTitle,
            siteURL: channelLink != nil ? URL(string: channelLink!) : nil,
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
                    itemLink = href
                }
            }
        }
        
        if inItemOrEntry && (currentElement == "enclosure" || currentElement == "media:content") {
            if let url = attributeDict["url"], (attributeDict["type"]?.contains("image") == true || url.hasSuffix(".jpg") || url.hasSuffix(".png")) {
                itemImageURLStr = url
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
            case "link": channelLink = channelLink ?? trimmed
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
            if itemLink == nil { itemLink = trimmed }
        case "description", "summary":
            itemSummary = trimmed
        case "content:encoded", "content":
            itemContent = trimmed
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
        let resolvedLink = itemLink != nil ? URL(string: itemLink!, relativeTo: originalURL)?.absoluteURL : nil
        let fallbackDate = Date(timeIntervalSince1970: FeedParserService.undatedFallbackEpoch - Double(parsedItems.count * 60))
        let resolvedDate = parseDate(itemDateStr) ?? fallbackDate
        
        let dedupKey = FeedParserService.generateDeduplicationKey(
            guid: itemGuid,
            link: resolvedLink?.absoluteString,
            title: resolvedTitle,
            date: resolvedDate
        )
        
        let item = ParsedFeedItem(
            deduplicationKey: dedupKey,
            guid: itemGuid,
            title: resolvedTitle,
            link: resolvedLink,
            summary: itemSummary,
            contentHTML: itemContent ?? itemSummary,
            author: itemAuthor,
            publishedDate: min(resolvedDate, Date.now),
            imageURL: itemImageURLStr != nil ? URL(string: itemImageURLStr!, relativeTo: originalURL)?.absoluteURL : nil
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
