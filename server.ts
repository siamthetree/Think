import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsPromises from 'fs/promises';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { GoogleGenAI } from '@google/genai';
import { XMLParser } from 'fast-xml-parser';

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
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCdata(text: string): string {
  if (!text) return '';
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
}

function resolveUrl(relativeOrAbsolute: string, baseUrl?: string): string {
  if (!relativeOrAbsolute) return '';
  let trimmed = relativeOrAbsolute.trim();
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
    const rawDate = dateMatch ? cleanCdata(dateMatch[1]) : new Date().toISOString();
    const timestamp = Date.parse(rawDate) || Date.now();
    const pubDate = new Date(timestamp).toISOString();

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

      const rawDate = raw.pubDate || raw['dc:date'] || raw.published || raw.updated || new Date().toISOString();
      const timestamp = Date.parse(rawDate) || Date.now();
      const pubDate = new Date(timestamp).toISOString();

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

app.use(express.json());

// Allow CORS for native iOS Capacitor IPA builds (capacitor://localhost) and web clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

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

// Helper to fetch with realistic browser User-Agent and automatic Googlebot fallback for Cloudflare-protected news portals
async function fetchWithUserAgent(
  targetUrl: string,
  timeoutMs = 8500
): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ];

  let lastError: Error | null = null;
  for (const ua of userAgents) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': ua,
          Accept:
            'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        },
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const text = await res.text();
        return { text, contentType, finalUrl: res.url || targetUrl };
      }
      lastError = new Error(`HTTP error ${res.status}: ${res.statusText}`);
      // Do not retry 404 Not Found with other User-Agents
      if (res.status === 404 || res.status === 410) {
        break;
      }
    } catch (err: any) {
      lastError = err;
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

  // Specialized high-reliability loader for The Business Standard (tbsnews.net)
  if (url.includes('tbsnews.net')) {
    try {
      const r2jUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(
        'https://www.tbsnews.net/top-news/rss.xml'
      )}`;
      const r2jRes = await fetch(r2jUrl, { signal: AbortSignal.timeout(5500) });
      if (r2jRes.ok) {
        const r2jData = await r2jRes.json();
        if (r2jData.status === 'ok' && Array.isArray(r2jData.items) && r2jData.items.length > 0) {
          const items: FeedItem[] = r2jData.items.map((item: any) => {
            const timestamp = Date.parse(item.pubDate) || Date.now();
            const summary = stripHtml(item.description || item.content || '').slice(0, 240);
            return {
              id: `${feedInfo.id}_${encodeURIComponent(item.link || item.guid || item.title).slice(0, 80)}`,
              feedId: feedInfo.id,
              feedTitle:
                feedInfo.title && feedInfo.title !== 'Newspaper Feed'
                  ? feedInfo.title
                  : 'The Business Standard (TBS)',
              feedUrl: url,
              title: stripHtml(item.title),
              link: item.link,
              pubDate: new Date(timestamp).toISOString(),
              timestamp,
              author: item.author ? stripHtml(item.author) : 'TBS Report',
              summary,
              contentHtml: item.content || item.description || `<p>${summary}</p>`,
              contentClean: stripHtml(item.content || item.description || ''),
              imageUrl: item.thumbnail || item.enclosure?.link,
              tags: [...feedInfo.defaultTags],
              isRead: false,
              isBookmarked: false,
              isOfflineCached: true,
              readTimeMin: calculateReadTime(item.content || item.description || summary),
            };
          });
          return {
            feedTitle:
              feedInfo.title && feedInfo.title !== 'Newspaper Feed'
                ? feedInfo.title
                : 'The Business Standard (TBS)',
            items,
            resolvedUrl: 'https://www.tbsnews.net/top-news/rss.xml',
            sourceMode: 'rss',
          };
        }
      }
    } catch (e) {
      console.warn('TBS rss2json fallback failed, falling back to direct...', e);
    }
  }

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

  // Step 2: If the fetched HTML portal already has articles (e.g. bdnews24.com, thefinancialexpress.com.bd), return them fast!
  let htmlParsedFallback: { feedTitle: string; items: FeedItem[] } | null = null;
  if (fetchedHtml) {
    htmlParsedFallback = parseHtmlPortalToFeed(fetchedHtml, {
      ...feedInfo,
      url: fetchedUrl,
    });
    if (htmlParsedFallback.items.length >= 4) {
      return {
        ...htmlParsedFallback,
        resolvedUrl: url,
        sourceMode: 'direct_html',
      };
    }
  }

  // Step 3: Try common RSS/Atom URL combinations for blogs and websites where HTML scraping didn't find enough items
  let parsedTarget: URL | null = null;
  try {
    parsedTarget = new URL(url);
  } catch {}

  if (parsedTarget) {
    const cleanBase = url.replace(/\/+$/, '');
    const origin = parsedTarget.origin;
    const pathClean = parsedTarget.pathname.replace(/\/+$/, '');
    const comboSet = new Set<string>();

    if (parsedTarget.hostname.includes('medium.com') && pathClean && !pathClean.startsWith('/feed')) {
      comboSet.add(`${origin}/feed${pathClean}`);
    }

    const suffixes = [
      '/feed',
      '/rss.xml',
      '/rss',
      '/feed.xml',
      '/atom.xml',
      '/index.xml',
      '/?feed=rss2',
      '/feeds/posts/default?alt=rss',
    ];

    for (const suffix of suffixes) {
      comboSet.add(`${cleanBase}${suffix}`);
    }
    if (cleanBase !== origin) {
      for (const suffix of suffixes.slice(0, 4)) {
        comboSet.add(`${origin}${suffix}`);
      }
    }

    comboSet.delete(url);
    comboSet.delete(fetchedUrl);
    for (const seen of htmlDiscoveredCandidates) comboSet.delete(seen);

    const candidateList = Array.from(comboSet).slice(0, 8);
    const batchSize = 4;
    for (let i = 0; i < candidateList.length; i += batchSize) {
      const batch = candidateList.slice(i, i + batchSize);
      const found = await Promise.all(
        batch.map(async (candidate) => {
          try {
            const { text } = await fetchWithUserAgent(candidate, 2500);
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
  }

  if (htmlParsedFallback && htmlParsedFallback.items.length > 0) {
    return {
      ...htmlParsedFallback,
      resolvedUrl: url,
      sourceMode: 'direct_html',
    };
  }

  // Step 4: Fallback for Cloudflare-protected Bangladeshi portals (e.g., tbsnews.net, dhakatribune.com, jugantor.com)
  if (parsedTarget) {
    const hostname = parsedTarget.hostname.replace(/^www\./, '');
    const isBanglaDomain = /jugantor|kalerkantho|samakal|ittefaq|banglatribune|manabzamin|bonikbarta/i.test(hostname);
    const queryUrl = isBanglaDomain
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${hostname}`)}&hl=bn&gl=BD&ceid=BD:bn`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${hostname}`)}&hl=en-BD&gl=BD&ceid=BD:en`;

    try {
      const { text } = await fetchWithUserAgent(queryUrl, 6500);
      if (isXmlFeedContent(text)) {
        const parsed = parseXmlFeed(text, {
          ...feedInfo,
          title: feedInfo.title !== 'Newspaper Feed' ? feedInfo.title : hostname,
          url,
        });
        // Clean up Google News suffix in title & set feedTitle cleanly
        const cleanFeedTitle =
          feedInfo.title && feedInfo.title !== 'Newspaper Feed' && feedInfo.title !== 'RSS Feed'
            ? feedInfo.title
            : hostname;
        const cleanedItems = parsed.items.map((item) => {
          const cleanTitle = item.title.replace(/\s+-\s+[^-]+$/, '').trim() || item.title;
          // Google News RSS descriptions often just repeat the headline + source name
          const rawSum = (item.summary || '').replace(/\s+-\s+[^-]+$/, '').trim();
          const hasDistinctSummary =
            rawSum.length > 35 &&
            rawSum.toLowerCase() !== cleanTitle.toLowerCase() &&
            !cleanTitle.toLowerCase().includes(rawSum.toLowerCase().slice(0, 30));
          return {
            ...item,
            feedTitle: cleanFeedTitle,
            title: cleanTitle,
            summary: hasDistinctSummary ? item.summary : '',
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

  throw new Error(`Could not load articles from "${rawUrl}". Please check the URL and try again.`);
}

// 1. Fetch and parse RSS or Direct HTML Portal
app.get('/api/rss', async (req: Request, res: Response) => {
  const feedUrl = req.query.url as string;
  const feedId = (req.query.feedId as string) || (req.query.id as string) || `feed_${Date.now()}`;
  const feedTitle = (req.query.title as string) || 'Newspaper Feed';
  const defaultTags = req.query.tags ? (req.query.tags as string).split(',').filter(Boolean) : [];

  if (!feedUrl) {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }

  // Handle Community Travel Blogs Feed directly from database
  if (feedUrl === '/api/blogs' || feedUrl.includes('api/blogs') || feedId === 'travel_blogs_bd') {
    try {
      const blogs = await readBlogsFromDisk();
      const items = blogs.map((b) => ({
        id: b.id,
        feedId: 'travel_blogs_bd',
        feedTitle: b.groupName ? `${b.groupName} (${b.author})` : `Traveler: ${b.author}`,
        feedUrl: '/api/blogs',
        title: b.title,
        link: `/blog/${b.id}`,
        pubDate: b.publishedAt,
        timestamp: b.timestamp,
        author: `${b.author} · ${b.groupName || 'Bangladeshi Travel Group'}`,
        summary: b.summary || b.content.slice(0, 180) + '...',
        contentHtml: `
          <div class="travel-group-badge mb-4 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-200">
            <p class="text-xs uppercase font-bold tracking-wider text-emerald-400 mb-1">Bangladeshi Travel Group Dispatch</p>
            <p class="text-sm font-semibold text-stone-100">${b.groupName || 'Travel Group'} · Writer: ${b.author}</p>
            ${b.location ? `<p class="text-xs text-stone-300 mt-1">📍 Destination: ${b.location}</p>` : ''}
            ${b.groupContact ? `<p class="text-xs text-emerald-300 mt-1.5 font-sans">Connect with Group: <span class="underline">${b.groupContact}</span></p>` : ''}
          </div>
          ${b.content.split(/\n\n+/).map((p: string) => `<p>${p.trim()}</p>`).join('\n')}
        `,
        contentClean: b.content,
        imageUrl: b.coverImage,
        tags: ['tag_travel', 'tag_bd'],
        isRead: false,
        isBookmarked: false,
        isOfflineCached: true,
        readTimeMin: b.readTimeMin || calculateReadTime(b.content),
      }));

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
app.get('/api/extract', async (req: Request, res: Response) => {
  let articleUrl = (req.query.url as string) || '';
  if (!articleUrl) {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }
  if (!/^https?:\/\//i.test(articleUrl.trim())) {
    articleUrl = 'https://' + articleUrl.trim();
  }

  // Check cache first for instant retrieval
  if (EXTRACTED_ARTICLE_CACHE.has(articleUrl)) {
    return res.json(EXTRACTED_ARTICLE_CACHE.get(articleUrl));
  }

  try {
    const { text: html, finalUrl } = await fetchWithUserAgent(articleUrl, 6500);
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
    const title =
      jsonLdHeadline ||
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      'Article';

    // Author
    const author =
      jsonLdAuthor ||
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
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content');
    const leadImage = rawLeadImage ? resolveUrl(rawLeadImage, finalUrl) : undefined;

    // Description / Summary
    const metaDescription =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    // Remove noise, scripts, ads, sidebars, related links, popups, and clutter
    $(
      'script, style, noscript, iframe, svg, nav, footer, header, aside, form, button, ' +
      '.advertisement, .ads, .ad-slot, .ad-container, [id*="google_ads"], [class*="google-ads"], ' +
      '.cookie-banner, .subscribe-banner, .subscription-wall, .paywall, .social-share, .share-buttons, ' +
      '.newsletter-signup, .related-news, .most-viewed, .trending-news, .read-more, .comments, ' +
      '.print-only, .embedded-widget, .outbrain, .taboola, [class*="sponsored"], [id*="sponsored"]'
    ).remove();

    // Choose the richest article-like container rather than the first matching
    // wrapper, which is often only a headline/teaser on modern news sites.
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
        .filter((text) => text.length >= 20);
      const textLength = paragraphText.reduce((total, text) => total + text.length, 0);
      const score = textLength + paragraphText.length * 120;
      if (score > bestScore) {
        bestScore = score;
        $article = $candidate;
      }
    });

    const contentBlocks: {
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

      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (!text || (text.length < 20 && tagName === 'p')) return;

      // Filter out boilerplate sentences, social prompts, and paywall banners
      if (
        /^(cookie|subscribe to|sign up for|advertisement|all rights reserved|follow us on|read more:|also read:|click here|download app|share this article)/i.test(
          text
        )
      ) {
        return;
      }

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

    // If DOM extraction returned sparse text but JSON-LD articleBody is available, hydrate full paragraphs!
    const domParagraphCount = contentBlocks.filter((b) => b.type === 'p').length;
    const domTextLength = contentBlocks
      .map((block) => block.text || '')
      .join(' ')
      .length;
    if (
      jsonLdBody &&
      (domParagraphCount < 3 ||
        jsonLdBody.length > 600 ||
        jsonLdBody.length > Math.max(800, domTextLength * 1.35))
    ) {
      const paragraphs = jsonLdBody
        .split(/\n{2,}|\r\n{2,}/)
        .map((p) => stripHtml(p).trim())
        .filter((p) => p.length > 25);

      if (paragraphs.length >= 2 || jsonLdBody.trim().length > Math.max(800, domTextLength * 1.35)) {
        contentBlocks.length = 0;
        for (const p of paragraphs.length > 0 ? paragraphs : [stripHtml(jsonLdBody).trim()]) {
          contentBlocks.push({ type: 'p', text: p });
        }
      }
    }

    // Ensure at least metaDescription if page had minimal text
    if (contentBlocks.length === 0 && metaDescription) {
      contentBlocks.push({ type: 'p', text: stripHtml(metaDescription) });
    }

    const fullText = contentBlocks
      .map((b) => b.text || '')
      .filter(Boolean)
      .join(' ');
    const readTimeMin = calculateReadTime(fullText || metaDescription);

    const responsePayload = {
      success: true,
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

    // Cache the result for instant future opens
    EXTRACTED_ARTICLE_CACHE.set(articleUrl, responsePayload);
    if (finalUrl !== articleUrl) {
      EXTRACTED_ARTICLE_CACHE.set(finalUrl, responsePayload);
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
app.post('/api/summarize', async (req: Request, res: Response) => {
  try {
    const { title, text, language } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length < 50) {
      res.status(400).json({ success: false, error: 'Article text too short to summarize' });
      return;
    }

    const cleanBody = stripHtml(text).slice(0, 15000);
    const articleTitle = stripHtml(title || 'Newspaper Article');

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

Provide your response in JSON format with exactly:
- "executiveSummary": A concise, authoritative 2-3 sentence overview capturing the core news development, significance, and primary parties involved.
- "keyTakeaways": An array of 3 to 5 concise bullet points highlighting crucial facts, numbers, dates, policy impacts, or statements.
- "context": A 1-sentence note on why this news matters to readers or its broader national/international impact.
Keep language professional, objective, and neutral (in ${language || 'the original article language'}).`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

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

