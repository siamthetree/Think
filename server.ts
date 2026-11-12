import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsPromises from 'fs/promises';
import dns from 'node:dns/promises';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { GoogleGenAI, Type } from '@google/genai';
import { XMLParser } from 'fast-xml-parser';
import {
  buildRssDiscoveryCandidates,
  extractReadableArticleFromHtml,
  isBoilerplateOrJsWarning,
  parseFeedDate,
  UNDATED_FALLBACK_EPOCH,
} from './src/utils/feedParser';
import {
  isPrivateOrReservedIp,
  checkSafeExternalUrl,
} from './src/utils/urlSecurity';

export interface FeedItem {
  id: string;
  feedId: string;
  feedTitle: string;
  feedUrl: string;
  title: string;
  link: string;
  pubDate: string;
  timestamp: number;
  author?: string;
  summary: string;
  contentHtml?: string;
  contentClean?: string;
  imageUrl?: string;
  tags: string[];
  isRead: boolean;
  isBookmarked: boolean;
  isOfflineCached: boolean;
  cachedAt?: number;
  readTimeMin: number;
}

function escapeHtmlServer(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function calculateReadTime(text: string): number {
  if (!text) return 1;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.ceil(words / 220);
  return Math.max(1, minutes);
}

function stripHtml(html: string): string {
  if (!html) return '';
  const capped = html.length > 150000 ? html.slice(0, 150000) : html;
  return capped
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCdata(text: string): string {
  if (!text) return '';
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
}

function resolveUrl(relativeOrAbsolute: string, baseUrl?: string): string {
  if (!relativeOrAbsolute) return '';
  let trimmed = relativeOrAbsolute
    .trim()
    .replace(/&amp;/g, '&');

  if (trimmed.includes('apiclick.aspx') || trimmed.includes('url=http')) {
    try {
      const parsedWrapper = new URL(trimmed, baseUrl || 'https://example.com');
      const unwrapped = parsedWrapper.searchParams.get('url');
      if (unwrapped && /^https?:\/\//i.test(unwrapped)) {
        trimmed = unwrapped;
      }
    } catch {}
  }

  if (trimmed.startsWith('//')) {
    return 'https:' + trimmed;
  }
  if (trimmed.includes('/_next/image?url=')) {
    try {
      const urlParam = new URL(trimmed, baseUrl || 'https://example.com').searchParams.get('url');
      if (urlParam) trimmed = urlParam;
    } catch {}
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

function extractHeroImage(rawItem: any, contentHtml: string, baseUrl?: string): string | undefined {
  const isValidImage = (url: string) => {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (
      lower.includes('feedburner') ||
      lower.includes('tracking') ||
      lower.includes('badge') ||
      lower.includes('logo') ||
      lower.includes('icon') ||
      lower.includes('avatar') ||
      lower.includes('placeholder') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.svg') ||
      lower.includes('1x1') ||
      lower.startsWith('data:')
    ) {
      return false;
    }
    return true;
  };

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
    if (rawItem.enclosure) {
      const enc = rawItem.enclosure;
      const url = enc['@_url'];
      if (url && isValidImage(url)) {
        return resolveUrl(url, baseUrl);
      }
    }
  }

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
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(cleanCdata(titleMatch[1])) : 'Untitled Article';

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

    const dateMatch = block.match(
      /<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i
    );
    const rawDate = dateMatch ? cleanCdata(dateMatch[1]) : undefined;
    const { timestamp, pubDate } = parseFeedDate(rawDate, items.length);

    const authorMatch = block.match(/<(?:author|dc:creator)[^>]*>([\s\S]*?)<\/(?:author|dc:creator)>/i);
    const author = authorMatch ? stripHtml(cleanCdata(authorMatch[1])) : undefined;

    const contentEncodedMatch = block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);

    const contentHtml = cleanCdata(contentEncodedMatch?.[1] || contentMatch?.[1] || descMatch?.[1] || '');
    const cleanBody = stripHtml(contentHtml);
    const summary = cleanBody.slice(0, 240);

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

function parseXmlFeed(
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
      let title = raw.title;
      if (typeof title === 'object') {
        title = title['#text'] || '';
      }
      title = stripHtml(cleanCdata(String(title || 'Untitled Article')));

      let link = raw.link;
      if (Array.isArray(link)) {
        const alt = link.find((l: any) => l['@_rel'] === 'alternate') || link[0];
        link = alt?.['@_href'] || alt || '';
      } else if (typeof link === 'object') {
        link = link['@_href'] || link['#text'] || '';
      }
      link = resolveUrl(String(link || '').trim(), feedInfo.url);

      const rawDate = raw.pubDate || raw['dc:date'] || raw.published || raw.updated;
      const { timestamp, pubDate } = parseFeedDate(rawDate, items.length);

      let author: string | undefined;
      if (raw.author) {
        author = typeof raw.author === 'object' ? raw.author.name || raw.author['#text'] : String(raw.author);
      } else if (raw['dc:creator']) {
        author = typeof raw['dc:creator'] === 'object' ? raw['dc:creator']['#text'] : String(raw['dc:creator']);
      }

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
      const imageUrl = extractHeroImage(raw, contentHtml, feedInfo.url);

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

function parseHtmlPortalToFeed(
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

    if (baseHostname && !parsedUrl.hostname.includes(baseHostname)) {
      continue;
    }

    const pathname = parsedUrl.pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);

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

    const lastSegment = segments[segments.length - 1] || '';
    const hyphenCount = (lastSegment.match(/-/g) || []).length;
    const looksLikeArticle =
      /\d/.test(lastSegment) || hyphenCount >= 2 || segments.length >= 3;
    if (!looksLikeArticle) continue;

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

    title = title.replace(/\s+/g, ' ').trim();
    const wordCount = title.split(/\s+/).length;
    if (!title || title.length < 22 || title.length > 240 || wordCount < 4) continue;
    if (title.includes('@') || /^(read more|view more|click here|subscribe|follow us)/i.test(title)) {
      continue;
    }

    if (seenUrls.has(fullUrl) || seenTitles.has(title.toLowerCase())) continue;
    seenUrls.add(fullUrl);
    seenTitles.add(title.toLowerCase());

    const matchIndex = match.index ?? 0;
    const matchEnd = matchIndex + match[0].length;
    const beforeWindow = htmlString.slice(Math.max(0, matchIndex - 500), matchIndex);
    const afterWindow = htmlString
      .slice(matchEnd, matchEnd + 900)
      .split(/<\/article>|<article\b|<h[1-4]\b/i)[0] || '';

    const imageUrl =
      extractHeroImage({}, innerHtml, feedInfo.url) ||
      extractHeroImage({}, beforeWindow.split(/<article\b|<li\b/i).pop() || '', feedInfo.url);

    const pMatch =
      innerHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ||
      afterWindow.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ||
      afterWindow.match(/<(?:div|span)[^>]+class=["'][^"']*(?:summary|excerpt|intro|lead|desc|sub-title|sort-dec)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span)>/i);
    const pText = pMatch ? stripHtml(pMatch[1]).replace(/\s+/g, ' ').trim() : '';
    const summary =
      pText && pText !== title && pText.length > 20
        ? pText.slice(0, 260)
        : '';

    // Portal anchor items have no explicit date in anchor markup; use deterministic past epoch so undated items do not masquerade as breaking news
    const timestamp = UNDATED_FALLBACK_EPOCH - items.length * 60 * 1000;
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '64kb' }));

const ALLOWED_ORIGINS = new Set<string>([
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://ais-pre-qetfpxcsmchifsxdsds37n-79584864695.asia-southeast1.run.app',
  'https://ais-dev-qetfpxcsmchifsxdsds37n-79584864695.asia-southeast1.run.app',
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : []),
]);

// Explicit origin allowlist CORS (no wildcard '*')
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Chinta-Client');
  }
  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      res.sendStatus(403);
      return;
    }
    res.sendStatus(204);
    return;
  }
  next();
});

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(options: { windowMs: number; maxRequests: number }) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = getClientIp(req);
    const cutoff = now - options.windowMs;
    const recent = (hits.get(ip) || []).filter((t) => t > cutoff);
    if (recent.length >= options.maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please wait before making additional requests.',
      });
      return;
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 2000) {
      for (const [key, times] of hits.entries()) {
        if (times.every((t) => t <= cutoff)) hits.delete(key);
      }
    }
    next();
  };
}

