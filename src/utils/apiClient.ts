import { CapacitorHttp } from '@capacitor/core';
import type { FeedItem, TravelBlog } from '../types';
import {
  parseXmlFeed,
  parseHtmlPortalToFeed,
  stripHtml,
  resolveUrl,
  calculateReadTime,
  buildRssDiscoveryCandidates,
  extractReadableArticleFromHtml,
  isBoilerplateOrJsWarning,
  parseFeedDate,
} from './feedParser';
import { escapeHtml } from './sanitize';
import { checkSafeExternalUrl, stripTrackingParams } from './urlSecurity';
import {
  GENERIC_STATIC_USER_AGENT,
  PRIVACY_FETCH_INIT,
  isRunningInNativeIos,
  resolveUrlThroughPrivacyRelay,
} from './nativeFetcher';
import staticBlogsData from '../../data/blogs.json';

const ENV_RELAY_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PRIVACY_RELAY_URL?.trim() ||
  '';

const LOCAL_BLOGS_STORAGE_KEY = 'chinta_local_travel_blogs_v1';

// AbortSignal.timeout throws on older iOS WebViews, so use a manual timer.
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isValidFetchedDocument(text: string): boolean {
  if (!text || text.trim().length <= 50) return false;
  const sample = text.slice(0, 1200);
  if (sample.includes('"A valid API key is required"')) return false;
  if (
    sample.includes('<title>Just a moment...</title>') ||
    sample.includes('Enable JavaScript and cookies to continue')
  ) {
    return false;
  }
  return true;
}

async function fetchRawUrlClientSide(
  targetUrl: string,
  timeoutMs = 7500,
  feedId?: string
): Promise<string> {
  const cleanTarget = stripTrackingParams(targetUrl);
  const check = checkSafeExternalUrl(cleanTarget);
  if (!check.ok || !check.url) {
    throw new Error(check.reason || 'Blocked unsafe URL');
  }
  const safeUrl = check.url.href;
  const relayTargetUrl = resolveUrlThroughPrivacyRelay(safeUrl, {
    feedId,
    relayUrlOverride: ENV_RELAY_URL || undefined,
  });

  const candidateUrls =
    relayTargetUrl !== safeUrl ? [relayTargetUrl, safeUrl] : [safeUrl];

  for (const requestUrl of candidateUrls) {
    // 1. On native iOS Capacitor, use CapacitorHttp.get with generic static User-Agent
    if (isRunningInNativeIos()) {
      try {
        const res = await CapacitorHttp.get({
          url: requestUrl,
          responseType: 'text',
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
          headers: {
            'User-Agent': GENERIC_STATIC_USER_AGENT,
            Accept:
              'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml, */*',
            'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
          },
        });
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
        if (res.status >= 200 && res.status < 300 && isValidFetchedDocument(body)) {
          return body;
        }
        if (res.status === 404 || res.status === 410) break;
      } catch {
        // Fall through to standard privacy-locked fetch
      }
    }

    // 2. Privacy-locked standard fetch (no cookies, no referrer, no cache)
    try {
      const directRes = await fetch(requestUrl, {
        ...PRIVACY_FETCH_INIT,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: timeoutSignal(timeoutMs),
        headers: {
          Accept:
            'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml, */*',
        },
      });
      if (directRes.ok) {
        const text = await directRes.text();
        if (isValidFetchedDocument(text)) {
          return text;
        }
      }
    } catch {
      // Try next candidate URL if relay failed
    }
  }

  throw new Error(`Unable to reach ${safeUrl} directly`);
}

export async function fetchFeedWithFallback(params: {
  url: string;
  feedId: string;
  title: string;
  tags: string[];
}): Promise<{ feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string }> {
  let normalizedUrl = stripTrackingParams(params.url.trim());
  if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl) && !normalizedUrl.startsWith('/')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  const normalizedParams = { ...params, url: normalizedUrl };

  try {
    return await fetchFeedOnDevice(normalizedParams);
  } catch {
    return { feedTitle: normalizedParams.title, items: [], resolvedFeedUrl: normalizedParams.url };
  }
}

