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
import { checkSafeExternalUrl } from './urlSecurity';
import { deduplicateFeedItems, isArticleInReadKeys } from './feedIntelligence';

export const GENERIC_USER_AGENT = 'ChintaReader/2.0';

const ENV_BACKEND =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL?.trim() || '';

const FALLBACK_CLOUD_BACKENDS = Array.from(
  new Set(
    [
      ENV_BACKEND,
      'https://ais-pre-qetfpxcsmchifsxdsds37n-79584864695.asia-southeast1.run.app',
      'https://ais-dev-qetfpxcsmchifsxdsds37n-79584864695.asia-southeast1.run.app',
    ].filter(Boolean)
  )
);

const CLIENT_HEADERS: Record<string, string> = {
  'X-Chinta-Client': 'chinta-ios-2.0',
};

export function getRelayBase(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = localStorage.getItem('chinta_privacy_v1');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    const url = String(parsed.relayUrl || '').trim();
    if (!url) return '';
    if (/^https:\/\//i.test(url) || /^http:\/\/localhost(?::\d+)?/i.test(url)) {
      return url.replace(/\/+$/, '');
    }
  } catch {}
  return '';
}

export function getConnectionMode(): 'relay' | 'direct' {
  if (typeof window === 'undefined') return 'relay';
  try {
    const raw = localStorage.getItem('chinta_privacy_v1');
    if (!raw) return 'relay';
    const parsed = JSON.parse(raw);
    return parsed.connectionMode === 'direct' ? 'direct' : 'relay';
  } catch {}
  return 'relay';
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isNativeCapacitor(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:' ||
    window.location.protocol === 'file:' ||
    Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
    )
  );
}

