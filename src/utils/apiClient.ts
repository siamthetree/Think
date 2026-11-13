import { CapacitorHttp } from '@capacitor/core';
import type { FeedItem, TravelBlog } from '../types';
import bundledBlogs from '../../data/blogs.json';
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

export const SAFARI_IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// AbortSignal.timeout throws on older iOS WebViews, so use a manual timer.
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isValidFetchedDocument(text: string): boolean {
  if (!text || text.trim().length <= 50) return false;
  const sample = text.slice(0, 1200);
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

  // 1. Primary path: CapacitorHttp.get (uses native URLSession on iOS and fetch on web, with no cookies or referrer)
  try {
    const res = await CapacitorHttp.get({
      url: safeUrl,
      responseType: 'text',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      webFetchExtra: {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      },
      headers: {
        'User-Agent': SAFARI_IOS_USER_AGENT,
        Accept:
          'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml, */*',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
      },
    });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    if (res.status >= 200 && res.status < 300 && isValidFetchedDocument(body)) {
      return body;
    }
    if (res.status === 404 || res.status === 410) {
      throw new Error(`HTTP ${res.status} for ${safeUrl}`);
    }
  } catch {
    // Fall through to standard credential-free fetch
  }

  // 2. Credential-free standard fetch fallback
  try {
    const directRes = await fetch(safeUrl, {
      signal: timeoutSignal(timeoutMs),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
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
    // Direct fetch blocked by CORS or failed
  }

  throw new Error(`Unable to reach ${safeUrl} directly`);
}

export async function fetchFeedWithFallback(params: {
  url: string;
  feedId: string;
  title: string;
  tags: string[];
  minItems?: number;
  excludeKeys?: string[];
}): Promise<{ feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string }> {
  let normalizedUrl = params.url.trim();
  if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl) && !normalizedUrl.startsWith('/')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  const normalizedParams = { ...params, url: normalizedUrl };
  return fetchFeedOnDevice(normalizedParams);
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

  // Step 1: Try fetching the given URL directly
  let rawText = '';
  try {
    rawText = await fetchRawUrlClientSide(params.url, 6500);
    if (isXmlString(rawText)) {
      const parsed = parseXmlFeed(rawText, feedInfo);
      if (parsed.items.length > 0) {
        return { ...parsed, resolvedFeedUrl: params.url };
      }
    }
  } catch {
    // Will continue to RSS candidate discovery
  }

  // Step 2: Search for an RSS feed link on the same publisher domain before falling back to HTML scraping
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
  try {
    const extracted = await extractArticleOnDevice(cleanUrl);
    if (extracted.success && Array.isArray(extracted.blocks)) {
      const validBlocks = extracted.blocks.filter(
        (b: ExtractedArticleBlock) => !b.text || !isBoilerplateOrJsWarning(b.text)
      );
      if (validBlocks.some((block: ExtractedArticleBlock) => (block.text || '').trim().length > 40)) {
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

// Local On-Device Image Cache (via CapacitorHttp with no cookies or referrer)
const MEMORY_IMAGE_CACHE = new Map<string, string>();
const MAX_MEMORY_IMAGES = 80;
const IMAGE_IDB_NAME = 'chinta_image_cache_db';
const IMAGE_IDB_STORE = 'images';

function openImageCacheIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IMAGE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IMAGE_IDB_STORE)) {
          db.createObjectStore(IMAGE_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readImageFromIdb(url: string): Promise<string | null> {
  const db = await openImageCacheIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IMAGE_IDB_STORE, 'readonly');
      const req = tx.objectStore(IMAGE_IDB_STORE).get(url);
      req.onsuccess = () => {
        resolve(typeof req.result === 'string' ? req.result : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeImageToIdb(url: string, dataUrl: string): void {
  if (!dataUrl || dataUrl.length > 2_500_000) return;
  openImageCacheIdb()
    .then((db) => {
      if (!db) return;
      const tx = db.transaction(IMAGE_IDB_STORE, 'readwrite');
      tx.objectStore(IMAGE_IDB_STORE).put(dataUrl, url);
    })
    .catch(() => {});
}

function rememberImageInMemory(url: string, dataUrl: string): void {
  if (MEMORY_IMAGE_CACHE.size >= MAX_MEMORY_IMAGES) {
    const oldestKey = MEMORY_IMAGE_CACHE.keys().next().value;
    if (oldestKey) MEMORY_IMAGE_CACHE.delete(oldestKey);
  }
  MEMORY_IMAGE_CACHE.set(url, dataUrl);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

function inferImageMimeType(url: string, headerType?: string): string {
  if (headerType && headerType.toLowerCase().startsWith('image/')) {
    return headerType.split(';')[0].trim();
  }
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export function getCachedImageSync(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return imageUrl;
  return MEMORY_IMAGE_CACHE.get(imageUrl) ?? null;
}

/**
 * Loads an article image through CapacitorHttp with no cookies and no referrer,
 * caches the resulting data URL in memory and IndexedDB, and returns the cached data URL.
 */
export async function fetchImageWithCache(imageUrl: string, timeoutMs = 8000): Promise<string> {
  const trimmed = (imageUrl || '').trim();
  if (!trimmed) throw new Error('Empty image URL');
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const memCached = MEMORY_IMAGE_CACHE.get(trimmed);
  if (memCached) return memCached;

  const idbCached = await readImageFromIdb(trimmed);
  if (idbCached) {
    rememberImageInMemory(trimmed, idbCached);
    return idbCached;
  }

  const check = checkSafeExternalUrl(trimmed);
  if (!check.ok || !check.url) {
    throw new Error(check.reason || 'Blocked unsafe image URL');
  }
  const safeUrl = check.url.href;

  // 1. Fetch via CapacitorHttp with no cookies and generic Safari iOS User-Agent
  try {
    const res = await CapacitorHttp.get({
      url: safeUrl,
      responseType: 'blob',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      webFetchExtra: {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      },
      headers: {
        'User-Agent': SAFARI_IOS_USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (res.status >= 200 && res.status < 300 && res.data) {
      const rawContentType =
        (res.headers && (res.headers['content-type'] || res.headers['Content-Type'])) || '';
      const mimeType = inferImageMimeType(safeUrl, rawContentType);
      let dataUrl = '';

      if (typeof res.data === 'string') {
        dataUrl = res.data.startsWith('data:image/')
          ? res.data
          : `data:${mimeType};base64,${res.data}`;
      } else if (typeof Blob !== 'undefined' && res.data instanceof Blob) {
        dataUrl = await blobToDataUrl(res.data);
      }

      if (dataUrl) {
        rememberImageInMemory(trimmed, dataUrl);
        writeImageToIdb(trimmed, dataUrl);
        return dataUrl;
      }
    }
  } catch {
    // Fall through to credential-free fetch
  }

  // 2. Credential-free standard fetch fallback
  const directRes = await fetch(safeUrl, {
    signal: timeoutSignal(timeoutMs),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  if (!directRes.ok) {
    throw new Error(`Image HTTP ${directRes.status}`);
  }
  const blob = await directRes.blob();
  const dataUrl = await blobToDataUrl(blob);
  rememberImageInMemory(trimmed, dataUrl);
  writeImageToIdb(trimmed, dataUrl);
  return dataUrl;
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
  // Pure on-device extractive summary (no cloud or third-party AI calls)
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
    context: 'Key takeaways distilled on-device directly from the news report.',
  };
}

export function blogToFeedItem(blog: TravelBlog): FeedItem {
  const parsedDate = parseFeedDate(blog.publishedAt);
  const timestamp = parsedDate.hasValidDate ? parsedDate.timestamp : blog.timestamp;
  return {
    id: blog.id,
    feedId: 'travel_blogs_bd',
    feedTitle: blog.groupName ? `${blog.groupName} (${blog.author})` : `Traveler: ${blog.author}`,
    feedUrl: 'local://blogs',
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
  return (bundledBlogs as TravelBlog[]).map((b) => ({ ...b }));
}

export async function publishBlogToDatabase(_params: {
  author: string;
  groupName: string;
  groupContact?: string;
  location: string;
  title: string;
  summary: string;
  content: string;
  coverImage?: string;
}): Promise<TravelBlog> {
  throw new Error('Travel blog publishing is disabled in read-only local mode.');
}
