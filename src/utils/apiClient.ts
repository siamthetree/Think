import type { FeedItem, TravelBlog } from '../types';
import {
  parseXmlFeed,
  parseHtmlPortalToFeed,
  stripHtml,
  resolveUrl,
  calculateReadTime,
} from './feedParser';
import { escapeHtml } from './sanitize';

const CLOUD_BACKEND =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL?.trim() || '';

// AbortSignal.timeout throws on older iOS WebViews, so use a manual timer.
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
    Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())
  );
}

function getApiEndpoints(pathAndQuery: string): string[] {
  const cloud = CLOUD_BACKEND ? [`${CLOUD_BACKEND}${pathAndQuery}`] : [];
  if (isNativeCapacitor()) {
    // Native app: only the configured backend (if any). There is no local server.
    return cloud;
  }
  // Web: local Express proxy first, then the configured backend
  return [pathAndQuery, ...cloud];
}

async function fetchRawUrlClientSide(targetUrl: string): Promise<string> {
  // 1. Direct native fetch (works natively on iOS via CapacitorHttp / NSURLSession without CORS)
  try {
    const directRes = await fetch(targetUrl, {
      signal: timeoutSignal(8500),
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, text/html, application/xhtml+xml, */*',
      },
    });
    if (directRes.ok) {
      const text = await directRes.text();
      if (text && text.trim().length > 50) {
        return text;
      }
    }
  } catch (directErr) {
    // Direct fetch blocked by CORS in desktop browser or news site requires proxy
  }

  // 2. Resilient CORS proxy gateways
  const gateways = [
    `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
  ];

  for (const gateway of gateways) {
    try {
      const res = await fetch(gateway, { signal: timeoutSignal(9000) });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 50) {
          return text;
        }
      }
    } catch {
      // try next gateway
    }
  }

  // 3. News domain RSS index fallback
  try {
    const parsed = new URL(targetUrl);
    const domain = parsed.hostname.replace(/^www\./, '');
    const gNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent('site:' + domain)}&hl=en-BD&gl=BD&ceid=BD:en`;
    const gRes = await fetch(gNewsUrl, { signal: timeoutSignal(6000) });
    if (gRes.ok) {
      const gText = await gRes.text();
      if (gText && gText.includes('<rss')) {
        return gText;
      }
    }
  } catch {}

  throw new Error(`Unable to reach target news source from iPhone (${targetUrl})`);
}

export async function fetchFeedWithFallback(params: {
  url: string;
  feedId: string;
  title: string;
  tags: string[];
}): Promise<{ feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string }> {
  const query = `url=${encodeURIComponent(params.url)}&feedId=${encodeURIComponent(
    params.feedId
  )}&title=${encodeURIComponent(params.title)}&tags=${encodeURIComponent(params.tags.join(','))}`;

  const endpoints = getApiEndpoints(`/api/rss?${query}`);

  const viaBackend = async () => {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { signal: timeoutSignal(12000) });
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = await response.json();
          if (data && Array.isArray(data.items) && data.items.length > 0) {
            return data as { feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string };
          }
        }
      } catch {
        // try next endpoint
      }
    }
    return null;
  };

  // Native app: on-device first (no dead backend wait), backend second.
  if (isNativeCapacitor()) {
    try {
      return await fetchFeedOnDevice(params);
    } catch (deviceErr) {
      const backendData = await viaBackend();
      if (backendData) return backendData;
      throw deviceErr;
    }
  }

  const backendData = await viaBackend();
  if (backendData) return backendData;
  return fetchFeedOnDevice(params);
}

async function fetchFeedOnDevice(params: {
  url: string;
  feedId: string;
  title: string;
  tags: string[];
}): Promise<{ feedTitle: string; items: FeedItem[]; resolvedFeedUrl?: string }> {
  if (params.url.includes('tbsnews.net')) {
    try {
      const r2jUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://www.tbsnews.net/top-news/rss.xml')}`;
      const r2jRes = await fetch(r2jUrl, { signal: timeoutSignal(6500) });
      if (r2jRes.ok) {
        const r2jData = await r2jRes.json();
        if (r2jData.status === 'ok' && Array.isArray(r2jData.items) && r2jData.items.length > 0) {
          const items: FeedItem[] = r2jData.items.map((item: any) => {
            const timestamp = Date.parse(item.pubDate) || Date.now();
            const summary = stripHtml(item.description || item.content || '').slice(0, 240);
            return {
              id: `${params.feedId}_${encodeURIComponent(item.link || item.guid || item.title).slice(0, 80)}`,
              feedId: params.feedId,
              feedTitle: params.title || 'The Business Standard (TBS)',
              feedUrl: params.url,
              title: stripHtml(item.title),
              link: item.link,
              pubDate: new Date(timestamp).toISOString(),
              timestamp,
              author: item.author ? stripHtml(item.author) : 'TBS Report',
              summary,
              contentHtml: item.content || item.description || `<p>${summary}</p>`,
              contentClean: stripHtml(item.content || item.description || ''),
              imageUrl: item.thumbnail || item.enclosure?.link,
              tags: [...params.tags],
              isRead: false,
              isBookmarked: false,
              isOfflineCached: true,
              readTimeMin: calculateReadTime(item.content || item.description || summary),
            };
          });
          return {
            feedTitle: params.title || 'The Business Standard (TBS)',
            items,
            resolvedFeedUrl: 'https://www.tbsnews.net/top-news/rss.xml',
          };
        }
      }
    } catch {}
  }

  const isXmlString = (s: string) => {
    const t = s.trim();
    return (
      t.startsWith('<?xml') ||
      t.startsWith('<rss') ||
      t.startsWith('<feed') ||
      /<rss[\s>]|<feed[\s>]|<channel[\s>]/i.test(t.slice(0, 1200))
    );
  };

  const rawText = await fetchRawUrlClientSide(params.url);

  const feedInfo = {
    id: params.feedId,
    title: params.title,
    url: params.url,
    defaultTags: params.tags,
  };

  if (isXmlString(rawText)) {
    const parsed = parseXmlFeed(rawText, feedInfo);
    return { ...parsed, resolvedFeedUrl: params.url };
  }

  // Website URL given: 1) Check <link> tags in HTML for RSS/Atom feed (at most 2 discovered tags)
  const linkCandidates: string[] = [];
  const linkTagMatches = [
    ...rawText.matchAll(
      /<link[^>]+(?:type=["']application\/(?:rss|atom)\+xml["']|rel=["']alternate["'])[^>]*>/gi
    ),
  ];
  for (const m of linkTagMatches) {
    const tag = m[0];
    if (!/(rss|atom|xml|feed)/i.test(tag)) continue;
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (hrefMatch?.[1]) {
      const resolved = resolveUrl(hrefMatch[1], params.url);
      if (resolved && resolved !== params.url && !linkCandidates.includes(resolved)) {
        linkCandidates.push(resolved);
      }
    }
  }

  for (const candidateUrl of linkCandidates.slice(0, 2)) {
    try {
      const text = await fetchRawUrlClientSide(candidateUrl);
      if (isXmlString(text)) {
        const parsed = parseXmlFeed(text, { ...feedInfo, url: candidateUrl });
        if (parsed.items.length > 0) {
          return { ...parsed, resolvedFeedUrl: candidateUrl };
        }
      }
    } catch {}
  }

  // 2) Parse direct portal HTML immediately if it already contains news articles (avoids 10 extra requests per portal on iOS)
  const scraped = parseHtmlPortalToFeed(rawText, feedInfo);
  if (scraped.items.length >= 3) {
    return { ...scraped, resolvedFeedUrl: params.url };
  }

  // 3) If HTML portal didn't yield articles, probe common RSS path combinations sequentially
  const probeCandidates: string[] = [];
  try {
    const parsedTarget = new URL(params.url);
    const cleanBase = params.url.replace(/\/+$/, '');
    const origin = parsedTarget.origin;
    const pathClean = parsedTarget.pathname.replace(/\/+$/, '');

    if (parsedTarget.hostname.includes('medium.com') && pathClean && !pathClean.startsWith('/feed')) {
      probeCandidates.push(`${origin}/feed${pathClean}`);
    }

    const suffixes = ['/feed', '/rss.xml', '/rss', '/atom.xml', '/?feed=rss2'];
    for (const s of suffixes) {
      const u = `${cleanBase}${s}`;
      if (!probeCandidates.includes(u)) probeCandidates.push(u);
    }
  } catch {}

  for (const candidateUrl of probeCandidates.slice(0, 4)) {
    try {
      const text = await fetchRawUrlClientSide(candidateUrl);
      if (isXmlString(text)) {
        const parsed = parseXmlFeed(text, { ...feedInfo, url: candidateUrl });
        if (parsed.items.length > 0) {
          return { ...parsed, resolvedFeedUrl: candidateUrl };
        }
      }
    } catch {}
  }

  if (scraped.items.length > 0) {
    return { ...scraped, resolvedFeedUrl: params.url };
  }

  throw new Error('No articles found for this source');
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
  const query = `url=${encodeURIComponent(url)}`;
  const endpoints = getApiEndpoints(`/api/extract?${query}`);

  const viaBackend = async (): Promise<ExtractedArticleData | null> => {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { signal: timeoutSignal(12000) });
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = await response.json();
          if (data && data.success && Array.isArray(data.blocks) && data.blocks.some((block: ExtractedArticleBlock) => (block.text || '').trim().length > 80)) {
            return data as ExtractedArticleData;
          }
        }
      } catch {
        // try next endpoint
      }
    }
    return null;
  };

  if (isNativeCapacitor()) {
    try {
      const local = await extractArticleOnDevice(url);
      if (local.success) return local;
    } catch {
      // fall through to backend
    }
    const remote = await viaBackend();
    if (remote) return remote;
    throw new Error('Could not extract article');
  }

  const remote = await viaBackend();
  if (remote) return remote;
  return extractArticleOnDevice(url);
}

async function extractArticleOnDevice(url: string): Promise<ExtractedArticleData> {
  const html = await fetchRawUrlClientSide(url);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  let jsonLdBody = '';
  let jsonLdTitle = '';
  let jsonLdAuthor = '';
  let jsonLdImage = '';

  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const parsed = JSON.parse(el.textContent || '');
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        if (item?.articleBody && String(item.articleBody).length > jsonLdBody.length) {
          jsonLdBody = String(item.articleBody);
        }
        if (!jsonLdTitle && (item?.headline || item?.name)) {
          jsonLdTitle = stripHtml(String(item.headline || item.name));
        }
        if (!jsonLdAuthor && item?.author) {
          const a = Array.isArray(item.author) ? item.author[0] : item.author;
          if (typeof a === 'string') jsonLdAuthor = a;
          else if (a?.name) jsonLdAuthor = String(a.name);
        }
        if (!jsonLdImage && item?.image) {
          const img = Array.isArray(item.image) ? item.image[0] : item.image;
          if (typeof img === 'string') jsonLdImage = img;
          else if (img?.url) jsonLdImage = String(img.url);
        }
      }
    } catch {}
  });

  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    jsonLdTitle ||
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.title ||
    'Newspaper Story';

  const author =
    doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
    jsonLdAuthor ||
    '';

  const leadImageRaw =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    jsonLdImage ||
    '';
  const leadImage = leadImageRaw ? resolveUrl(leadImageRaw, url) : '';

  const blocks: ExtractedArticleBlock[] = [];
  doc.querySelectorAll('article p, main p, p').forEach((p) => {
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 35) {
      blocks.push({ type: 'p', text });
    }
  });

  if (blocks.length < 3 && jsonLdBody.trim().length > 80) {
    jsonLdBody
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25)
      .forEach((s) => blocks.push({ type: 'p', text: s }));
  }

  const contentClean = blocks.map((b) => b.text || '').join(' ');
  return {
    success: blocks.length > 0,
    title: stripHtml(title),
    author: stripHtml(author),
    leadImage,
    readTimeMin: calculateReadTime(contentClean),
    blocks,
  };
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
        headers: { 'Content-Type': 'application/json' },
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
      // try next endpoint or client fallback
    }
  }

  // Client-side extractive fallback
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
    context: `Key takeaways distilled directly from the news report.`,
  };
}

export function blogToFeedItem(blog: TravelBlog): FeedItem {
  return {
    id: blog.id,
    feedId: 'travel_blogs_bd',
    feedTitle: blog.groupName ? `${blog.groupName} (${blog.author})` : `Traveler: ${blog.author}`,
    feedUrl: '/api/blogs',
    title: blog.title,
    link: `/blog/${blog.id}`,
    pubDate: blog.publishedAt,
    timestamp: blog.timestamp,
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
      const res = await fetch(endpoint, { signal: timeoutSignal(10000) });
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
        headers: { 'Content-Type': 'application/json' },
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

  // Client-side fallback if server is unreachable
  return {
    id: 'tb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    title: params.title,
    author: params.author,
    groupName: params.groupName,
    groupContact: params.groupContact,
    location: params.location,
    summary: params.summary,
    content: params.content,
    coverImage: params.coverImage,
    publishedAt: new Date().toISOString(),
    timestamp: Date.now(),
    readTimeMin: calculateReadTime(params.content),
    likesCount: 0,
  };
}