export function getApiEndpoints(pathAndQuery: string): string[] {
  const relay = getRelayBase();
  if (relay) {
    // When a relay is set, use it INSTEAD of cloud backends with no silent fallback
    return [`${relay}${pathAndQuery}`];
  }
  const cloud = FALLBACK_CLOUD_BACKENDS.map((base) => `${base.replace(/\/+$/, '')}${pathAndQuery}`);
  if (isNativeCapacitor()) {
    return cloud;
  }
  return ENV_BACKEND ? [pathAndQuery, `${ENV_BACKEND.replace(/\/+$/, '')}${pathAndQuery}`] : [pathAndQuery];
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

async function fetchRawUrlClientSide(targetUrl: string, timeoutMs = 7500): Promise<string> {
  const check = checkSafeExternalUrl(targetUrl);
  if (!check.ok || !check.url) {
    throw new Error(check.reason || 'Blocked unsafe URL');
  }
  const safeUrl = check.url.href;

  if (isNativeCapacitor()) {
    try {
      const res = await CapacitorHttp.get({
        url: safeUrl,
        responseType: 'text',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        headers: {
          'User-Agent': GENERIC_USER_AGENT,
          Accept:
            'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml, */*',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        },
        webFetchExtra: {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        },
      });
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
      if (res.status >= 200 && res.status < 300 && isValidFetchedDocument(body)) {
        return body;
      }
    } catch {
      // Fall through to standard fetch
    }
  }

  try {
    const directRes = await fetch(safeUrl, {
      signal: timeoutSignal(timeoutMs),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: {
        'User-Agent': GENERIC_USER_AGENT,
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
    // Direct fetch failed
  }

  throw new Error(`Unable to reach ${safeUrl} directly`);
}

export async function fetchFeedWithFallback(params: {
  url: string;
  feedId: string;
  title: string;
  tags: string[];
  excludeKeys?: string[];
  minItems?: number;
}): Promise<{ feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string }> {
  let normalizedUrl = params.url.trim();
  if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl) && !normalizedUrl.startsWith('/')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  const minItems = Math.max(50, Math.min(100, params.minItems ?? 50));
  const excludeKeys = (params.excludeKeys || []).slice(-1500);
  const excludeSet = excludeKeys.length > 0 ? new Set(excludeKeys) : null;
  const normalizedParams = { ...params, url: normalizedUrl, minItems, excludeKeys };

  // Direct mode bypasses the backend proxy entirely
  if (getConnectionMode() === 'direct') {
    return fetchFeedOnDevice(normalizedParams);
  }

  const query = `url=${encodeURIComponent(normalizedParams.url)}&feedId=${encodeURIComponent(
    normalizedParams.feedId
  )}&title=${encodeURIComponent(normalizedParams.title)}&tags=${encodeURIComponent(
    normalizedParams.tags.join(',')
  )}&minItems=${minItems}`;

  const postEndpoints = getApiEndpoints('/api/rss');
  const getEndpoints = getApiEndpoints(`/api/rss?${query}`);

  const viaBackend = async () => {
    for (let i = 0; i < postEndpoints.length; i += 1) {
      const postUrl = postEndpoints[i];
      const getUrl = getEndpoints[i] || getEndpoints[0];
      try {
        const postRes = await fetch(postUrl, {
          method: 'POST',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': GENERIC_USER_AGENT,
            ...CLIENT_HEADERS,
          },
          body: JSON.stringify({
            url: normalizedParams.url,
            feedId: normalizedParams.feedId,
            title: normalizedParams.title,
            tags: normalizedParams.tags,
            minItems,
            excludeKeys,
          }),
          signal: timeoutSignal(14000),
        });
        const postCt = postRes.headers.get('content-type') || '';
        if (postRes.ok && postCt.includes('application/json')) {
          const data = await postRes.json();
          if (data && Array.isArray(data.items) && data.items.length > 0) {
            const filtered = excludeSet
              ? data.items.filter((item: FeedItem) => !isArticleInReadKeys(item, excludeSet))
              : data.items;
            return {
              ...data,
              items: deduplicateFeedItems(filtered),
            } as { feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string };
          }
        }
        if (postRes.status === 404 || postRes.status === 405) {
          const response = await fetch(getUrl, {
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            headers: {
              'User-Agent': GENERIC_USER_AGENT,
              ...CLIENT_HEADERS,
            },
            signal: timeoutSignal(12000),
          });
          const contentType = response.headers.get('content-type') || '';
          if (response.ok && contentType.includes('application/json')) {
            const data = await response.json();
            if (data && Array.isArray(data.items) && data.items.length > 0) {
              const filtered = excludeSet
                ? data.items.filter((item: FeedItem) => !isArticleInReadKeys(item, excludeSet))
                : data.items;
              return {
                ...data,
                items: deduplicateFeedItems(filtered),
              } as { feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string };
            }
          }
        }
      } catch {
        // try next endpoint
      }
    }
    return null;
  };

  const backendData = await viaBackend();
  if (backendData) return backendData;

  // If a relay is configured, do not silently fall back to cloud backends
  if (getRelayBase()) {
    return { feedTitle: normalizedParams.title, items: [], resolvedFeedUrl: normalizedParams.url };
  }

  if (isNativeCapacitor()) {
    return fetchFeedOnDevice(normalizedParams);
  }
  return { feedTitle: normalizedParams.title, items: [], resolvedFeedUrl: normalizedParams.url };
}

async function fetchFeedOnDevice(params: {
  url: string;
  feedId: string;
  title: string;
  tags: string[];
  excludeKeys?: string[];
  minItems?: number;
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

  const targetMin = Math.max(50, Math.min(100, params.minItems ?? 50));
  const excludeSet = params.excludeKeys && params.excludeKeys.length > 0 ? new Set(params.excludeKeys) : null;
  const feedInfo = {
    id: params.feedId,
    title: params.title,
    url: params.url,
    defaultTags: params.tags,
  };

  let collectedItems: FeedItem[] = [];
  let resolvedTitle = params.title;
  let resolvedUrl = params.url;

  const absorb = (items: FeedItem[], nextTitle?: string, nextResolvedUrl?: string) => {
    const unread = excludeSet
      ? items.filter((item) => !isArticleInReadKeys(item, excludeSet))
      : items;
    if (unread.length > 0) {
      collectedItems = deduplicateFeedItems([...collectedItems, ...unread]);
      if (nextTitle && nextTitle !== 'RSS Feed' && nextTitle !== 'Newspaper Feed') {
        resolvedTitle = nextTitle;
      }
      if (nextResolvedUrl && resolvedUrl === params.url) {
        resolvedUrl = nextResolvedUrl;
      }
    }
  };

  let rawText = '';
  try {
    rawText = await fetchRawUrlClientSide(params.url, 6500);
    if (isXmlString(rawText)) {
      const parsed = parseXmlFeed(rawText, feedInfo);
      absorb(parsed.items, parsed.feedTitle, params.url);
      if (collectedItems.length >= targetMin) {
        return { feedTitle: resolvedTitle, items: collectedItems, resolvedFeedUrl: resolvedUrl };
      }
    }
  } catch {
    // Continue to RSS candidates
  }

  if (!rawText || isXmlString(rawText)) {
    try {
      const origin = new URL(params.url).origin;
      const homeHtml = await fetchRawUrlClientSide(origin, 5000);
      if (!isXmlString(homeHtml)) {
        rawText = homeHtml;
      }
    } catch {
      // ignore
    }
  }

  const rssCandidates = buildRssDiscoveryCandidates(params.url, rawText);
  for (const candidateUrl of rssCandidates.slice(0, 8)) {
    if (collectedItems.length >= targetMin) break;
    try {
      const candidateText = await fetchRawUrlClientSide(candidateUrl, 3500);
      if (isXmlString(candidateText)) {
        const parsed = parseXmlFeed(candidateText, { ...feedInfo, url: candidateUrl });
        absorb(parsed.items, parsed.feedTitle, candidateUrl);
      }
    } catch {
      // Try next
    }
  }

  if (rawText && !isXmlString(rawText) && collectedItems.length < targetMin) {
    const scraped = parseHtmlPortalToFeed(rawText, feedInfo);
    absorb(scraped.items, scraped.feedTitle, params.url);
  }

  if (collectedItems.length < targetMin) {
    try {
      const parsed = new URL(params.url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const indexUrls = [
        `https://www.bing.com/news/search?q=${encodeURIComponent('site:' + domain)}&format=rss`,
        `https://news.google.com/rss/search?q=${encodeURIComponent('site:' + domain)}&hl=en-BD&gl=BD&ceid=BD:en`,
      ];
      for (const indexUrl of indexUrls) {
        if (collectedItems.length >= targetMin) break;
        try {
          const indexXml = await fetchRawUrlClientSide(indexUrl, 6000);
          if (isXmlString(indexXml)) {
            const parsedIndex = parseXmlFeed(indexXml, {
              ...feedInfo,
              title: params.title && params.title !== 'Newspaper Feed' ? params.title : domain,
              url: params.url,
            });
            absorb(parsedIndex.items, parsedIndex.feedTitle, params.url);
          }
        } catch {}
      }
    } catch {}
  }

  if (collectedItems.length > 0) {
    return { feedTitle: resolvedTitle, items: collectedItems, resolvedFeedUrl: resolvedUrl };
  }

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
  const cleanUrl = resolveUrl(url);

  // Direct mode bypasses the backend extractor entirely
  if (getConnectionMode() === 'direct') {
    return extractArticleOnDevice(cleanUrl);
  }

  const query = `url=${encodeURIComponent(cleanUrl)}`;
  const endpoints = getApiEndpoints(`/api/extract?${query}`);

  const viaBackend = async (): Promise<ExtractedArticleData | null> => {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          headers: {
            'User-Agent': GENERIC_USER_AGENT,
            ...CLIENT_HEADERS,
          },
          signal: timeoutSignal(10000),
        });
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = await response.json();
          if (data && data.success && Array.isArray(data.blocks)) {
            const validBlocks = data.blocks.filter(
              (b: ExtractedArticleBlock) => !b.text || !isBoilerplateOrJsWarning(b.text)
            );
            if (validBlocks.some((block: ExtractedArticleBlock) => (block.text || '').trim().length > 60)) {
              return { ...data, blocks: validBlocks } as ExtractedArticleData;
            }
          }
        }
      } catch {
        // try next endpoint
      }
    }
    return null;
  };

  const remote = await viaBackend();
  if (remote) return remote;

  if (getRelayBase()) {
    return { success: false, blocks: [] };
  }

  if (isNativeCapacitor()) {
    return extractArticleOnDevice(cleanUrl);
  }
  return { success: false, blocks: [] };
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
  const endpoints = getApiEndpoints('/api/summarize');

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': GENERIC_USER_AGENT,
          ...CLIENT_HEADERS,
        },
        body: JSON.stringify({
          title: params.title,
          text: params.text,
        }),
        signal: timeoutSignal(15000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.success && data.executiveSummary) {
          return data as ArticleSummaryResult;
        }
      }
    } catch {
      // try next endpoint or fallback
    }
  }

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
    context: 'Key takeaways distilled directly from the news report.',
  };
}