// --- Travel Blogs Database (Persistent Storage in data/blogs.json) ---
const BLOGS_FILE_PATH = path.resolve(__dirname, 'data', 'blogs.json');

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

async function writeBlogsToDisk(blogs: any[]): Promise<void> {
  try {
    const dir = path.dirname(BLOGS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fsPromises.writeFile(BLOGS_FILE_PATH, JSON.stringify(blogs, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('Failed to write to blogs.json database:', err.message);
  }
}

// 4. Get all published travel group blogs
app.get('/api/blogs', async (_req: Request, res: Response) => {
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

// 5. Publish new blog to database
app.post('/api/blogs', async (req: Request, res: Response) => {
  try {
    const { title, author, groupName, groupContact, location, content, coverImage } = req.body;
    if (!title || !author || !content) {
      res.status(400).json({ success: false, error: 'Title, Author Name, and Content are required.' });
      return;
    }

    const blogs = await readBlogsFromDisk();
    const newBlog = {
      id: 'tb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      title: title.trim(),
      author: author.trim(),
      groupName: (groupName || 'Bangladeshi Travel Group').trim(),
      groupContact: (groupContact || '').trim(),
      location: (location || 'Bangladesh').trim(),
      summary: content.trim().replace(/\s+/g, ' ').slice(0, 190) + '...',
      content: content.trim(),
      coverImage: coverImage && typeof coverImage === 'string' && coverImage.trim().startsWith('http') ? coverImage.trim() : undefined,
      publishedAt: new Date().toISOString(),
      timestamp: Date.now(),
      readTimeMin: calculateReadTime(content),
      likesCount: 0,
    };

    blogs.unshift(newBlog);
    await writeBlogsToDisk(blogs);

    console.log(`[Blog Database] Published new travel blog "${newBlog.title}" by ${newBlog.author} (${newBlog.groupName})`);

    res.status(201).json({
      success: true,
      blog: newBlog,
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
  res.json({ status: 'ok', service: 'PaperPress iPhone RSS Reader' });
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
