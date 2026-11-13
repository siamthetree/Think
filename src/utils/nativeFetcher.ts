import { CapacitorHttp } from '@capacitor/core';
import { FeedItem } from '../types';
import {
  calculateReadTime,
  parseHtmlPortalToFeed,
  parseXmlFeed,
  stripHtml,
} from './feedParser';
import {
  validateSafeExternalUrl,
  stripTrackingParams,
  buildStatelessRelayUrl,
  isTrackerUrl,
} from './urlSecurity';
import { sanitizeArticleHtml } from './sanitize';
import { loadPrivacyPreferencesFromStorage } from './storage';

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

export const GENERIC_STATIC_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export const PRIVACY_FETCH_INIT: RequestInit = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
};

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
 * Resolves a feed or article URL through the optional user-configured stateless CORS/privacy relay
 * or static GitHub Pages feed mirror from storage.ts.
 */
export function resolveUrlThroughPrivacyRelay(
  targetUrl: string,
  options?: { feedId?: string; relayUrlOverride?: string; mirrorUrlOverride?: string }
): string {
  const safeTarget = validateSafeExternalUrl(stripTrackingParams(targetUrl)).href;
  const privacy = loadPrivacyPreferencesFromStorage();
  const mirrorBase = (options?.mirrorUrlOverride ?? privacy.staticFeedMirrorUrl ?? '').trim();
  const relayBase = (options?.relayUrlOverride ?? privacy.privacyRelayUrl ?? '').trim();

  if (mirrorBase && options?.feedId) {
    try {
      const parsedMirror = validateSafeExternalUrl(mirrorBase);
      const baseHref = parsedMirror.href.replace(/\/+$/, '');
      return `${baseHref}/feeds/${encodeURIComponent(options.feedId)}.xml`;
    } catch {
      // Fall through to relay or direct URL
    }
  }

  if (relayBase) {
    return buildStatelessRelayUrl(safeTarget, relayBase);
  }

  return safeTarget;
}

/**
 * Routes an image URL through the user-defined stateless privacy relay if configured.
 */
export function resolveImageThroughPrivacyRelay(
  imageUrl: string | undefined,
  relayUrlOverride?: string
): string | undefined {
  if (!imageUrl) return undefined;
  const clean = stripTrackingParams(imageUrl.trim());
  if (!clean || isTrackerUrl(clean)) return undefined;
  if (clean.startsWith('/') || clean.startsWith('data:')) return clean;

  const privacy = loadPrivacyPreferencesFromStorage();
  const relayBase = (relayUrlOverride ?? privacy.privacyRelayUrl ?? '').trim();
  if (!relayBase) return clean;

  try {
    return buildStatelessRelayUrl(clean, relayBase);
  } catch {
    return clean;
  }
}

/**
 * Fetches raw text/HTML from a validated target URL via optional stateless privacy relay,
 * native CapacitorHttp, or privacy-hardened browser fetch (credentials: 'omit',
 * referrerPolicy: 'no-referrer', cache: 'no-store').
 */
export async function fetchRawUrlText(
  targetUrl: string,
  options?: { feedId?: string; timeoutMs?: number }
): Promise<{ text: string; finalUrl: string }> {
  const safeDirectUrl = validateSafeExternalUrl(stripTrackingParams(targetUrl)).href;
  const requestUrl = resolveUrlThroughPrivacyRelay(safeDirectUrl, { feedId: options?.feedId });
  const timeoutMs = options?.timeoutMs ?? 8000;

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
        },
      });
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
      if (res.status >= 200 && res.status < 300 && text.trim().length > 40) {
        return { text, finalUrl: stripTrackingParams(res.url || safeDirectUrl) };
      }
    } catch {
      // Fall through to standard privacy-locked fetch
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(requestUrl, {
      ...PRIVACY_FETCH_INIT,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept:
          'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/xhtml+xml, */*',
      },
    });
    if (!res.ok) {
      throw new Error(`Unable to fetch ${safeDirectUrl} (HTTP ${res.status})`);
    }
    const text = await res.text();
    return { text, finalUrl: stripTrackingParams(res.url || safeDirectUrl) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pure client-side HTML article extractor.
 * Extracts JSON-LD articleBody and clean paragraph/heading blocks for Distraction-Free Reader View.
 */
export function extractReadableArticleFromHtml(
  html: string,
  baseUrl: string
): ExtractedArticleResult {
  const cleanBaseUrl = stripTrackingParams(baseUrl);
  const resolveRelative = (raw: string | undefined | null): string => {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:')) return '';
    try {
      const resolved = new URL(trimmed, cleanBaseUrl);
      if (resolved.pathname.startsWith('/_next/image')) {
        const inner = resolved.searchParams.get('url');
        if (inner) return stripTrackingParams(new URL(inner, cleanBaseUrl).href);
      }
      const cleanHref = stripTrackingParams(resolved.href);
      return isTrackerUrl(cleanHref) ? '' : cleanHref;
    } catch {
      return stripTrackingParams(trimmed);
    }
  };

  // Extract metadata via regex so it works in both Node tests and browser DOM
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

  // 1. Inspect JSON-LD scripts for full articleBody (used by Prothom Alo, bdnews24, Daily Star, etc.)
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

  // 2. Strip script/style/nav/footer/aside and extract clean <p>, <h2>, <h3>, <blockquote>
  const bodyOnly = html
    .replace(/<(script|style|noscript|iframe|object|embed|svg|nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
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

  const contentHtml = sanitizeArticleHtml(paragraphs.join('\n'), { articleUrl: cleanBaseUrl });
  const contentClean = stripHtml(contentHtml);
  const readTimeMin = calculateReadTime(contentClean);

  return {
    title,
    author,
    publishedTime,
    siteName,
    leadImage: leadImage || undefined,
    contentHtml,
    contentClean,
    readTimeMin,
    paragraphCount: paragraphs.length,
  };
}

/**
 * Serverless Universal Feed Loader:
 * Operates 100% client-side via Capacitor / native fetching or user-configured stateless relay / mirror URL.
 */
export async function fetchFeedUniversal(feed: {
  id: string;
  title: string;
  url: string;
  defaultTags?: string[];
}): Promise<{ feedTitle: string; items: FeedItem[] }> {
  const { text, finalUrl } = await fetchRawUrlText(feed.url, { feedId: feed.id });
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
 * Serverless Universal Article Reader Extractor:
 * Operates 100% client-side using on-device HTML/JSON-LD extraction and privacy-hardened fetching.
 */
export async function extractArticleUniversal(
  articleUrl: string
): Promise<ExtractedArticleResult> {
  const { text, finalUrl } = await fetchRawUrlText(articleUrl);
  return extractReadableArticleFromHtml(text, finalUrl);
}