async function fetchFeedOnDevice(params: {
  url: string;
  feedId: string;
  title: string;
  tags: string[];
}): Promise<{ feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string }> {
  const isXmlString = (s: string) => {
    const t = s.trim();
    return (
      t.startsWith('<?xml') ||
      t.startsWith('<rss') ||
      t.startsWith('<feed') ||
      /<rss[\s>]|<feed[\s>]|<channel[\s>]|<rdf:RDF/i.test(t.slice(0, 1500))
    );
  };

  const feedInfo = {
    id: params.feedId,
    title: params.title,
    url: params.url,
    defaultTags: params.tags,
  };

  // Step 1: Try fetching the given URL directly or via configured stateless privacy relay / mirror
  let rawText = '';
  try {
    rawText = await fetchRawUrlClientSide(params.url, 6500, params.feedId);
    if (isXmlString(rawText)) {
      const parsed = parseXmlFeed(rawText, feedInfo);
      if (parsed.items.length > 0) {
        return { ...parsed, resolvedFeedUrl: params.url };
      }
    }
  } catch {
    // Will continue to RSS candidate discovery
  }

  // Step 2: Search for an RSS feed link BEFORE falling back to the website link
  const rssCandidates = buildRssDiscoveryCandidates(params.url, rawText);

  for (const candidateUrl of rssCandidates.slice(0, 6)) {
    try {
      const candidateText = await fetchRawUrlClientSide(candidateUrl, 3500);
      if (isXmlString(candidateText)) {
        const parsed = parseXmlFeed(candidateText, { ...feedInfo, url: candidateUrl });
        if (parsed.items.length > 0) {
          return { ...parsed, resolvedFeedUrl: candidateUrl };
        }
      }
    } catch {
      // Try next RSS candidate
    }
  }

  // Step 3: If no RSS link is available, keep the website link and parse articles directly from the website HTML
  if (rawText) {
    const scraped = parseHtmlPortalToFeed(rawText, feedInfo);
    if (scraped.items.length > 0) {
      return { ...scraped, resolvedFeedUrl: params.url };
    }
  }

  // Step 4: Website domain news index fallback (Bing News RSS with unwrapped direct links)
  try {
    const parsed = new URL(params.url);
    const domain = parsed.hostname.replace(/^www\./, '');
    const indexUrls = [
      `https://www.bing.com/news/search?q=${encodeURIComponent('site:' + domain)}&format=rss`,
      `https://news.google.com/rss/search?q=${encodeURIComponent('site:' + domain)}&hl=en-BD&gl=BD&ceid=BD:en`,
    ];
    for (const indexUrl of indexUrls) {
      try {
        const indexXml = await fetchRawUrlClientSide(indexUrl, 6000);
        if (isXmlString(indexXml)) {
          const parsedIndex = parseXmlFeed(indexXml, {
            ...feedInfo,
            title:
              params.title && params.title !== 'Newspaper Feed' ? params.title : domain,
            url: params.url,
          });
          if (parsedIndex.items.length > 0) {
            return { ...parsedIndex, resolvedFeedUrl: params.url };
          }
        }
      } catch {}
    }
  } catch {}

  throw new Error(`No articles found for ${params.url}`);
}

export interface ExtractedArticleBlock {
  type: 'p' | 'h2' | 'h3' | 'blockquote' | 'img';
  text?: string;
  src?: string;
  alt?: string;
}

export interface ExtractedArticleData {
  success: boolean;
  title?: string;
  author?: string;
  siteName?: string;
  leadImage?: string;
  readTimeMin?: number;
  blocks: ExtractedArticleBlock[];
}

export async function extractArticleWithFallback(url: string): Promise<ExtractedArticleData> {
  const cleanUrl = stripTrackingParams(resolveUrl(url));
  try {
    const extracted = await extractArticleOnDevice(cleanUrl);
    if (extracted.success && Array.isArray(extracted.blocks)) {
      const validBlocks = extracted.blocks.filter(
        (b: ExtractedArticleBlock) => !b.text || !isBoilerplateOrJsWarning(b.text)
      );
      if (validBlocks.some((block: ExtractedArticleBlock) => (block.text || '').trim().length > 60)) {
        return { ...extracted, blocks: validBlocks };
      }
    }
    return extracted;
  } catch {
    return { success: false, blocks: [] };
  }
}

async function extractArticleOnDevice(url: string): Promise<ExtractedArticleData> {
  const html = await fetchRawUrlClientSide(url, 8000);
  return extractReadableArticleFromHtml(html, url);
}

export interface ArticleSummaryResult {
  success: boolean;
  provider: string;
  executiveSummary: string;
  keyTakeaways: string[];
  context?: string;
  error?: string;
}

