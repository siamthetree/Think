import type { Feed, FeedItem, ReaderPreferences } from '../types';
import type { ReadingHabitState } from './feedIntelligence';
import type { ReadingSpeedProfile } from './readingSpeed';
import { getArticleReadSignatures, canonicalizeArticleLink, normalizeHeadlineKey } from './feedIntelligence';

export const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

const READER_FONTS = new Set<'serif' | 'sans' | 'mono'>(['serif', 'sans', 'mono']);
const READER_THEMES = new Set<'paper' | 'sepia' | 'clean' | 'slate' | 'oled'>([
  'paper',
  'sepia',
  'clean',
  'slate',
  'oled',
]);
const READER_LINE_HEIGHTS = new Set<'normal' | 'relaxed' | 'loose'>(['normal', 'relaxed', 'loose']);

/**
 * Deterministic safe Firestore document ID (1..128 chars matching ^[a-zA-Z0-9_-]+$).
 */
export function toFirestoreSafeId(raw: string): string {
  const input = String(raw || '').trim() || 'item';
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  const cleaned = input.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const prefix = cleaned.slice(0, Math.max(1, 110 - suffix.length)) || 'doc';
  const combined = `${prefix}_${suffix}`.slice(0, 128);
  return SAFE_ID_REGEX.test(combined) ? combined : `doc_${suffix}`;
}

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return trimmed.slice(0, maxLen);
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function clampOptionalNumber(val: unknown, min: number, max: number): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, num));
}

