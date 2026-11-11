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
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
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

export function stripHtml(html: string): string {
  if (!html) return '';
  const withoutTags = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

export function cleanCdata(text: string): string {
  if (!text) return '';
  const stripped = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
  return decodeHtmlEntities(stripped);
}

export function resolveUrl(relativeOrAbsolute: string, baseUrl?: string): string {
  if (!relativeOrAbsolute) return '';
  let trimmed = relativeOrAbsolute.trim();

  // Unwrap Next.js image proxy URLs if present (e.g. /_next/image?url=https%3A%2F%2F...)
  if (trimmed.includes('/_next/image?url=')) {
    try {
      const urlParam = new URL(trimmed, baseUrl || 'https://example.com').searchParams.get('url');
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

  // 1. media:content or media:thumbnail
  if (rawItem && typeof rawItem === 'object') {
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

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

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
    const rawDate = dateMatch ? cleanCdata(dateMatch[1]) : new Date().toISOString();
    const timestamp = Date.parse(rawDate) || Date.now();
    const pubDate = new Date(timestamp).toISOString();

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
      feedTitle = stripHtml(titleTagMatch[1]).split(/[|\-–—]/)[0].trim() || feedInfo.title;
    }
  }

  let baseHostname = '';
  try {
    baseHostname = new URL(feedInfo.url).hostname.replace(/^www\./, '');
  } catch {}

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const items: FeedItem[] = [];
  const now = Date.now();

  // Match all <a> tags in HTML
  const anchorMatches = [...htmlString.matchAll(/<a\s+([^>]+)>([\s\S]*?)<\/a>/gi)];

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
    const beforeWindow = htmlString.slice(Math.max(0, matchIndex - 500), matchIndex);
    const afterWindow = htmlString
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

    const timestamp = now - items.length * 60 * 1000;
    const id = `${feedInfo.id}_${encodeURIComponent(fullUrl.slice(-70))}`;

    items.push({
      id,
      feedId: feedInfo.id,
      feedTitle,
      feedUrl: feedInfo.url,
      title,
      link: fullUrl,
      pubDate: new Date(timestamp).toISOString(),
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
      const rawDate = raw.pubDate || raw['dc:date'] || raw.published || raw.updated || new Date().toISOString();
      const timestamp = Date.parse(rawDate) || Date.now();
      const pubDate = new Date(timestamp).toISOString();

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