function requireApiAccess(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.API_AUTH_TOKEN?.trim();
  if (configuredToken) {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (bearer !== configuredToken) {
      res.status(401).json({ success: false, error: 'Unauthorized API request' });
      return;
    }
  }
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ success: false, error: 'Origin not permitted' });
    return;
  }
  next();
}

const rssRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 150 });
const extractRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });
const summarizeRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 15 });
const publishBlogRateLimiter = createRateLimiter({ windowMs: 10 * 60_000, maxRequests: 6 });

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB hard cap

async function assertSafeUrlAndResolve(rawUrl: string): Promise<URL> {
  const validation = checkSafeExternalUrl(rawUrl);
  if (!validation.ok || !validation.url) {
    throw new Error(validation.reason || 'Disallowed target URL');
  }
  const parsed = validation.url;
  let records: Array<{ address: string; family: number }> = [];
  try {
    records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve hostname: ${parsed.hostname}`);
  }
  if (!records || records.length === 0) {
    throw new Error(`No DNS records found for hostname: ${parsed.hostname}`);
  }
  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error(`Blocked private or reserved IP address for ${parsed.hostname}`);
    }
  }
  return parsed;
}

async function readResponseTextWithCap(
  res: globalThis.Response,
  maxBytes = MAX_RESPONSE_BYTES
): Promise<string> {
  const contentLength = Number(res.headers.get('content-length') || '0');
  if (contentLength > maxBytes) {
    throw new Error(`Response Content-Length (${contentLength} bytes) exceeds 2 MB limit`);
  }
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('Response body exceeds 2 MB limit');
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error('Response stream exceeded 2 MB limit');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Curated Bangladeshi & International newspaper portals and Travel Community Blogs
const CURATED_FEEDS = [
  {
    id: 'travel_blogs_bd',
    title: 'Bangladeshi Travel Groups & Dispatches',
    url: '/api/blogs',
    siteUrl: 'https://chinta.app/travel',
    description: 'Community blogs, trail guides, and expedition stories written by Bangladeshi travelers & groups.',
    category: 'Travel & Expeditions',
    defaultTags: ['tag_travel', 'tag_bd'],
  },
  {
    id: 'daily_star',
    title: 'The Daily Star',
    url: 'https://www.thedailystar.net/rss.xml',
    siteUrl: 'https://www.thedailystar.net',
    description: 'Leading English-language daily newspaper in Bangladesh.',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_world'],
  },
  {
    id: 'prothom_alo_en',
    title: 'Prothom Alo (English)',
    url: 'https://en.prothomalo.com/feed',
    siteUrl: 'https://en.prothomalo.com',
    description: 'National news, politics, economy, and views from Prothom Alo English.',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_investigative'],
  },
  {
    id: 'prothom_alo_bn',
    title: 'প্রথম আলো (Prothom Alo Bangla)',
    url: 'https://www.prothomalo.com/feed',
    siteUrl: 'https://www.prothomalo.com',
    description: 'বাংলাদেশের শীর্ষস্থানীয় বাংলা দৈনিক পত্রিকা।',
    category: 'Bangladesh (বাংলা)',
    defaultTags: ['tag_bd'],
  },
  {
    id: 'bdnews24',
    title: 'bdnews24.com',
    url: 'https://bdnews24.com',
    siteUrl: 'https://bdnews24.com',
    description: 'Bangladesh’s first bilingual online newspaper (Direct Portal Reader).',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_breaking'],
  },
  {
    id: 'fe_bd',
    title: 'The Financial Express (BD)',
    url: 'https://thefinancialexpress.com.bd',
    siteUrl: 'https://thefinancialexpress.com.bd',
    description: 'Financial, economic, trade, and market news from Dhaka (Direct Portal Reader).',
    category: 'Bangladesh Finance',
    defaultTags: ['tag_bd', 'tag_markets'],
  },
  {
    id: 'tbs_news',
    title: 'The Business Standard (TBS)',
    url: 'https://www.tbsnews.net',
    siteUrl: 'https://www.tbsnews.net',
    description: 'Business, economy, policy, and analysis from Bangladesh.',
    category: 'Bangladesh Finance',
    defaultTags: ['tag_bd', 'tag_markets'],
  },
  {
    id: 'dhaka_tribune',
    title: 'Dhaka Tribune',
    url: 'https://www.dhakatribune.com',
    siteUrl: 'https://www.dhakatribune.com',
    description: 'National and international coverage from Dhaka.',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_world'],
  },
  {
    id: 'unb_news',
    title: 'United News of Bangladesh (UNB)',
    url: 'https://unb.com.bd',
    siteUrl: 'https://unb.com.bd',
    description: 'Premier independent national news agency of Bangladesh.',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_breaking'],
  },
  {
    id: 'bbc_world',
    title: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    siteUrl: 'https://bbc.com/news',
    description: 'International news, analysis and features from the BBC.',
    category: 'World',
    defaultTags: ['tag_world', 'tag_breaking'],
  },
  {
    id: 'guardian_world',
    title: 'The Guardian',
    url: 'https://www.theguardian.com/world/rss',
    siteUrl: 'https://theguardian.com',
    description: 'Independent international journalism and long-form analysis.',
    category: 'World',
    defaultTags: ['tag_world', 'tag_opinion'],
  },
];

// Fetch with SSRF IP verification on every hop, 2 MB response size cap, and legitimate User-Agents (no Googlebot spoofing)
async function fetchWithUserAgent(
  targetUrl: string,
  timeoutMs = 8500
): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const userAgents = [
    'ChintaReader/2.0 (+https://chinta.app)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ];

  let lastError: Error | null = null;
  for (const ua of userAgents) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentUrl = targetUrl;
      let redirectCount = 0;

      while (redirectCount <= 5) {
        const safeParsed = await assertSafeUrlAndResolve(currentUrl);
        const res = await fetch(safeParsed.href, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': ua,
            Accept:
              'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
          },
        });

        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) {
            throw new Error(`Redirect (${res.status}) missing Location header`);
          }
          currentUrl = new URL(location, safeParsed.href).href;
          redirectCount += 1;
          continue;
        }

        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          const text = await readResponseTextWithCap(res, MAX_RESPONSE_BYTES);
          return { text, contentType, finalUrl: safeParsed.href };
        }

        lastError = new Error(`HTTP error ${res.status}: ${res.statusText}`);
        if (res.status === 404 || res.status === 410 || res.status === 400) {
          clearTimeout(timer);
          throw lastError;
        }
        break;
      }
    } catch (err: any) {
      lastError = err;
      if (
        /Blocked|Disallowed|Private|exceeded 2 MB|HTTP error 404|HTTP error 410/i.test(
          err?.message || ''
        )
      ) {
        clearTimeout(timer);
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Failed to fetch ${targetUrl}`);
}