export function blogToFeedItem(blog: TravelBlog): FeedItem {
  const parsedDate = parseFeedDate(blog.publishedAt);
  const timestamp = parsedDate.hasValidDate ? parsedDate.timestamp : blog.timestamp;
  return {
    id: blog.id,
    feedId: 'travel_blogs_bd',
    feedTitle: blog.groupName ? `${blog.groupName} (${blog.author})` : `Traveler: ${blog.author}`,
    feedUrl: '/api/blogs',
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
    imageUrl: blog.coverImage,
    tags: ['tag_travel', 'tag_bd'],
    isRead: false,
    isBookmarked: false,
    isOfflineCached: true,
    readTimeMin: blog.readTimeMin || calculateReadTime(blog.content),
  };
}

export async function fetchTravelBlogsFromDatabase(): Promise<TravelBlog[]> {
  const endpoints = getApiEndpoints('/api/blogs');

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: {
          'User-Agent': GENERIC_USER_AGENT,
          ...CLIENT_HEADERS,
        },
        signal: timeoutSignal(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.blogs)) {
          return data.blogs as TravelBlog[];
        }
      }
    } catch {
      // try next endpoint
    }
  }
  return [];
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
  const endpoints = getApiEndpoints('/api/blogs');

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': GENERIC_USER_AGENT,
          ...CLIENT_HEADERS,
        },
        body: JSON.stringify(params),
        signal: timeoutSignal(12000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.blog) {
          return data.blog as TravelBlog;
        }
      }
    } catch {
      // try next endpoint
    }
  }

  const now = Date.now();
  return {
    id: 'tb_' + now + '_' + Math.random().toString(36).substring(2, 6),
    title: params.title,
    author: params.author,
    groupName: params.groupName,
    groupContact: params.groupContact,
    location: params.location,
    summary: params.summary,
    content: params.content,
    coverImage: params.coverImage,
    publishedAt: new Date(now).toISOString(),
    timestamp: now,
    readTimeMin: calculateReadTime(params.content),
    likesCount: 0,
  };
}