function clampStringArray(val: unknown, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(val)) return [];
  const out: string[] = [];
  for (const item of val) {
    if (typeof item === 'string') {
      const clipped = item.trim().slice(0, maxItemLen);
      if (clipped) out.push(clipped);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}

export interface SanitizedUserRoot {
  ownerId: string;
  displayName?: string;
  photoUrl?: string;
}

export function sanitizeUserRootPayload(params: {
  uid: string;
  displayName?: string | null;
  photoURL?: string | null;
}): SanitizedUserRoot {
  const out: SanitizedUserRoot = {
    ownerId: clampString(params.uid, 128, 'user'),
  };
  const name = clampString(params.displayName, 120);
  if (name) out.displayName = name;
  const photo = clampString(params.photoURL, 512);
  if (photo) out.photoUrl = photo;
  return out;
}

export interface SanitizedCloudStateMutable {
  folders: string[];
  preferences: ReaderPreferences;
  readingHabit: {
    dailyGoal: number;
    todayDate: string;
    todayReadIds: string[];
    todayMinutes: number;
    streakDays: number;
    lastCompletedDate: string | null;
    totalReadIds: string[];
  };
  readingSpeedProfile: ReadingSpeedProfile;
}

function sanitizeLangSpeed(
  lang: 'en' | 'bn',
  raw: ReadingSpeedProfile['en'] | undefined
): ReadingSpeedProfile['en'] {
  const observationsRaw = Array.isArray(raw?.observations) ? raw!.observations : [];
  const observations = observationsRaw
    .slice(-50)
    .map((o) => ({
      articleId: clampString(o?.articleId, 128, 'article'),
      language: lang,
      wordCount: Math.round(clampNumber(o?.wordCount, 0, 500000, 0)),
      lineCount: Math.round(clampNumber(o?.lineCount, 0, 100000, 1)),
      activeMs: Math.round(clampNumber(o?.activeMs, 0, 100000000, 0)),
      wpm: Math.round(clampNumber(o?.wpm, 1, 10000, lang === 'bn' ? 190 : 220)),
      timestamp: Math.round(clampNumber(o?.timestamp, 0, Number.MAX_SAFE_INTEGER, Date.now())),
    }));

  return {
    observedCount: Math.round(clampNumber(raw?.observedCount, 0, 100000, observations.length)),
    learnedWpm: clampOptionalNumber(raw?.learnedWpm, 1, 10000),
    learnedMsPerWord: clampOptionalNumber(raw?.learnedMsPerWord, 0, 100000),
    learnedMsPerLine: clampOptionalNumber(raw?.learnedMsPerLine, 0, 100000),
    observations,
  };
}

export function sanitizeCloudStatePayload(params: {
  uid: string;
  folders: string[];
  preferences: ReaderPreferences;
  readingHabit: ReadingHabitState;
  readingSpeedProfile: ReadingSpeedProfile;
}): SanitizedCloudStateMutable & { ownerId: string } {
  const prefFont = READER_FONTS.has(params.preferences.font)
    ? params.preferences.font
    : 'serif';
  const prefTheme = READER_THEMES.has(params.preferences.theme)
    ? params.preferences.theme
    : 'paper';
  const prefLineHeight = READER_LINE_HEIGHTS.has(params.preferences.lineHeight)
    ? params.preferences.lineHeight
    : 'relaxed';

  const lastDate =
    typeof params.readingHabit.lastCompletedDate === 'string' && params.readingHabit.lastCompletedDate.trim()
      ? params.readingHabit.lastCompletedDate.trim().slice(0, 20)
      : null;

  return {
    ownerId: clampString(params.uid, 128),
    folders: clampStringArray(params.folders, 50, 64),
    preferences: {
      font: prefFont,
      fontSize: clampNumber(params.preferences.fontSize, 12, 36, 18),
      theme: prefTheme,
      lineHeight: prefLineHeight,
      distractionFree: Boolean(params.preferences.distractionFree),
    },
    readingHabit: {
      dailyGoal: clampNumber(params.readingHabit.dailyGoal, 1, 100, 3),
      todayDate: clampString(params.readingHabit.todayDate, 20, '1970-01-01'),
      todayReadIds: clampStringArray(params.readingHabit.todayReadIds, 200, 128),
      todayMinutes: clampNumber(params.readingHabit.todayMinutes, 0, 10000, 0),
      streakDays: clampNumber(params.readingHabit.streakDays, 0, 50000, 1),
      lastCompletedDate: lastDate,
      totalReadIds: clampStringArray(params.readingHabit.totalReadIds || [], 500, 128),
    },
    readingSpeedProfile: {
      en: sanitizeLangSpeed('en', params.readingSpeedProfile?.en),
      bn: sanitizeLangSpeed('bn', params.readingSpeedProfile?.bn),
    },
  };
}

export function sanitizeSourcePayload(uid: string, feed: Feed) {
  const payload: {
    ownerId: string;
    id: string;
    title: string;
    url: string;
    siteUrl?: string;
    category: string;
    description?: string;
    defaultTags: string[];
  } = {
    ownerId: clampString(uid, 128),
    id: clampString(feed.id, 128, toFirestoreSafeId(feed.url)),
    title: clampString(feed.title, 200, 'Newspaper Source'),
    url: clampString(feed.url, 1024, 'https://example.com'),
    category: clampString(feed.category, 80, ''),
    defaultTags: clampStringArray(feed.defaultTags, 20, 64),
  };
  const siteUrl = clampString(feed.siteUrl, 1024);
  if (siteUrl) payload.siteUrl = siteUrl;
  const desc = clampString(feed.description, 500);
  if (desc) payload.description = desc;
  return payload;
}

export function sanitizeBookmarkPayload(uid: string, article: FeedItem) {
  const payload: {
    ownerId: string;
    id: string;
    feedId: string;
    feedTitle: string;
    feedUrl?: string;
    title: string;
    link: string;
    pubDate?: string;
    timestamp: number;
    author?: string;
    summary?: string;
    imageUrl?: string;
    tags: string[];
    readTimeMin: number;
  } = {
    ownerId: clampString(uid, 128),
    id: clampString(article.id, 128, toFirestoreSafeId(article.link || article.title)),
    feedId: clampString(article.feedId, 128, 'feed'),
    feedTitle: clampString(article.feedTitle, 200, 'Newspaper Source'),
    title: clampString(article.title, 400, 'Untitled Article'),
    link: clampString(article.link, 1024, 'https://example.com'),
    timestamp: clampNumber(article.timestamp, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    tags: clampStringArray(article.tags, 20, 64),
    readTimeMin: clampNumber(article.readTimeMin, 1, 600, 2),
  };

  const feedUrl = clampString(article.feedUrl, 1024);
  if (feedUrl) payload.feedUrl = feedUrl;
  const pubDate = clampString(article.pubDate, 64);
  if (pubDate) payload.pubDate = pubDate;
  const author = clampString(article.author, 160);
  if (author) payload.author = author;
  const summary = clampString(article.summary, 600);
  if (summary) payload.summary = summary;
  const imageUrl = clampString(article.imageUrl, 1024);
  if (imageUrl) payload.imageUrl = imageUrl;
  return payload;
}

export function sanitizeReadEntryPayload(
  uid: string,
  article: Pick<FeedItem, 'id' | 'link' | 'title'>,
  readAt = Date.now()
) {
  const sigs = getArticleReadSignatures(article);
  const entryKey = clampString(article.id || sigs[0] || article.title, 256, 'entry');
  const payload: {
    ownerId: string;
    entryKey: string;
    canonicalUrl?: string;
    headlineKey?: string;
    readAt: number;
  } = {
    ownerId: clampString(uid, 128),
    entryKey,
    readAt: clampNumber(readAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
  };
  const canon = article.link ? clampString(canonicalizeArticleLink(article.link), 1024) : '';
  if (canon) payload.canonicalUrl = canon;
  const rawHeadline = article.title ? normalizeHeadlineKey(article.title) : '';
  const headlineKey = rawHeadline.length >= 18 ? clampString(`title:${rawHeadline}`, 300) : '';
  if (headlineKey) payload.headlineKey = headlineKey;
  return payload;
}