export async function summarizeArticleWithFallback(params: {
  title: string;
  text: string;
}): Promise<ArticleSummaryResult> {
  // 100% client-side extractive summarization (zero server or external API calls)
  const clean = stripHtml(params.text).slice(0, 10000);
  const sentences = clean
    .replace(/([.?!])\s*(?=[A-Z0-9\u0980-\u09FF])/g, '$1|')
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 35 && s.length < 240);

  const executive = sentences.slice(0, 2).join(' ');
  const takeaways = sentences.slice(2, 6);

  return {
    success: true,
    provider: 'on-device-extractive',
    executiveSummary: executive || clean.slice(0, 240),
    keyTakeaways: takeaways.length > 0 ? takeaways : [clean.slice(0, 180)],
    context: 'Key takeaways distilled locally on your device.',
  };
}

export function blogToFeedItem(blog: TravelBlog): FeedItem {
  const parsedDate = parseFeedDate(blog.publishedAt);
  const timestamp = parsedDate.hasValidDate ? parsedDate.timestamp : blog.timestamp;
  return {
    id: blog.id,
    feedId: 'travel_blogs_bd',
    feedTitle: blog.groupName ? `${blog.groupName} (${blog.author})` : `Traveler: ${blog.author}`,
    feedUrl: '/blogs',
    title: blog.title,
    link: `/blog/${blog.id}`,
    pubDate: blog.publishedAt,
    timestamp,
    author: `${blog.author} · ${blog.groupName || 'Bangladeshi Travel Group'}`,
    summary: blog.summary || blog.content.slice(0, 180) + '...',
    contentHtml: `
      <div class="travel-group-badge mb-4 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-200">
        <p class="text-xs uppercase font-bold tracking-wider text-emerald-400 mb-1">Bangladeshi Travel Group Dispatch</p>
        <p class="text-sm font-semibold text-stone-100">${escapeHtml(blog.groupName || 'Travel Group')} · Writer: ${escapeHtml(blog.author)}</p>
        ${blog.location ? `<p class="text-xs text-stone-300 mt-1">📍 Destination: ${escapeHtml(blog.location)}</p>` : ''}
        ${blog.groupContact ? `<p class="text-xs text-emerald-300 mt-1.5 font-sans">Connect with Group: <span class="underline">${escapeHtml(blog.groupContact)}</span></p>` : ''}
      </div>
      ${blog.content.split(/\n\n+/).map((p: string) => `<p>${escapeHtml(p.trim())}</p>`).join('\n')}
    `,
    contentClean: blog.content,
    imageUrl: blog.coverImage ? stripTrackingParams(blog.coverImage) : undefined,
    tags: ['tag_travel', 'tag_bd'],
    isRead: false,
    isBookmarked: false,
    isOfflineCached: true,
    readTimeMin: blog.readTimeMin || calculateReadTime(blog.content),
  };
}

function loadLocalTravelBlogs(): TravelBlog[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LOCAL_BLOGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TravelBlog[]) : [];
  } catch {
    return [];
  }
}

export async function fetchTravelBlogsFromDatabase(): Promise<TravelBlog[]> {
  const localBlogs = loadLocalTravelBlogs();
  const bundledBlogs = Array.isArray(staticBlogsData) ? (staticBlogsData as TravelBlog[]) : [];
  const seenIds = new Set<string>();
  const combined: TravelBlog[] = [];

  for (const blog of [...localBlogs, ...bundledBlogs]) {
    if (blog && blog.id && !seenIds.has(blog.id)) {
      seenIds.add(blog.id);
      combined.push(blog);
    }
  }
  return combined.sort((a, b) => b.timestamp - a.timestamp);
}

export async function publishBlogToDatabase(params: {
  author: string;
  groupName: string;
  groupContact?: string;
  location: string;
  title: string;
  summary: string;
  content: string;
  coverImage?: string;
}): Promise<TravelBlog> {
  const now = Date.now();
  const newBlog: TravelBlog = {
    id: 'tb_' + now + '_' + Math.random().toString(36).substring(2, 6),
    title: params.title,
    author: params.author,
    groupName: params.groupName,
    groupContact: params.groupContact,
    location: params.location,
    summary: params.summary,
    content: params.content,
    coverImage: params.coverImage ? stripTrackingParams(params.coverImage) : undefined,
    publishedAt: new Date(now).toISOString(),
    timestamp: now,
    readTimeMin: calculateReadTime(params.content),
    likesCount: 0,
  };

  try {
    if (typeof localStorage !== 'undefined') {
      const existing = loadLocalTravelBlogs();
      localStorage.setItem(LOCAL_BLOGS_STORAGE_KEY, JSON.stringify([newBlog, ...existing]));
    }
  } catch {
    // ignore storage quota errors
  }

  return newBlog;
}
