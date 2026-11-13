import { XMLParser } from 'fast-xml-parser';
import type { FeedItem } from '../types';

export function calculateReadTime(text: string): number {
  if (!text) return 1;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.ceil(words / 220);
  return Math.max(1, minutes);
}

export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/gi, '\u2013')
    .replace(/&mdash;/gi, '\u2014')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&ldquo;/gi, '\u201c')
    .replace(/&rdquo;/gi, '\u201d')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
}

export const JS_BOILERPLATE_RE =
  /(?:please\s+)?(?:turn\s+on|enable|activate)\s+javascript|javascript\s+is\s+(?:required|disabled|turned\s+off)|you\s+need\s+to\s+enable\s+javascript|enable\s+javascript\s+and\s+cookies\s+to\s+continue|browser\s+does\s+not\s+support\s+javascript|just\s+a\s+moment\.{0,3}|checking\s+your\s+browser|জাভাস্ক্রিপ্ট\s+চালু/i;

export function isBoilerplateOrJsWarning(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (JS_BOILERPLATE_RE.test(t)) return true;
  if (
    /^(cookie|subscribe to|sign up for|advertisement|all rights reserved|follow us on|read more:|also read:|click here|download app|share this article|main navigation|skip to content)/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

export function stripHtml(html: string): string {
  if (!html) return '';
  const capped = html.length > 120000 ? html.slice(0, 120000) : html;
  const withoutBlocks = capped
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutBlocks)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decoded.replace(/\s+/g, ' ').trim();
}

export function cleanCdata(text: string): string {
  if (!text) return '';
  const stripped = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
  return decodeHtmlEntities(stripped);
}

export function resolveUrl(relativeOrAbsolute: string, baseUrl?: string): string {
  if (!relativeOrAbsolute) return '';
  let trimmed = decodeHtmlEntities(relativeOrAbsolute.trim());

  // Unwrap generic ?url= redirect wrappers if present
  if (trimmed.includes('apiclick.aspx') || trimmed.includes('url=http')) {
    try {
      const parsedWrapper = new URL(trimmed, baseUrl || 'https://www.thedailystar.net');
      const unwrapped = parsedWrapper.searchParams.get('url');
      if (unwrapped && /^https?:\/\//i.test(unwrapped)) {
        trimmed = unwrapped;
      }
    } catch {}
  }

  // Unwrap Next.js image proxy URLs if present (e.g. /_next/image?url=https%3A%2F%2F...)
  if (trimmed.includes('/_next/image?url=')) {
    try {
      const urlParam = new URL(trimmed, baseUrl || 'https://www.thedailystar.net').searchParams.get('url');
      if (urlParam) trimmed = urlParam;
    } catch {}
  }

  if (trimmed.startsWith('//')) {
    return 'https:' + trimmed;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (!baseUrl) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

export function extractHeroImage(rawItem: any, contentHtml: string, baseUrl?: string): string | undefined {
  const isValidImage = (url: string) => {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (
      lower.includes('feedburner') ||
      lower.includes('tracking') ||
      lower.includes('google_preferred_source') ||
      lower.includes('badge') ||
      lower.includes('logo') ||
      lower.includes('icon') ||
      lower.includes('avatar') ||
      lower.includes('placeholder') ||
      lower.includes('thumb-b88vr1jv') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.svg') ||
      lower.includes('1x1') ||
      lower.startsWith('data:')
    ) {
      return false;
    }
    return true;
  };

  // 1. media:content, media:thumbnail, or News:Image (Bing News RSS)
  if (rawItem && typeof rawItem === 'object') {
    if (rawItem['News:Image']) {
      const ni = rawItem['News:Image'];
      const url = typeof ni === 'string' ? ni : ni?.['#text'] || ni?.['@_url'];
      if (url && isValidImage(url)) return resolveUrl(url, baseUrl);
    }

    if (rawItem['media:content']) {
      const mc = rawItem['media:content'];
      if (typeof mc === 'object') {
        const url = mc['@_url'] || (Array.isArray(mc) && mc[0]?.['@_url']);
        if (url && isValidImage(url)) return resolveUrl(url, baseUrl);
      }
    }

    if (rawItem['media:thumbnail']) {
      const mt = rawItem['media:thumbnail'];
      if (typeof mt === 'object') {
        const url = mt['@_url'] || (Array.isArray(mt) && mt[0]?.['@_url']);
        if (url && isValidImage(url)) return resolveUrl(url, baseUrl);
      }
    }

    // 2. enclosure with image type
    if (rawItem.enclosure) {
      const enc = rawItem.enclosure;
      const url = enc['@_url'];
      if (url && isValidImage(url)) {
        return resolveUrl(url, baseUrl);
      }
    }
  }

  // 3. <img> in content or description
  if (contentHtml) {
    const matches = [...contentHtml.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi)];
    for (const m of matches) {
      const src = m[1];
      if (src && isValidImage(src)) {
        return resolveUrl(src, baseUrl);
      }
    }
  }

  return undefined;
}

export const UNDATED_FALLBACK_EPOCH = 946684800000; // 2000-01-01T00:00:00Z

export function parseFeedDate(
  rawDate: unknown,
  fallbackIndex = 0
): { timestamp: number; pubDate: string; hasValidDate: boolean } {
  if (rawDate !== undefined && rawDate !== null) {
    let str =
      typeof rawDate === 'object'
        ? String((rawDate as Record<string, unknown>)['#text'] || '')
        : String(rawDate);
    str = str
      .trim()
      .replace(/\b(?:BDT|BST)\b/g, '+06:00')
      .replace(/\bIST\b/g, '+05:30');
    if (str) {
      const parsed = Date.parse(str);
      if (!Number.isNaN(parsed) && parsed > UNDATED_FALLBACK_EPOCH) {
        const clamped = Math.min(parsed, Date.now());
        return {
          timestamp: clamped,
          pubDate: new Date(clamped).toISOString(),
          hasValidDate: true,
        };
      }
    }
  }
  const fallbackTs = UNDATED_FALLBACK_EPOCH - fallbackIndex * 60000;
  return {
    timestamp: fallbackTs,
    pubDate: '',
    hasValidDate: false,
  };
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp || timestamp <= UNDATED_FALLBACK_EPOCH) return '';
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Fallback robust parser for feeds with unclosed HTML in XML (e.g., The Daily Star)
function parseXmlWithRegexFallback(
  xmlString: string,
  feedInfo: { id: string; title: string; url: string; defaultTags?: string[] }
): { feedTitle: string; items: FeedItem[] } {
  const channelTitleMatch =
    xmlString.match(/<channel[\s>][\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) ||
    xmlString.match(/<feed[\s>][\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  let feedTitle = feedInfo.title;
  if (channelTitleMatch && channelTitleMatch[1]) {
    feedTitle = stripHtml(cleanCdata(channelTitleMatch[1])) || feedInfo.title;
  }

  const items: FeedItem[] = [];
  const itemMatches = [...xmlString.matchAll(/<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi)];

  for (const match of itemMatches) {
    const block = match[1];

    // Title
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(cleanCdata(titleMatch[1])) : 'Untitled Article';

    // Link
    let link = '';
    const linkTagMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const linkHrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    if (linkTagMatch && linkTagMatch[1] && !linkTagMatch[1].includes('<')) {
      link = cleanCdata(linkTagMatch[1]);
    } else if (linkHrefMatch && linkHrefMatch[1]) {
      link = linkHrefMatch[1];
    } else {
      const urlMatch = block.match(/https?:\/\/[^\s<"']+/i);
      if (urlMatch) link = urlMatch[0];
    }
    link = resolveUrl(link.trim(), feedInfo.url);

    // Date
    const dateMatch = block.match(
      /<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i
    );
    const rawDate = dateMatch ? cleanCdata(dateMatch[1]) : undefined;
    const { timestamp, pubDate } = parseFeedDate(rawDate, items.length);

    // Author
    const authorMatch = block.match(/<(?:author|dc:creator)[^>]*>([\s\S]*?)<\/(?:author|dc:creator)>/i);
    const author = authorMatch ? stripHtml(cleanCdata(authorMatch[1])) : undefined;

    // Content
    const contentEncodedMatch = block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);

    const contentHtml = cleanCdata(contentEncodedMatch?.[1] || contentMatch?.[1] || descMatch?.[1] || '');
    const cleanBody = stripHtml(contentHtml);
    const summary = cleanBody.slice(0, 240);

    // Hero image
    const imageUrl = extractHeroImage({}, contentHtml, feedInfo.url);

    const guidMatch = block.match(/<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i);
    const guid = guidMatch ? cleanCdata(guidMatch[1]) : link || title;
    const id = `${feedInfo.id}_${encodeURIComponent(String(guid).slice(0, 80))}`;

    const readTimeMin = calculateReadTime(cleanBody || summary);

    items.push({
      id,
      feedId: feedInfo.id,
      feedTitle,
      feedUrl: feedInfo.url,
      title,
      link,
      pubDate,
      timestamp,
      author,
      summary,
      contentHtml: contentHtml || `<p>${summary}</p>`,
      contentClean: cleanBody,
      imageUrl,
      tags: [...(feedInfo.defaultTags || [])],
      isRead: false,
      isBookmarked: false,
      isOfflineCached: true,
      readTimeMin,
    });
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return { feedTitle, items };
}

/**
 * Direct HTML Portal Scraper:
 * When a Bangladeshi newspaper portal does not have an RSS feed (e.g. bdnews24.com,
 * thefinancialexpress.com.bd, or any custom news portal URL), this extracts news stories
 * directly from the portal's HTML page so they can be browsed and opened in clean Reader View.
 */
export function parseHtmlPortalToFeed(
  htmlString: string,
  feedInfo: { id: string; title: string; url: string; defaultTags?: string[] }
): { feedTitle: string; items: FeedItem[] } {
  let feedTitle = feedInfo.title;
  const ogSiteMatch =
    htmlString.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
    htmlString.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const titleTagMatch = htmlString.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!feedTitle || feedTitle === 'Newspaper Feed' || feedTitle === 'RSS Feed') {
    if (ogSiteMatch?.[1]) {
      feedTitle = stripHtml(ogSiteMatch[1]);
    } else if (titleTagMatch?.[1]) {
      feedTitle = stripHtml(titleTagMatch[1]).split(/[|\-\u2013\u2014]/)[0].trim() || feedInfo.title;
    }
  }

  let baseHostname = '';
  try {
    baseHostname = new URL(feedInfo.url).hostname.replace(/^www\./, '');
  } catch {}

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const items: FeedItem[] = [];

  // Bound HTML size and strip script/style/svg blocks so regex matching never lags on mobile Safari/WKWebView
  const cleanPortalHtml = (htmlString.length > 350000 ? htmlString.slice(0, 350000) : htmlString)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');

  // Match <a> tags in HTML with bounded inner content
  const anchorMatches = [...cleanPortalHtml.matchAll(/<a\s+([^>]{1,600})>([\s\S]{1,1800}?)<\/a>/gi)];

  for (const match of anchorMatches) {
    if (items.length >= 30) break;

    const attrs = match[1];
    const innerHtml = match[2];

    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch || !hrefMatch[1]) continue;

    const rawHref = hrefMatch[1].trim();
    if (
      !rawHref ||
      rawHref.startsWith('#') ||
      rawHref.startsWith('javascript:') ||
      rawHref.startsWith('mailto:') ||
      rawHref.startsWith('tel:') ||
      rawHref.includes('/cdn-cgi/')
    ) {
      continue;
    }

    const fullUrl = resolveUrl(rawHref, feedInfo.url);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      continue;
    }

    // Must belong to same root domain
    if (baseHostname && !parsedUrl.hostname.includes(baseHostname)) {
      continue;
    }

    const pathname = parsedUrl.pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);

    // Filter out non-article navigation/category/utility paths
    if (pathname.length < 14 || segments.length === 0) continue;
    if (
      /\/(login|signin|signup|register|privacy|terms|contact|about|advertise|archive|search|author|tag|topic|category|collection|section|video|videos|photo|photos|gallery|live|poll|weather|epaper|todays-paper)$/i.test(
        pathname
      )
    ) {
      continue;
    }
    if (segments[0] && /^(category|tag|topic|collection|author|page|search|user|profile)$/i.test(segments[0])) {
      continue;
    }

    // Require article-like URL structure (digits in slug, 2+ hyphens in slug, or 3+ path segments)
    const lastSegment = segments[segments.length - 1] || '';
    const hyphenCount = (lastSegment.match(/-/g) || []).length;
    const looksLikeArticle =
      /\d/.test(lastSegment) || hyphenCount >= 2 || segments.length >= 3;
    if (!looksLikeArticle) continue;

    // Extract best headline candidate
    const headingMatch = innerHtml.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const ariaLabelMatch = attrs.match(/aria-label=["']([^"']+)["']/i);
    const titleAttrMatch = attrs.match(/title=["']([^"']+)["']/i);

    let title = '';
    if (headingMatch?.[1]) {
      title = stripHtml(headingMatch[1]);
    } else if (ariaLabelMatch?.[1]) {
      title = stripHtml(ariaLabelMatch[1]);
    } else if (titleAttrMatch?.[1]) {
      title = stripHtml(titleAttrMatch[1]);
    } else {
      title = stripHtml(innerHtml);
    }

    // Clean up common prefixes/suffixes and validate title length (at least 4 words / 22 chars)
    title = title.replace(/\s+/g, ' ').trim();
    const wordCount = title.split(/\s+/).length;
    if (!title || title.length < 22 || title.length > 240 || wordCount < 4) continue;
    if (title.includes('@') || /^(read more|view more|click here|subscribe|follow us)/i.test(title)) {
      continue;
    }

    if (seenUrls.has(fullUrl) || seenTitles.has(title.toLowerCase())) continue;
    seenUrls.add(fullUrl);
    seenTitles.add(title.toLowerCase());

    // Look at surrounding sibling HTML around the anchor for image or summary paragraph
    const matchIndex = match.index ?? 0;
    const matchEnd = matchIndex + match[0].length;
    const beforeWindow = cleanPortalHtml.slice(Math.max(0, matchIndex - 500), matchIndex);
    const afterWindow = cleanPortalHtml
      .slice(matchEnd, matchEnd + 900)
      .split(/<\/article>|<article\b|<h[1-4]\b/i)[0] || '';

    // Extract image if inside the anchor or immediately preceding in the same card
    const imageUrl =
      extractHeroImage({}, innerHtml, feedInfo.url) ||
      extractHeroImage({}, beforeWindow.split(/<article\b|<li\b/i).pop() || '', feedInfo.url);

    // Extract real news summary from inner paragraph or sibling paragraph/excerpt right after </a>
    const pMatch =
      innerHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ||
      afterWindow.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ||
      afterWindow.match(/<(?:div|span)[^>]+class=["'][^"']*(?:summary|excerpt|intro|lead|desc|sub-title|sort-dec)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span)>/i);
    const pText = pMatch ? stripHtml(pMatch[1]).replace(/\s+/g, ' ').trim() : '';
    const summary =
      pText && pText !== title && pText.length > 20
        ? pText.slice(0, 260)
        : '';

    const timeMatch =
      innerHtml.match(/<time[^>]+datetime=["']([^"']+)["']/i) ||
      afterWindow.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    const { timestamp, pubDate } = parseFeedDate(timeMatch?.[1], items.length);
    const id = `${feedInfo.id}_${encodeURIComponent(fullUrl.slice(-70))}`;

    items.push({
      id,
      feedId: feedInfo.id,
      feedTitle,
      feedUrl: feedInfo.url,
      title,
      link: fullUrl,
      pubDate,
      timestamp,
      summary,
      // Keep contentClean short so ReaderView automatically triggers /api/extract on open!
      contentHtml: summary ? `<p>${summary}</p>` : '',
      contentClean: '',
      imageUrl,
      tags: [...(feedInfo.defaultTags || [])],
      isRead: false,
      isBookmarked: false,
      isOfflineCached: false,
      readTimeMin: 3,
    });
  }

  return { feedTitle, items };
}

export function parseXmlFeed(
  xmlString: string,
  feedInfo: { id: string; title: string; url: string; defaultTags?: string[] }
): {
  feedTitle: string;
  items: FeedItem[];
} {
  const rawItemCount = (xmlString.match(/<(?:item|entry)[\s>]/gi) || []).length;

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      isArray: (name) => ['item', 'entry'].includes(name),
    });

    const parsed = parser.parse(xmlString);
    let channel = parsed?.rss?.channel || parsed?.['rdf:RDF'] || parsed?.feed;

    let feedTitle = feedInfo.title;
    if (channel?.title) {
      feedTitle = typeof channel.title === 'string' ? channel.title : channel.title['#text'] || feedInfo.title;
    }
    feedTitle = stripHtml(cleanCdata(feedTitle));

    const rawItems = channel?.item || channel?.entry || [];
    const itemsList = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    if (itemsList.length < rawItemCount && rawItemCount > 1) {
      return parseXmlWithRegexFallback(xmlString, feedInfo);
    }

    const items: FeedItem[] = [];

    for (const raw of itemsList) {
      if (!raw) continue;

      // Title
      let title = raw.title;
      if (typeof title === 'object') {
        title = title['#text'] || '';
      }
      title = stripHtml(cleanCdata(String(title || 'Untitled Article')));

      // Link
      let link = raw.link;
      if (Array.isArray(link)) {
        const alt = link.find((l: any) => l['@_rel'] === 'alternate') || link[0];
        link = alt?.['@_href'] || alt || '';
      } else if (typeof link === 'object') {
        link = link['@_href'] || link['#text'] || '';
      }
      link = resolveUrl(String(link || '').trim(), feedInfo.url);

      // Date
      const rawDate = raw.pubDate ?? raw['dc:date'] ?? raw.published ?? raw.updated;
      const { timestamp, pubDate } = parseFeedDate(rawDate, items.length);

      // Author
      let author: string | undefined;
      if (raw.author) {
        author = typeof raw.author === 'object' ? raw.author.name || raw.author['#text'] : String(raw.author);
      } else if (raw['dc:creator']) {
        author = typeof raw['dc:creator'] === 'object' ? raw['dc:creator']['#text'] : String(raw['dc:creator']);
      }

      // Content & summary
      const contentEncoded = raw['content:encoded']
        ? typeof raw['content:encoded'] === 'object'
          ? raw['content:encoded']['#text']
          : raw['content:encoded']
        : '';
      const description = raw.description
        ? typeof raw.description === 'object'
          ? raw.description['#text']
          : raw.description
        : '';
      const content = raw.content ? (typeof raw.content === 'object' ? raw.content['#text'] : raw.content) : '';

      const contentHtml = cleanCdata(contentEncoded || content || description || '');
      const cleanBody = stripHtml(contentHtml);
      const summary = stripHtml(description || cleanBody).slice(0, 240);

      // Hero image
      const imageUrl = extractHeroImage(raw, contentHtml, feedInfo.url);

      // Unique ID
      const guid = raw.guid ? (typeof raw.guid === 'object' ? raw.guid['#text'] : raw.guid) : raw.id;
      const id = `${feedInfo.id}_${encodeURIComponent(String(guid || link || title).slice(0, 80))}`;

      const readTimeMin = calculateReadTime(cleanBody || summary);

      items.push({
        id,
        feedId: feedInfo.id,
        feedTitle,
        feedUrl: feedInfo.url,
        title,
        link,
        pubDate,
        timestamp,
        author: author ? stripHtml(cleanCdata(author)) : undefined,
        summary,
        contentHtml: contentHtml || `<p>${summary}</p>`,
        contentClean: cleanBody,
        imageUrl,
        tags: [...(feedInfo.defaultTags || [])],
        isRead: false,
        isBookmarked: false,
        isOfflineCached: true,
        readTimeMin,
      });
    }

    if (items.length > 0) {
      items.sort((a, b) => b.timestamp - a.timestamp);
      return { feedTitle, items };
    }

    if (rawItemCount > 0) {
      return parseXmlWithRegexFallback(xmlString, feedInfo);
    }

    return { feedTitle, items: [] };
  } catch {
    return parseXmlWithRegexFallback(xmlString, feedInfo);
  }
}

export function filterArticles(
  articles: FeedItem[],
  options: {
    selectedTagId?: string | null;
    searchQuery?: string;
    filterMode?: 'all' | 'unread' | 'bookmarked' | 'offline';
    selectedFeedId?: string | null;
    selectedFeedIds?: string[] | null;
  }
): FeedItem[] {
  const { selectedTagId, searchQuery, filterMode = 'all', selectedFeedId, selectedFeedIds } = options;

  return articles.filter((article) => {
    // Single feed filter
    if (selectedFeedId && article.feedId !== selectedFeedId) {
      return false;
    }

    // Folder feeds filter (when a specific folder is selected)
    if (selectedFeedIds && selectedFeedIds.length > 0 && !selectedFeedIds.includes(article.feedId)) {
      return false;
    }
    if (selectedFeedIds && selectedFeedIds.length === 0) {
      return false;
    }

    // Tag filter
    if (selectedTagId && !article.tags.includes(selectedTagId)) {
      return false;
    }

    // Mode filter
    if ((filterMode === 'all' || filterMode === 'unread') && article.hiddenFromFeed) {
      return false;
    }
    if (filterMode === 'unread' && article.isRead) {
      return false;
    }
    if (filterMode === 'bookmarked' && !article.isBookmarked) {
      return false;
    }
    if (filterMode === 'offline' && !article.isOfflineCached) {
      return false;
    }

    // Search query
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const inTitle = article.title.toLowerCase().includes(q);
      const inSummary = article.summary.toLowerCase().includes(q);
      const inAuthor = article.author?.toLowerCase().includes(q);
      const inFeed = article.feedTitle.toLowerCase().includes(q);
      if (!inTitle && !inSummary && !inAuthor && !inFeed) {
        return false;
      }
    }

    return true;
  });
}

const KNOWN_DOMAIN_RSS_MAP: Array<{ match: RegExp; rssUrl: string }> = [
  { match: /(?:^|\.)thedailystar\.net$/i, rssUrl: 'https://www.thedailystar.net/rss.xml' },
  { match: /^en\.prothomalo\.com$/i, rssUrl: 'https://en.prothomalo.com/feed' },
  { match: /(?:^|\.)prothomalo\.com$/i, rssUrl: 'https://www.prothomalo.com/feed' },
  { match: /(?:^|\.)tbsnews\.net$/i, rssUrl: 'https://www.tbsnews.net/top-news/rss.xml' },
  { match: /(?:^|\.)dhakatribune\.com$/i, rssUrl: 'https://www.dhakatribune.com/feed/' },
  { match: /(?:^|\.)bbc\.(?:com|co\.uk)$/i, rssUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { match: /(?:^|\.)theguardian\.com$/i, rssUrl: 'https://www.theguardian.com/world/rss' },
  { match: /(?:^|\.)aljazeera\.com$/i, rssUrl: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { match: /(?:^|\.)dw\.com$/i, rssUrl: 'https://rss.dw.com/rdf/rss-en-all' },
];

/**
 * Given a website or feed URL and optional HTML, produces an ordered list of candidate RSS/Atom feed URLs to probe.
 */
export function buildRssDiscoveryCandidates(rawUrl: string, html?: string): string[] {
  const candidates: string[] = [];
  const addCandidate = (u?: string) => {
    if (!u) return;
    const resolved = resolveUrl(u, rawUrl);
    if (resolved && /^https?:\/\//i.test(resolved) && !candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(/^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`);
  } catch {
    return candidates;
  }

  // 1. Inspect explicit <link rel="alternate" type="application/rss+xml"> tags in HTML first
  if (html) {
    const linkMatches = [
      ...html.matchAll(
        /<link[^>]+(?:type=["']application\/(?:rss|atom|rdf)\+xml["']|rel=["']alternate["'])[^>]*>/gi
      ),
    ];
    for (const m of linkMatches) {
      const tag = m[0];
      if (!/(rss|atom|xml|feed)/i.test(tag)) continue;
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (hrefMatch?.[1]) addCandidate(hrefMatch[1]);
    }
  }

  const host = parsedUrl.hostname.replace(/^www\./i, '');
  for (const entry of KNOWN_DOMAIN_RSS_MAP) {
    if (entry.match.test(parsedUrl.hostname) || entry.match.test(host)) {
      addCandidate(entry.rssUrl);
    }
  }

  if (html) {
    const anchorMatches = [
      ...html.slice(0, 200000).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi),
    ];
    for (const m of anchorMatches) {
      const href = m[1] || '';
      if (/(\/rss\b|\/feed\b|\.rss\b|rss\.xml|feed\.xml|atom\.xml|index\.xml|\?feed=rss)/i.test(href)) {
        addCandidate(href);
        if (candidates.length >= 6) break;
      }
    }
  }

  // 2. Standard path combinations for blogs & newspapers
  const cleanBase = parsedUrl.href.replace(/\/+$/, '');
  const origin = parsedUrl.origin;
  const pathClean = parsedUrl.pathname.replace(/\/+$/, '');

  if (parsedUrl.hostname.includes('medium.com') && pathClean && !pathClean.startsWith('/feed')) {
    addCandidate(`${origin}/feed${pathClean}`);
  }

  const suffixes = [
    '/feed',
    '/rss.xml',
    '/rss',
    '/feed/',
    '/feed.xml',
    '/atom.xml',
    '/index.xml',
    '/top-news/rss.xml',
    '/?feed=rss2',
    '/feeds/posts/default?alt=rss',
  ];

  for (const s of suffixes) {
    addCandidate(`${cleanBase}${s}`);
  }
  if (cleanBase !== origin) {
    for (const s of suffixes.slice(0, 5)) {
      addCandidate(`${origin}${s}`);
    }
  }

  return candidates.filter((c) => c !== parsedUrl?.href && c !== cleanBase);
}

/**
 * Recursively extracts story paragraphs and metadata from embedded JSON scripts
 * (JSON-LD with @graph, Next.js __NEXT_DATA__, Quintype static-page / story-elements, etc.).
 */
function extractFromEmbeddedJsonScripts(html: string): {
  title: string;
  author: string;
  image: string;
  paragraphs: string[];
} {
  let title = '';
  let author = '';
  let image = '';
  const paragraphs: string[] = [];
  const seen = new Set<string>();

  const pushParagraph = (raw: string) => {
    const clean = stripHtml(raw).replace(/\s+/g, ' ').trim();
    if (clean.length < 25 || isBoilerplateOrJsWarning(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    paragraphs.push(clean);
  };

  const pushMultiParagraphString = (raw: string) => {
    if (!raw) return;
    const decoded = decodeHtmlEntities(raw);
    const chunks = decoded
      .replace(/<\/p>|<br\s*\/?>/gi, '\n\n')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const chunk of chunks) {
      pushParagraph(chunk);
    }
  };

  const walkNode = (node: any, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (const item of node) walkNode(item, depth + 1);
      return;
    }

    if (!title && typeof (node.headline || node.title) === 'string') {
      const candidateTitle = stripHtml(String(node.headline || node.title)).trim();
      if (candidateTitle.length > 8 && !isBoilerplateOrJsWarning(candidateTitle)) {
        title = candidateTitle;
      }
    }

    if (!author) {
      const a = node.author || node['author-name'] || node.authors;
      const firstAuthor = Array.isArray(a) ? a[0] : a;
      if (typeof firstAuthor === 'string' && firstAuthor.trim()) {
        author = stripHtml(firstAuthor);
      } else if (firstAuthor && typeof firstAuthor.name === 'string') {
        author = stripHtml(firstAuthor.name);
      }
    }

    if (!image) {
      const img = node.image || node['hero-image-s3-key'] ? node.image : null;
      const firstImg = Array.isArray(img) ? img[0] : img;
      if (typeof firstImg === 'string' && firstImg.startsWith('http')) {
        image = firstImg;
      } else if (firstImg && typeof firstImg.url === 'string' && firstImg.url.startsWith('http')) {
        image = firstImg.url;
      }
    }

    // JSON-LD articleBody
    if (typeof node.articleBody === 'string' && node.articleBody.trim().length > 40) {
      pushMultiParagraphString(node.articleBody);
    }

    // Quintype story-elements (Prothom Alo, BDNews24, etc.)
    if (Array.isArray(node['story-elements'])) {
      for (const el of node['story-elements']) {
        if (el && typeof el.text === 'string' && (!el.type || el.type === 'text' || el.type === 'summary')) {
          pushMultiParagraphString(el.text);
        }
      }
    }

    // Next.js / CMS body fields
    for (const key of ['content', 'body', 'details', 'article_body', 'storyBody']) {
      if (typeof node[key] === 'string' && node[key].length > 100 && (node[key].includes('<p') || node[key].includes(' '))) {
        pushMultiParagraphString(node[key]);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'config' || key === 'theme' || key === 'navigation' || key === 'ads') continue;
      const val = node[key];
      if (val && typeof val === 'object') {
        walkNode(val, depth + 1);
      }
    }
  };

  const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const m of scriptMatches) {
    const attrs = (m[1] || '').toLowerCase();
    const body = (m[2] || '').trim();
    if (!body) continue;

    const isJsonScript =
      attrs.includes('application/ld+json') ||
      attrs.includes('application/json') ||
      attrs.includes('__next_data__') ||
      attrs.includes('static-page') ||
      body.startsWith('{');

    if (!isJsonScript) continue;
    try {
      const parsed = JSON.parse(body);
      walkNode(parsed, 0);
    } catch {
      // Ignore non-JSON script blocks
    }
  }

  return { title, author, image, paragraphs };
}

/**
 * Pure, cross-environment HTML article extractor that strips <noscript> / JS warnings
 * and extracts full article blocks from semantic HTML or embedded JSON-LD / Next.js / Quintype state.
 */
export function extractReadableArticleFromHtml(
  html: string,
  url: string
): {
  success: boolean;
  title: string;
  author?: string;
  siteName?: string;
  leadImage?: string;
  readTimeMin: number;
  contentClean: string;
  paragraphCount: number;
  blocks: Array<{ type: 'p' | 'h2' | 'h3' | 'blockquote' | 'img'; text?: string; src?: string }>;
} {
  const embedded = extractFromEmbeddedJsonScripts(html);

  const readMeta = (pattern: RegExp): string => {
    const m = html.match(pattern);
    return m?.[1] ? stripHtml(m[1]).trim() : '';
  };

  const ogTitle =
    readMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    readMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    readMeta(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);

  const ogSiteName =
    readMeta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
    readMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);

  const metaAuthor =
    readMeta(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i) ||
    readMeta(/<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i);

  const ogImage =
    readMeta(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    readMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
    readMeta(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);

  const metaDesc =
    readMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    readMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);

  // Strip script, style, noscript, nav, header, footer, aside, form, button, svg, iframe BEFORE scanning DOM blocks
  const cleanedHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(?:nav|header|footer|aside|form|button|svg|iframe)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside|form|button|svg|iframe)>/gi, ' ');

  const h1Match = cleanedHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const titleTagMatch = cleanedHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const rawTitle =
    embedded.title ||
    ogTitle ||
    (h1Match?.[1] ? stripHtml(h1Match[1]) : '') ||
    (titleTagMatch?.[1] ? stripHtml(titleTagMatch[1]) : '') ||
    'Newspaper Story';

  const title = isBoilerplateOrJsWarning(rawTitle) ? 'Newspaper Story' : rawTitle;
  const author = embedded.author || metaAuthor || undefined;
  const leadImageRaw = embedded.image || ogImage || '';
  const leadImage = leadImageRaw ? resolveUrl(leadImageRaw, url) : undefined;

  let siteName = ogSiteName;
  if (!siteName) {
    try {
      siteName = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      siteName = '';
    }
  }

  const domBlocks: Array<{ type: 'p' | 'h2' | 'h3' | 'blockquote' | 'img'; text?: string; src?: string }> = [];
  const seenTexts = new Set<string>();

  const addBlock = (type: 'p' | 'h2' | 'h3' | 'blockquote', rawText: string) => {
    const text = stripHtml(rawText).replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (type === 'p' && text.length < 28) return;
    if (type !== 'p' && text.length < 6) return;
    if (isBoilerplateOrJsWarning(text)) return;
    if (seenTexts.has(text)) return;
    seenTexts.add(text);
    domBlocks.push({ type, text });
  };

  // Focus on <article> or <main> if present to avoid sidebar/menu links
  const articleRegionMatch =
    cleanedHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    cleanedHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const targetHtml =
    articleRegionMatch && articleRegionMatch[1].length > 400 ? articleRegionMatch[1] : cleanedHtml;

  // Match p, h2, h3, blockquote tags
  const blockMatches = [
    ...targetHtml.matchAll(/<(p|h2|h3|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi),
  ];
  for (const m of blockMatches) {
    const tag = m[1].toLowerCase() as 'p' | 'h2' | 'h3' | 'blockquote';
    addBlock(tag, m[2]);
  }

  // Also check div containers that separate paragraphs via <br><br> (common in Bangla newspapers)
  if (domBlocks.filter((b) => b.type === 'p').length < 3) {
    const detailDivMatches = [
      ...cleanedHtml.matchAll(
        /<div[^>]+(?:itemprop=["']articleBody["']|class=["'][^"']*(?:news-details|article-body|story-content|entry-content|details-content|story-element-text)[^"']*["'])[^>]*>([\s\S]*?)<\/div>/gi
      ),
    ];
    for (const m of detailDivMatches) {
      const parts = m[1].split(/<br\s*\/?>\s*<br\s*\/?>|\n{2,}/i);
      for (const part of parts) {
        addBlock('p', part);
      }
    }
  }

  const domTextLen = domBlocks.map((b) => b.text || '').join(' ').length;
  const embeddedTextLen = embedded.paragraphs.join(' ').length;

  const finalBlocks: Array<{ type: 'p' | 'h2' | 'h3' | 'blockquote' | 'img'; text?: string; src?: string }> =
    embedded.paragraphs.length > 0 &&
    (domBlocks.filter((b) => b.type === 'p').length < 3 || embeddedTextLen > domTextLen * 1.25)
      ? embedded.paragraphs.map((text) => ({ type: 'p' as const, text }))
      : domBlocks;

  if (finalBlocks.length === 0 && metaDesc && !isBoilerplateOrJsWarning(metaDesc) && metaDesc.length > 35) {
    finalBlocks.push({ type: 'p', text: metaDesc });
  }

  const fullText = finalBlocks.map((b) => b.text || '').join('\n\n');
  return {
    success: finalBlocks.length > 0 && fullText.length >= 40,
    title,
    author,
    siteName,
    leadImage,
    readTimeMin: calculateReadTime(fullText),
    contentClean: fullText,
    paragraphCount: finalBlocks.length,
    blocks: finalBlocks,
  };
}