function isXmlFeedContent(text: string): boolean {
  const sample = text.slice(0, 1500);
  return sample.includes('<rss') || sample.includes('<feed') || sample.includes('<rdf:RDF');
}

/**
 * Resolves any URL — whether an XML RSS feed, a newspaper homepage with a hidden RSS link,
 * OR a Bangladeshi news portal that has NO RSS feed at all (via direct HTML scraping or domain index).
 */
async function loadPortalOrRssFeed(
  rawUrl: string,
  feedInfo: { id: string; title: string; defaultTags: string[] }
): Promise<{
  feedTitle: string;
  items: any[];
  resolvedUrl: string;
  sourceMode: 'rss' | 'direct_html' | 'domain_index';
}> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  await assertSafeUrlAndResolve(url);

  let fetchedHtml = '';
  let fetchedUrl = url;
  const htmlDiscoveredCandidates: string[] = [];

  // Step 1: Try fetching the given URL directly
  try {
    const { text, contentType, finalUrl } = await fetchWithUserAgent(url, 6000);
    fetchedUrl = finalUrl;

    if (isXmlFeedContent(text)) {
      const parsed = parseXmlFeed(text, { ...feedInfo, url: fetchedUrl });
      if (parsed.items.length > 0) {
        return { ...parsed, resolvedUrl: fetchedUrl, sourceMode: 'rss' };
      }
    }

    // If HTML, inspect <link> and <a> tags for RSS/Atom feeds and save HTML for direct fallback
    if (contentType.includes('html') || text.includes('<html') || text.includes('<!DOCTYPE')) {
      fetchedHtml = text;
      const $ = cheerio.load(text);

      $('link[type*="rss"], link[type*="atom"], link[type*="xml"], link[rel="alternate"]').each(
        (_, el) => {
          const href = $(el).attr('href');
          const type = ($(el).attr('type') || '').toLowerCase();
          if (
            href &&
            (type.includes('rss') ||
              type.includes('atom') ||
              type.includes('xml') ||
              /(rss|feed|atom|\.xml)/i.test(href))
          ) {
            try {
              const resolved = new URL(href, fetchedUrl).href;
              if (!htmlDiscoveredCandidates.includes(resolved) && htmlDiscoveredCandidates.length < 4) {
                htmlDiscoveredCandidates.push(resolved);
              }
            } catch {}
          }
        }
      );

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (/(\/rss\b|\/feed\b|\.rss\b|rss\.xml|feed\.xml|atom\.xml|index\.xml|\?feed=rss)/i.test(href)) {
          try {
            const resolved = new URL(href, fetchedUrl).href;
            if (!htmlDiscoveredCandidates.includes(resolved) && htmlDiscoveredCandidates.length < 4) {
              htmlDiscoveredCandidates.push(resolved);
            }
          } catch {}
        }
      });

      for (const candidate of htmlDiscoveredCandidates) {
        try {
          const { text: feedText } = await fetchWithUserAgent(candidate, 3000);
          if (isXmlFeedContent(feedText)) {
            const parsed = parseXmlFeed(feedText, { ...feedInfo, url: candidate });
            if (parsed.items.length > 0) {
              return { ...parsed, resolvedUrl: candidate, sourceMode: 'rss' };
            }
          }
        } catch {}
      }
    }
  } catch {
    // Will continue to candidate paths and domain fallback
  }

  // Step 2: Search for an RSS feed link first (from <link>/<a> tags in HTML + common RSS path combinations)
  // BEFORE falling back to website HTML scraping!
  const allRssCandidates = buildRssDiscoveryCandidates(url, fetchedHtml).filter(
    (c) => !htmlDiscoveredCandidates.includes(c) && c !== url && c !== fetchedUrl
  );

  const candidateList = allRssCandidates.slice(0, 8);
  const batchSize = 4;
  for (let i = 0; i < candidateList.length; i += batchSize) {
    const batch = candidateList.slice(i, i + batchSize);
    const found = await Promise.all(
      batch.map(async (candidate) => {
        try {
          const { text } = await fetchWithUserAgent(candidate, 3000);
          if (isXmlFeedContent(text)) {
            const parsed = parseXmlFeed(text, { ...feedInfo, url: candidate });
            if (parsed.items.length > 0) {
              return { ...parsed, resolvedUrl: candidate, sourceMode: 'rss' as const };
            }
          }
        } catch {}
        return null;
      })
    );
    const match = found.find(Boolean);
    if (match) {
      return match;
    }
  }

  // Step 3: If no RSS link is available, keep the website link and parse articles directly from the website HTML!
  if (fetchedHtml) {
    const htmlParsedFallback = parseHtmlPortalToFeed(fetchedHtml, {
      ...feedInfo,
      url: fetchedUrl,
    });
    if (htmlParsedFallback.items.length > 0) {
      return {
        ...htmlParsedFallback,
        resolvedUrl: url,
        sourceMode: 'direct_html',
      };
    }
  }

  // Step 4: Fallback for Cloudflare-protected websites (uses Bing News RSS with unwrapped direct links first, then Google News RSS)
  let parsedTarget: URL | null = null;
  try {
    parsedTarget = new URL(url);
  } catch {}

  if (parsedTarget) {
    const hostname = parsedTarget.hostname.replace(/^www\./, '');
    const isBanglaDomain = /jugantor|kalerkantho|samakal|ittefaq|banglatribune|manabzamin|bonikbarta|somoynews|jamuna|deshrupantor/i.test(
      hostname
    );
    const indexQueryUrls = [
      `https://www.bing.com/news/search?q=${encodeURIComponent(`site:${hostname}`)}&format=rss`,
      isBanglaDomain
        ? `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${hostname}`)}&hl=bn&gl=BD&ceid=BD:bn`
        : `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${hostname}`)}&hl=en-BD&gl=BD&ceid=BD:en`,
    ];

    for (const queryUrl of indexQueryUrls) {
      try {
        const { text } = await fetchWithUserAgent(queryUrl, 6000);
        if (isXmlFeedContent(text)) {
          const parsed = parseXmlFeed(text, {
            ...feedInfo,
            title: feedInfo.title !== 'Newspaper Feed' ? feedInfo.title : hostname,
            url,
          });
          const cleanFeedTitle =
            feedInfo.title && feedInfo.title !== 'Newspaper Feed' && feedInfo.title !== 'RSS Feed'
              ? feedInfo.title
              : hostname;
          const cleanedItems = parsed.items.map((item) => {
            const cleanTitle = item.title.replace(/\s+-\s+[^-]+$/, '').trim() || item.title;
            const rawSum = (item.summary || '').replace(/\s+-\s+[^-]+$/, '').trim();
            const hasDistinctSummary =
              rawSum.length > 35 &&
              rawSum.toLowerCase() !== cleanTitle.toLowerCase() &&
              !cleanTitle.toLowerCase().includes(rawSum.toLowerCase().slice(0, 30));
            return {
              ...item,
              feedTitle: cleanFeedTitle,
              title: cleanTitle,
              link: resolveUrl(item.link, url),
              summary: hasDistinctSummary ? rawSum : '',
              contentHtml: hasDistinctSummary ? `<p>${rawSum}</p>` : '',
              contentClean: '', // Trigger full extraction when opened
            };
          });

          if (cleanedItems.length > 0) {
            return {
              feedTitle: cleanFeedTitle,
              items: cleanedItems,
              resolvedUrl: url,
              sourceMode: 'domain_index',
            };
          }
        }
      } catch {}
    }
  }

  throw new Error(`Could not load articles from "${rawUrl}". Please check the URL and try again.`);
}

