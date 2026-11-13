import { CapacitorHttp } from '@capacitor/core';
import { FeedItem } from '../types';
import {
  calculateReadTime,
  parseHtmlPortalToFeed,
  parseXmlFeed,
  stripHtml,
} from './feedParser';
import { validateSafeExternalUrl } from './urlSecurity';

export const GENERIC_USER_AGENT = 'ChintaReader/2.0';

export interface ExtractedArticleResult {
  title?: string;
  author?: string;
  publishedTime?: string;
  siteName?: string;
  leadImage?: string;
  contentHtml: string;
  contentClean: string;
  readTimeMin: number;
  paragraphCount: number;
}

/**
 * Detects whether the app is running inside a native iOS Capacitor IPA shell
 * or on a mobile screen.
 */
export function isRunningInNativeIos(): boolean {
  if (typeof window === 'undefined') return false;
  const proto = window.location.protocol;
  const isCapacitor =
    proto === 'capacitor:' ||
    proto === 'ionic:' ||
    proto === 'file:' ||
    Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  return isCapacitor;
}

/**
 * Fetches raw text/HTML from a validated target URL directly via native CapacitorHttp
 * or standard browser fetch without routing user URLs to untrusted third-party CORS proxies.
 */
async function fetchRawUrlText(targetUrl: string): Promise<{ text: string; finalUrl: string }> {
  const safeUrl = validateSafeExternalUrl(targetUrl).href;

  if (isRunningInNativeIos()) {
    try {
      const res = await CapacitorHttp.get({
        url: safeUrl,
        responseType: 'text',
        connectTimeout: 8000,
        readTimeout: 8000,
        headers: {
          'User-Agent': GENERIC_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        webFetchExtra: {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        },
      });
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
      if (res.status >= 200 && res.status < 300 && text.trim().length > 40) {
        return { text, finalUrl: res.url || safeUrl };
      }
    } catch {
      // Fall through to standard fetch
    }
  }

  const res = await fetch(safeUrl, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    headers: {
      'User-Agent': GENERIC_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Unable to fetch ${safeUrl} (HTTP ${res.status})`);
  }
  const text = await res.text();
  return { text, finalUrl: res.url || safeUrl };
}

/**
 * Pure client-side HTML article extractor (used in the iOS .ipa when offline from Node backend).
 * Extracts JSON-LD articleBody and clean paragraph/heading blocks for Distraction-Free Reader View.
 */
export function extractReadableArticleFromHtml(
  html: string,
  baseUrl: string
): ExtractedArticleResult {
  const resolveRelative = (raw: string | undefined | null): string => {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:')) return '';
    try {
      const resolved = new URL(trimmed, baseUrl);
      if (resolved.pathname.startsWith('/_next/image')) {
        const inner = resolved.searchParams.get('url');
        if (inner) return new URL(inner, baseUrl).href;
      }
      return resolved.href;
    } catch {
      return trimmed;
    }
  };

  const getMeta = (key: string): string => {
    const r1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      'i'
    );
    const r2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      'i'
    );
    return stripHtml(html.match(r1)?.[1] || html.match(r2)?.[1] || '');
  };

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  let title =
    getMeta('og:title') ||
    getMeta('twitter:title') ||
    (h1Match?.[1] ? stripHtml(h1Match[1]) : '') ||
    (titleTagMatch?.[1] ? stripHtml(titleTagMatch[1]) : '');

  let author = getMeta('author') || getMeta('article:author') || '';
  let publishedTime =
    getMeta('article:published_time') || getMeta('pubdate') || getMeta('date') || '';
  const siteName = getMeta('og:site_name') || '';
  let leadImage = resolveRelative(getMeta('og:image') || getMeta('twitter:image'));

  const structuredParagraphs: string[] = [];

  const jsonLdMatches = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const candidates = Array.isArray(parsed)
        ? parsed
        : parsed['@graph'] && Array.isArray(parsed['@graph'])
        ? parsed['@graph']
        : [parsed];

      for (const item of candidates) {
        if (!item || typeof item !== 'object') continue;
        if (!title && typeof item.headline === 'string') title = stripHtml(item.headline);
        if (!publishedTime && typeof item.datePublished === 'string') {
          publishedTime = item.datePublished;
        }
        if (!author && item.author) {
          const a = Array.isArray(item.author) ? item.author[0] : item.author;
          if (typeof a === 'string') author = a;
          else if (a && typeof a.name === 'string') author = a.name;
        }
        if (!leadImage && item.image) {
          const img = Array.isArray(item.image) ? item.image[0] : item.image;
          if (typeof img === 'string') leadImage = resolveRelative(img);
          else if (img && typeof img.url === 'string') leadImage = resolveRelative(img.url);
        }
        const bodyText = item.articleBody || item.text;
        if (typeof bodyText === 'string' && bodyText.trim().length > 120) {
          const cleaned = stripHtml(bodyText);
          const splits = cleaned
            .split(/\n{2,}|\r\n{2,}/)
            .map((s) => s.trim())
            .filter((s) => s.length > 25);
          if (splits.length > 1) {
            structuredParagraphs.push(...splits);
          } else if (cleaned.length > 120) {
            structuredParagraphs.push(cleaned);
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  }

  const bodyOnly = html
    .replace(/<(script|style|noscript|iframe|svg|nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const paragraphs: string[] = [];
  const seenText = new Set<string>();

  const blockMatches = [
    ...bodyOnly.matchAll(/<(p|h2|h3|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi),
  ];

  for (const match of blockMatches) {
    const tag = match[1].toLowerCase();
    const text = stripHtml(match[2]);
    if (!text || text.length < 28) continue;
    if (seenText.has(text)) continue;
    if (
      /^(all rights reserved|copyright ©|subscribe to|sign up for|follow us on|read more:|also read:|related stories|advertisement|published by)/i.test(
        text
      )
    ) {
      continue;
    }
    seenText.add(text);

    if (tag === 'h2' || tag === 'h3') {
      paragraphs.push(`<h2>${text}</h2>`);
    } else if (tag === 'blockquote') {
      paragraphs.push(`<blockquote>${text}</blockquote>`);
    } else {
      paragraphs.push(`<p>${text}</p>`);
    }
  }

  for (const sp of structuredParagraphs) {
    if (!seenText.has(sp)) {
      seenText.add(sp);
      paragraphs.push(`<p>${sp}</p>`);
    }
  }

  const descriptionFallback = getMeta('og:description') || getMeta('description');
  if (paragraphs.length === 0 && descriptionFallback) {
    paragraphs.push(`<p>${descriptionFallback}</p>`);
  }

  const contentHtml = paragraphs.join('\n');
  const contentClean = stripHtml(contentHtml);
  const readTimeMin = calculateReadTime(contentClean);

  return {
    title,
    author,
    publishedTime,
    siteName,
    leadImage,
    contentHtml,
    contentClean,
    readTimeMin,
    paragraphCount: paragraphs.length,
  };
}

/**
 * Universal Feed Loader:
 * Uses `/api/rss` when connected to the Node server or relay, and falls back
 * to on-device native fetching + parsing inside the iOS .ipa build.
 */
export async function fetchFeedUniversal(feed: {
  id: string;
  title: string;
  url: string;
  defaultTags?: string[];
}): Promise<{ feedTitle: string; items: FeedItem[] }> {
  if (!isRunningInNativeIos()) {
    try {
      const params = new URLSearchParams({
        url: feed.url,
        feedId: feed.id,
        feedTitle: feed.title,
        defaultTags: (feed.defaultTags || []).join(','),
      });
      const res = await fetch(`/api/rss?${params.toString()}`, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data && Array.isArray(data.items)) {
          return {
            feedTitle: data.feedTitle || feed.title,
            items: data.items,
          };
        }
      }
    } catch {
      // Fall through to native on-device fetcher
    }
  }

  const { text, finalUrl } = await fetchRawUrlText(feed.url);
  const trimmed = text.trim();

  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    const portalData = parseHtmlPortalToFeed(text, {
      ...feed,
      url: finalUrl,
    });
    if (portalData.items.length > 0) {
      return portalData;
    }
  }

  return parseXmlFeed(text, {
    ...feed,
    url: finalUrl,
  });
}

/**
 * Universal Article Reader Extractor:
 * Uses `/api/extract` when connected to the Node server, and falls back
 * to on-device HTML/JSON-LD extraction inside the iOS .ipa build.
 */
export async function extractArticleUniversal(
  articleUrl: string
): Promise<ExtractedArticleResult> {
  if (!isRunningInNativeIos()) {
    try {
      const res = await fetch(`/api/extract?url=${encodeURIComponent(articleUrl)}`, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data && data.contentHtml) {
          return data;
        }
      }
    } catch {
      // Fall through to native on-device extractor
    }
  }

  const { text, finalUrl } = await fetchRawUrlText(articleUrl);
  return extractReadableArticleFromHtml(text, finalUrl);
}