// 1. Fetch and parse RSS or Direct HTML Portal
app.get('/api/rss', requireApiAccess, rssRateLimiter, async (req: Request, res: Response) => {
  const feedUrl = String(req.query.url || '').trim();
  const feedId = String(req.query.feedId || req.query.id || `feed_${Date.now()}`).slice(0, 120);
  const feedTitle = String(req.query.title || 'Newspaper Feed').slice(0, 180);
  const defaultTags = req.query.tags
    ? String(req.query.tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

  if (!feedUrl || feedUrl.length > 2048) {
    return res.status(400).json({ error: 'Missing or invalid url query parameter' });
  }

  // Handle Community Travel Blogs Feed directly from database
  if (feedUrl === '/api/blogs' || feedUrl.endsWith('/api/blogs') || feedId === 'travel_blogs_bd') {
    try {
      const blogs = await readBlogsFromDisk();
      const items = blogs.map((b) => {
        const safeGroup = escapeHtmlServer(b.groupName || 'Travel Group');
        const safeAuthor = escapeHtmlServer(b.author || 'Traveler');
        const safeLocation = b.location ? escapeHtmlServer(b.location) : '';
        const safeContact = b.groupContact ? escapeHtmlServer(b.groupContact) : '';
        const safeParagraphs = String(b.content || '')
          .split(/\n\n+/)
          .map((p: string) => `<p>${escapeHtmlServer(p.trim())}</p>`)
          .join('\n');
        const parsedDate = parseFeedDate(b.publishedAt);
        const timestamp = parsedDate.hasValidDate ? parsedDate.timestamp : b.timestamp;

        return {
          id: b.id,
          feedId: 'travel_blogs_bd',
          feedTitle: b.groupName ? `${b.groupName} (${b.author})` : `Traveler: ${b.author}`,
          feedUrl: '/api/blogs',
          title: b.title,
          link: `/blog/${b.id}`,
          pubDate: b.publishedAt,
          timestamp,
          author: `${b.author} · ${b.groupName || 'Bangladeshi Travel Group'}`,
          summary: b.summary || String(b.content || '').slice(0, 180) + '...',
          contentHtml: `
          <div class="travel-group-badge mb-4 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-200">
            <p class="text-xs uppercase font-bold tracking-wider text-emerald-400 mb-1">Bangladeshi Travel Group Dispatch</p>
            <p class="text-sm font-semibold text-stone-100">${safeGroup} · Writer: ${safeAuthor}</p>
            ${safeLocation ? `<p class="text-xs text-stone-300 mt-1">📍 Destination: ${safeLocation}</p>` : ''}
            ${safeContact ? `<p class="text-xs text-emerald-300 mt-1.5 font-sans">Connect with Group: <span class="underline">${safeContact}</span></p>` : ''}
          </div>
          ${safeParagraphs}
        `,
          contentClean: b.content,
          imageUrl: b.coverImage,
          tags: ['tag_travel', 'tag_bd'],
          isRead: false,
          isBookmarked: false,
          isOfflineCached: true,
          readTimeMin: b.readTimeMin || calculateReadTime(b.content),
        };
      });

      return res.json({
        success: true,
        feedTitle: 'Bangladeshi Travel Groups & Dispatches',
        items,
        resolvedUrl: '/api/blogs',
        sourceMode: 'travel_community_database',
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  try {
    await assertSafeUrlAndResolve(
      /^https?:\/\//i.test(feedUrl) ? feedUrl : `https://${feedUrl}`
    );
  } catch (ssrfErr: any) {
    return res.status(400).json({
      success: false,
      error: ssrfErr.message || 'Unsafe or disallowed URL',
    });
  }

  try {
    const result = await loadPortalOrRssFeed(feedUrl, {
      id: feedId,
      title: feedTitle,
      defaultTags,
    });

    res.json({
      success: true,
      feedTitle: result.feedTitle,
      items: result.items,
      resolvedUrl: result.resolvedUrl,
      resolvedFeedUrl: result.resolvedUrl,
      sourceMode: result.sourceMode,
    });
  } catch (err: any) {
    console.error(`Error loading source ${feedUrl}:`, err.message);
    res.status(500).json({
      success: false,
      error: `Failed to load source: ${err.message}`,
    });
  }
});

// In-memory extraction cache to provide instant reader rendering
const EXTRACTED_ARTICLE_CACHE = new Map<string, any>();

// 2. Direct URL Reader & Clean Distraction-Free Article Extractor
app.get('/api/extract', requireApiAccess, extractRateLimiter, async (req: Request, res: Response) => {
  let articleUrl = resolveUrl(String(req.query.url || '').trim());
  if (!articleUrl || articleUrl.length > 2048) {
    return res.status(400).json({ error: 'Missing or invalid url query parameter' });
  }
  if (!/^https?:\/\//i.test(articleUrl.trim())) {
    articleUrl = 'https://' + articleUrl.trim();
  }

  try {
    await assertSafeUrlAndResolve(articleUrl);
  } catch (ssrfErr: any) {
    return res.status(400).json({
      success: false,
      error: ssrfErr.message || 'Unsafe or disallowed URL',
    });
  }

  // Check cache first for instant retrieval
  if (EXTRACTED_ARTICLE_CACHE.has(articleUrl)) {
    return res.json(EXTRACTED_ARTICLE_CACHE.get(articleUrl));
  }

  try {
    const { text: html, finalUrl } = await fetchWithUserAgent(articleUrl, 6500);
    const fallbackExtracted = extractReadableArticleFromHtml(html, finalUrl);
    const $ = cheerio.load(html);

    // 1. Extract structured JSON-LD metadata & articleBody BEFORE removing <script> tags
    let jsonLdBody = '';
    let jsonLdHeadline = '';
    let jsonLdAuthor = '';
    let jsonLdImage = '';
    let jsonLdDate = '';

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const rawJson = $(el).html();
        if (!rawJson) return;
        const parsed = JSON.parse(rawJson);
        const nodes = Array.isArray(parsed)
          ? parsed
          : parsed['@graph'] && Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];

        for (const node of nodes) {
          if (!node || typeof node !== 'object') continue;
          if (typeof node.articleBody === 'string' && node.articleBody.length > jsonLdBody.length) {
            jsonLdBody = node.articleBody;
          }
          if (typeof node.headline === 'string' && !jsonLdHeadline) {
            jsonLdHeadline = node.headline;
          }
          if (node.datePublished && !jsonLdDate) {
            jsonLdDate = String(node.datePublished);
          }
          if (node.author && !jsonLdAuthor) {
            const a = Array.isArray(node.author) ? node.author[0] : node.author;
            if (typeof a === 'string') jsonLdAuthor = a;
            else if (a?.name) jsonLdAuthor = a.name;
          }
          if (node.image && !jsonLdImage) {
            const img = Array.isArray(node.image) ? node.image[0] : node.image;
            if (typeof img === 'string') jsonLdImage = img;
            else if (img?.url) jsonLdImage = img.url;
          }
        }
      } catch {}
    });

    // Site Name
    const siteName =
      $('meta[property="og:site_name"]').attr('content') ||
      new URL(finalUrl).hostname.replace(/^www\./, '');

    // Title
    const rawTitle =
      jsonLdHeadline ||
      fallbackExtracted.title ||
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      'Article';
    const title = isBoilerplateOrJsWarning(rawTitle) ? 'Article' : rawTitle;

    // Author
    const author =
      jsonLdAuthor ||
      fallbackExtracted.author ||
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('[rel="author"]').first().text().trim() ||
      $('.byline, .author, .contributor-name, [class*="byline"], [class*="author-name"]')
        .first()
        .text()
        .trim();

    // Published Date
    const pubDate =
      jsonLdDate ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('time[datetime]').first().attr('datetime') ||
      new Date().toISOString();

    // Lead / Hero Image
    const rawLeadImage =
      jsonLdImage ||
      fallbackExtracted.leadImage ||
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content');
    const leadImage = rawLeadImage ? resolveUrl(rawLeadImage, finalUrl) : undefined;

    // Description / Summary
    const metaDescription =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    // Remove noise, scripts, noscript warnings, ads, sidebars, related links, popups, and clutter
    $(
      'script, style, noscript, iframe, svg, nav, footer, header, aside, form, button, ' +
      '[class*="noscript"], [class*="no-js"], [id*="noscript"], ' +
      '.advertisement, .ads, .ad-slot, .ad-container, [id*="google_ads"], [class*="google-ads"], ' +
      '.cookie-banner, .subscribe-banner, .subscription-wall, .paywall, .social-share, .share-buttons, ' +
      '.newsletter-signup, .related-news, .most-viewed, .trending-news, .read-more, .comments, ' +
      '.print-only, .embedded-widget, .outbrain, .taboola, [class*="sponsored"], [id*="sponsored"]'
    ).remove();

    const articleSelectors =
      'article, [itemprop="articleBody"], .story-element, .story-content, .article-body, .story-body, ' +
      '.entry-content, .post-content, .node-content, .details-content, .news-details, .content-details, ' +
      '.main-content, main, [role="main"]';
    let $article: cheerio.Cheerio<Element> = $('body').first();
    let bestScore = 0;
    $(articleSelectors).each((_, candidate) => {
      if (candidate.type !== 'tag') return;
      const $candidate = $(candidate);
      const paragraphText = $candidate
        .find('p, h2, h3, blockquote')
        .map((__, element) => $(element).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter((text) => text.length >= 20 && !isBoilerplateOrJsWarning(text));
      const textLength = paragraphText.reduce((total, text) => total + text.length, 0);
      const score = textLength + paragraphText.length * 120;
      if (score > bestScore) {
        bestScore = score;
        $article = $candidate;
      }
    });

    let contentBlocks: {
      type: 'p' | 'h2' | 'h3' | 'blockquote' | 'img';
      text?: string;
      src?: string;
      caption?: string;
    }[] = [];
    const seenParagraphs = new Set<string>();

    $article.find('p, h2, h3, blockquote, figure').each((_, el) => {
      const tagName = el.tagName.toLowerCase();

      if (tagName === 'figure') {
        const img = $(el).find('img').first();
        const rawSrc =
          img.attr('src') ||
          img.attr('data-src') ||
          img.attr('data-original') ||
          img.attr('data-lazy-src') ||
          img.attr('srcset')?.split(/\s+/)[0];
        const caption = $(el).find('figcaption').text().trim();
        if (
          rawSrc &&
          !rawSrc.endsWith('.gif') &&
          !rawSrc.includes('tracker') &&
          !rawSrc.includes('badge') &&
          !rawSrc.includes('avatar') &&
          !rawSrc.includes('icon')
        ) {
          const resolvedSrc = resolveUrl(rawSrc, finalUrl);
          if (resolvedSrc !== leadImage) {
            contentBlocks.push({ type: 'img', src: resolvedSrc, caption: caption || undefined });
          }
        }
        return;
      }

      const text = stripHtml($(el).text());
      if (!text || (text.length < 20 && tagName === 'p')) return;
      if (isBoilerplateOrJsWarning(text) || /^editor'?s?\s+pick$/i.test(text)) return;

      if (seenParagraphs.has(text)) return;
      seenParagraphs.add(text);

      if (tagName === 'h2' || tagName === 'h3') {
        contentBlocks.push({ type: tagName, text });
      } else if (tagName === 'blockquote') {
        contentBlocks.push({ type: 'blockquote', text });
      } else {
        contentBlocks.push({ type: 'p', text });
      }
    });

    // Compare with fallbackExtracted (which extracts Quintype story-elements, Next.js __NEXT_DATA__, JSON-LD @graph, and <br><br> divs)
    const cheerioTextLen = contentBlocks.map((b) => b.text || '').join(' ').length;
    const fallbackTextLen = fallbackExtracted.blocks.map((b) => b.text || '').join(' ').length;
    if (
      fallbackExtracted.blocks.length > 0 &&
      (contentBlocks.filter((b) => b.type === 'p').length < 3 || fallbackTextLen > cheerioTextLen * 1.25)
    ) {
      contentBlocks = fallbackExtracted.blocks;
    }

    // Ensure at least metaDescription if page had minimal text (and it's not a JS warning)
    if (
      contentBlocks.length === 0 &&
      metaDescription &&
      !isBoilerplateOrJsWarning(metaDescription) &&
      !metaDescription.includes('aggregated from sources all over the world by Google News')
    ) {
      contentBlocks.push({ type: 'p', text: stripHtml(metaDescription) });
    }

    const fullText = contentBlocks
      .map((b) => b.text || '')
      .filter(Boolean)
      .join(' ');
    const readTimeMin = calculateReadTime(fullText || metaDescription);
    const isSuccess = contentBlocks.length > 0 && fullText.length >= 50;

    const responsePayload = {
      success: isSuccess,
      title: stripHtml(title),
      siteName: stripHtml(siteName),
      author: author ? stripHtml(author) : undefined,
      pubDate,
      leadImage,
      summary: stripHtml(metaDescription || fullText).slice(0, 240),
      readTimeMin,
      blocks: contentBlocks,
      url: finalUrl,
    };

    if (isSuccess) {
      EXTRACTED_ARTICLE_CACHE.set(articleUrl, responsePayload);
      if (finalUrl !== articleUrl) {
        EXTRACTED_ARTICLE_CACHE.set(finalUrl, responsePayload);
      }
    }

    res.json(responsePayload);
  } catch (err: any) {
    res.json({
      success: false,
      error: `Article extraction unavailable: ${err.message}`,
    });
  }
});

// 3. AI Newspaper Article Summarizer (Powered by Gemini 3.8 Flash with Fallback)
app.post('/api/summarize', requireApiAccess, summarizeRateLimiter, async (req: Request, res: Response) => {
  try {
    const { title, text, language } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length < 50) {
      res.status(400).json({ success: false, error: 'Article text too short to summarize' });
      return;
    }
    if (text.length > 50000) {
      res.status(413).json({ success: false, error: 'Article text exceeds maximum allowed length' });
      return;
    }

    const cleanBody = stripHtml(text).slice(0, 15000);
    const articleTitle = stripHtml(String(title || 'Newspaper Article')).slice(0, 300);

    // Check if GEMINI_API_KEY is available
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const prompt = `You are a world-class senior news editor and analyst.
Read this newspaper article carefully and produce a high-precision, executive editorial summary.

Headline: ${articleTitle}

Article Text:
${cleanBody}

Provide your response in JSON format with:
- "executiveSummary": A concise, authoritative 2-3 sentence overview capturing the core news development, significance, and primary parties involved.
- "keyTakeaways": An array of 3 to 5 concise bullet points highlighting crucial facts, numbers, dates, policy impacts, or statements.
- "context": A 1-sentence note on why this news matters to readers or its broader national/international impact.
Keep language professional, objective, and neutral (in ${String(language || 'the original article language').slice(0, 40)}).`;

        const summarySchema = {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            keyTakeaways: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            context: { type: Type.STRING },
          },
          required: ['executiveSummary', 'keyTakeaways', 'context'],
        };

        let response;
        try {
          response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: summarySchema,
            },
          });
        } catch (primaryErr: any) {
          // If gemini-3.8-flash is unavailable on a specific key/region, try gemini-flash-latest before extractive fallback
          response = await ai.models.generateContent({
            model: 'gemini-flash-latest',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: summarySchema,
            },
          });
        }

        const jsonText = response.text || '{}';
        const parsed = JSON.parse(jsonText);
        res.json({
          success: true,
          provider: 'gemini',
          executiveSummary: parsed.executiveSummary || '',
          keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
          context: parsed.context || '',
        });
        return;
      } catch (geminiErr: any) {
        console.warn('Gemini summarize call failed, using extractive editor fallback:', geminiErr.message);
      }
    }

    // High-precision extractive summarizer fallback (works offline or without API key)
    const sentences = cleanBody
      .replace(/([.?!])\s*(?=[A-Z0-9\u0980-\u09FF])/g, '$1|')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 35 && s.length < 240);

    const executive = sentences.slice(0, 2).join(' ');
    const takeaways = sentences.slice(2, 6);

    res.json({
      success: true,
      provider: 'extractive-editorial',
      executiveSummary: executive || cleanBody.slice(0, 260),
      keyTakeaways: takeaways.length > 0 ? takeaways : [cleanBody.slice(0, 180)],
      context: `Reported by news desk with ${calculateReadTime(cleanBody)} min detailed coverage.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Travel Blogs Database (Persistent Storage in data/blogs.json with Mutex & Atomic Writes) ---
const BLOGS_FILE_PATH = path.resolve(__dirname, 'data', 'blogs.json');
let blogsMutexChain: Promise<void> = Promise.resolve();

function withBlogsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = blogsMutexChain.then(fn, fn);
  blogsMutexChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function readBlogsFromDisk(): Promise<any[]> {
  try {
    if (fs.existsSync(BLOGS_FILE_PATH)) {
      const content = await fsPromises.readFile(BLOGS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err: any) {
    console.error('Failed to read blogs.json database:', err.message);
  }
  return [];
}

async function writeBlogsToDiskAtomic(blogs: any[]): Promise<void> {
  const dir = path.dirname(BLOGS_FILE_PATH);
  if (!fs.existsSync(dir)) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
  const tmpFile = `${BLOGS_FILE_PATH}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
  await fsPromises.writeFile(tmpFile, JSON.stringify(blogs, null, 2), 'utf-8');
  await fsPromises.rename(tmpFile, BLOGS_FILE_PATH);
}

// 4. Get all published travel group blogs
app.get('/api/blogs', requireApiAccess, rssRateLimiter, async (_req: Request, res: Response) => {
  try {
    const blogs = await readBlogsFromDisk();
    res.json({
      success: true,
      blogs: blogs.sort((a, b) => b.timestamp - a.timestamp),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Publish new blog to database (Authenticated/origin-checked, rate-limited, length-bounded, mutex-locked)
app.post('/api/blogs', requireApiAccess, publishBlogRateLimiter, async (req: Request, res: Response) => {
  try {
    const { title, author, groupName, groupContact, location, content, coverImage } = req.body || {};
    if (
      typeof title !== 'string' ||
      typeof author !== 'string' ||
      typeof content !== 'string' ||
      !title.trim() ||
      !author.trim() ||
      !content.trim()
    ) {
      res.status(400).json({ success: false, error: 'Title, Author Name, and Content are required.' });
      return;
    }

    const cleanTitle = stripHtml(title).trim();
    const cleanAuthor = stripHtml(author).trim();
    const cleanGroupName = stripHtml(typeof groupName === 'string' ? groupName : 'Bangladeshi Travel Group').trim();
    const cleanGroupContact = stripHtml(typeof groupContact === 'string' ? groupContact : '').trim();
    const cleanLocation = stripHtml(typeof location === 'string' ? location : 'Bangladesh').trim();
    const cleanContent = stripHtml(content).trim();

    if (cleanTitle.length < 3 || cleanTitle.length > 180) {
      res.status(400).json({ success: false, error: 'Title must be between 3 and 180 characters.' });
      return;
    }
    if (cleanAuthor.length < 2 || cleanAuthor.length > 80) {
      res.status(400).json({ success: false, error: 'Author name must be between 2 and 80 characters.' });
      return;
    }
    if (cleanGroupName.length > 100 || cleanGroupContact.length > 120 || cleanLocation.length > 100) {
      res.status(400).json({ success: false, error: 'Group metadata fields exceed maximum length.' });
      return;
    }
    if (cleanContent.length < 20 || cleanContent.length > 25000) {
      res.status(400).json({ success: false, error: 'Blog content must be between 20 and 25,000 characters.' });
      return;
    }

    let safeCoverImage: string | undefined;
    if (coverImage && typeof coverImage === 'string' && coverImage.trim()) {
      const trimmedCover = coverImage.trim();
      if (trimmedCover.length > 500) {
        res.status(400).json({ success: false, error: 'Cover image URL is too long.' });
        return;
      }
      const coverCheck = checkSafeExternalUrl(trimmedCover);
      if (!coverCheck.ok || !coverCheck.url) {
        res.status(400).json({ success: false, error: 'Cover image must be a valid public HTTP(S) URL.' });
        return;
      }
      safeCoverImage = coverCheck.url.href;
    }

    const createdBlog = await withBlogsLock(async () => {
      const blogs = await readBlogsFromDisk();
      const now = Date.now();
      const newBlog = {
        id: 'tb_' + now + '_' + Math.random().toString(36).substring(2, 7),
        title: cleanTitle,
        author: cleanAuthor,
        groupName: cleanGroupName || 'Bangladeshi Travel Group',
        groupContact: cleanGroupContact,
        location: cleanLocation || 'Bangladesh',
        summary: cleanContent.replace(/\s+/g, ' ').slice(0, 190) + '...',
        content: cleanContent,
        coverImage: safeCoverImage,
        publishedAt: new Date(now).toISOString(),
        timestamp: now,
        readTimeMin: calculateReadTime(cleanContent),
        likesCount: 0,
      };

      const cappedBlogs = [newBlog, ...blogs].slice(0, 200);
      await writeBlogsToDiskAtomic(cappedBlogs);
      return newBlog;
    });

    res.status(201).json({
      success: true,
      blog: createdBlog,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Get curated directory of newspaper feeds & travel groups
app.get('/api/curated', (_req: Request, res: Response) => {
  res.json({
    success: true,
    feeds: CURATED_FEEDS,
  });
});

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'Chinta iPhone RSS Reader' });
});

// Production static or dev vite middleware
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
