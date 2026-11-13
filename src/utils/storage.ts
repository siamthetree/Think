import type { Feed, FeedItem, ReaderPreferences, Tag } from '../types';
import type { ReadingHabitState, ReadingProgressItem } from './feedIntelligence';
import type { ReadingSpeedProfile } from './readingSpeed';
import { truncateHtmlSafely } from './urlSecurity';

export interface PrivacySettings {
  connectionMode: 'relay' | 'direct';
  blockThirdPartyMedia: boolean;
  tapToLoadMedia: boolean;
}

export const PRIVACY_SETTINGS_KEY = 'chinta_privacy_settings';

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  connectionMode: 'relay',
  blockThirdPartyMedia: true,
  tapToLoadMedia: true,
};

export function loadPrivacySettingsFromStorage(): PrivacySettings {
  try {
    const raw = localStorage.getItem(PRIVACY_SETTINGS_KEY);
    if (!raw) return DEFAULT_PRIVACY_SETTINGS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PRIVACY_SETTINGS;

    return {
      connectionMode: 'relay',
      blockThirdPartyMedia:
        typeof parsed.blockThirdPartyMedia === 'boolean'
          ? parsed.blockThirdPartyMedia
          : DEFAULT_PRIVACY_SETTINGS.blockThirdPartyMedia,
      tapToLoadMedia:
        typeof parsed.tapToLoadMedia === 'boolean'
          ? parsed.tapToLoadMedia
          : DEFAULT_PRIVACY_SETTINGS.tapToLoadMedia,
    };
  } catch {
    return DEFAULT_PRIVACY_SETTINGS;
  }
}

export function savePrivacySettingsToStorage(settings: PrivacySettings): void {
  try {
    const safeSettings: PrivacySettings = {
      ...settings,
      connectionMode: 'relay',
    };
    localStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(safeSettings));
  } catch {
    // Ignore storage write errors
  }
}

export const DEFAULT_TAGS: Tag[] = [
  { id: 'tag_bd', name: 'Bangladesh', color: '#059669' },
  { id: 'tag_world', name: 'World Affairs', color: '#2563EB' },
  { id: 'tag_investigative', name: 'Investigative', color: '#7C3AED' },
  { id: 'tag_markets', name: 'Economy & Finance', color: '#0D9488' },
  { id: 'tag_opinion', name: 'Opinion & Editorial', color: '#B45309' },
  { id: 'tag_tech', name: 'Technology', color: '#4338CA' },
  { id: 'tag_culture', name: 'Culture & Literature', color: '#BE185D' },
  { id: 'tag_breaking', name: 'Breaking News', color: '#DC2626' },
];

export const INITIAL_FEEDS: Feed[] = [];

const STORAGE_KEYS = {
  FEEDS: 'paperpress_feeds_v2',
  ARTICLES: 'paperpress_articles_v2',
  TAGS: 'paperpress_tags_v2',
  PREFS: 'paperpress_reader_prefs_v2',
  FOLDERS: 'paperpress_folders_v1',
  READ_KEYS: 'chinta_read_article_keys_v1',
};

const DEFAULT_FOLDERS: string[] = [];

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  font: 'serif',
  fontSize: 18,
  theme: 'slate',
  lineHeight: 'relaxed',
  distractionFree: false,
};

const MAX_UNSAVED_ARTICLES = 120;
const MAX_SAVED_HTML_CHARS = 50000;
const MAX_HTML_CHARS = 20000;
const FULL_BODY_MIN_CHARS = 800;
const LEGACY_DEMO_ID = /^art_(ds|pa_en|pa_bn|bdnews|fe|tbs|dt|bbc)_\d+$/;

export function hasFullBody(item: Pick<FeedItem, 'contentClean'>): boolean {
  return (item.contentClean || '').trim().length >= FULL_BODY_MIN_CHARS;
}

function truncateTextAtWordBoundary(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastParagraphBreak = slice.lastIndexOf('\n\n');
  if (lastParagraphBreak >= Math.floor(maxChars * 0.6)) {
    return slice.slice(0, lastParagraphBreak);
  }
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
}

function readArray<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch (e) {
    console.error(`Failed to load ${key} from localStorage`, e);
    return null;
  }
}

function pruneArticles(articles: FeedItem[], maxUnsaved = MAX_UNSAVED_ARTICLES): FeedItem[] {
  const saved = articles.filter((a) => a.isBookmarked);
  const others = articles
    .filter((a) => !a.isBookmarked)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxUnsaved);
  return [...saved, ...others]
    .map((a) => {
      const charBudget = a.isBookmarked || a.isOfflineCached ? MAX_SAVED_HTML_CHARS : MAX_HTML_CHARS;
      return {
        ...a,
        contentHtml:
          a.contentHtml && a.contentHtml.length > charBudget
            ? truncateHtmlSafely(a.contentHtml, charBudget)
            : a.contentHtml,
        contentClean:
          a.contentClean && a.contentClean.length > charBudget
            ? truncateTextAtWordBoundary(a.contentClean, charBudget)
            : a.contentClean,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function loadFeedsFromStorage(): Feed[] {
  const stored = readArray<Feed>(STORAGE_KEYS.FEEDS);
  if (!stored) return INITIAL_FEEDS;
  return stored.map((f) => {
    if (f.id === 'prothom_alo_en' && f.url === 'https://en.prothomalo.com') {
      return { ...f, url: 'https://en.prothomalo.com/feed' };
    }
    if (f.id === 'prothom_alo_bn' && f.url === 'https://www.prothomalo.com') {
      return { ...f, url: 'https://www.prothomalo.com/feed' };
    }
    if (f.id === 'tbs_news' && f.url === 'https://www.tbsnews.net') {
      return { ...f, url: 'https://www.tbsnews.net/top-news/rss.xml' };
    }
    return f;
  });
}

export function saveFeedsToStorage(feeds: Feed[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.FEEDS, JSON.stringify(feeds));
  } catch (e) {
    console.error('Failed to save feeds to localStorage', e);
  }
}

const PLACEHOLDER_SUMMARY_RE = /tap to load full story|full story loads in the app's reading mode/i;

export function isPlaceholderSummary(text?: string | null): boolean {
  if (!text) return false;
  return PLACEHOLDER_SUMMARY_RE.test(text);
}

export function loadArticlesFromStorage(): FeedItem[] {
  const stored = readArray<FeedItem>(STORAGE_KEYS.ARTICLES);
  if (!stored) return [];
  return stored
    .filter((a) => a && typeof a.id === 'string' && !LEGACY_DEMO_ID.test(a.id))
    .map((a) => {
      const cleanSummary = isPlaceholderSummary(a.summary) ? '' : a.summary;
      const cleanHtml = a.contentHtml && isPlaceholderSummary(a.contentHtml) ? '' : a.contentHtml;
      return {
        ...a,
        summary: cleanSummary,
        contentHtml: cleanHtml,
        tags: Array.isArray(a.tags) ? a.tags : [],
        isOfflineCached: Boolean(a.isOfflineCached) && hasFullBody(a),
      };
    });
}

const IDB_NAME = 'chinta_offline_db';
const IDB_STORE = 'kv_store';

function openOfflineIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let storagePersistRequested = false;
function requestDurableStorage(): void {
  if (storagePersistRequested || typeof navigator === 'undefined') return;
  storagePersistRequested = true;
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {}
}

export async function hydrateArticlesFromIndexedDb(): Promise<FeedItem[] | null> {
  const db = await openOfflineIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(STORAGE_KEYS.ARTICLES);
      req.onsuccess = () => {
        resolve(Array.isArray(req.result) ? (req.result as FeedItem[]) : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function mirrorArticlesToIndexedDb(pruned: FeedItem[]): void {
  requestDurableStorage();
  openOfflineIdb()
    .then((db) => {
      if (!db) return;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(pruned, STORAGE_KEYS.ARTICLES);
    })
    .catch(() => {});
}

export function saveArticlesToStorage(articles: FeedItem[]): void {
  const pruned = pruneArticles(articles, MAX_UNSAVED_ARTICLES);
  mirrorArticlesToIndexedDb(pruned);
  try {
    localStorage.setItem(STORAGE_KEYS.ARTICLES, JSON.stringify(pruned));
    return;
  } catch {}
  try {
    const slim = pruneArticles(articles, 50).map((a) =>
      a.isBookmarked ? a : { ...a, contentHtml: undefined, contentClean: undefined }
    );
    localStorage.setItem(STORAGE_KEYS.ARTICLES, JSON.stringify(slim));
  } catch (e) {
    console.error('Failed to save articles to localStorage', e);
  }
}

export function loadTagsFromStorage(): Tag[] {
  return readArray<Tag>(STORAGE_KEYS.TAGS) || DEFAULT_TAGS;
}

export function saveTagsToStorage(tags: Tag[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(tags));
  } catch (e) {
    console.error('Failed to save tags to localStorage', e);
  }
}

export function loadPreferencesFromStorage(): ReaderPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (raw) return { ...DEFAULT_READER_PREFERENCES, ...JSON.parse(raw) };
  } catch (e) {
    console.error('Failed to load preferences from localStorage', e);
  }
  return DEFAULT_READER_PREFERENCES;
}

export function savePreferencesToStorage(prefs: ReaderPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save preferences to localStorage', e);
  }
}

export function loadReadArticleKeysFromStorage(): string[] {
  return readArray<string>(STORAGE_KEYS.READ_KEYS) || [];
}

export function saveReadArticleKeysToStorage(keys: string[]): void {
  try {
    const bounded = keys.length > 2000 ? keys.slice(-2000) : keys;
    localStorage.setItem(STORAGE_KEYS.READ_KEYS, JSON.stringify(bounded));
  } catch (e) {
    console.error('Failed to save read article keys to localStorage', e);
  }
}

export function loadFoldersFromStorage(): string[] {
  const stored = readArray<string>(STORAGE_KEYS.FOLDERS);
  if (stored && stored.length > 0) {
    return Array.from(new Set(stored.map((s) => s.trim()).filter(Boolean)));
  }
  return DEFAULT_FOLDERS;
}

export function saveFoldersToStorage(folders: string[]): void {
  try {
    const clean = Array.from(new Set(folders.map((f) => f.trim()).filter(Boolean)));
    localStorage.setItem(STORAGE_KEYS.FOLDERS, JSON.stringify(clean));
  } catch (e) {
    console.error('Failed to save folders to localStorage', e);
  }
}

const HABIT_STORAGE_KEY = 'chinta_reading_habit_v1';
const PROGRESS_STORAGE_KEY = 'chinta_reading_progress_v1';

export function loadReadingHabitFromStorage(fallback: ReadingHabitState): ReadingHabitState {
  try {
    const raw = localStorage.getItem(HABIT_STORAGE_KEY);
    if (raw) {
      return { ...fallback, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Failed to load reading habit from localStorage', e);
  }
  return fallback;
}

export function saveReadingHabitToStorage(state: ReadingHabitState): void {
  try {
    localStorage.setItem(HABIT_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save reading habit to localStorage', e);
  }
}

export function loadReadingProgressFromStorage<T = ReadingProgressItem>(): T | null {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return null;
}

export function saveReadingProgressToStorage<T = ReadingProgressItem>(progress: T | null): void {
  try {
    if (!progress) {
      localStorage.removeItem(PROGRESS_STORAGE_KEY);
    } else {
      localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    }
  } catch {}
}

const READING_SPEED_KEY = 'chinta_reading_speed_v1';

export function loadReadingSpeedProfileFromStorage(
  fallback: ReadingSpeedProfile
): ReadingSpeedProfile {
  try {
    const raw = localStorage.getItem(READING_SPEED_KEY);
    if (raw) {
      return JSON.parse(raw) as ReadingSpeedProfile;
    }
  } catch (e) {
    console.error('Failed to load reading speed profile from localStorage', e);
  }
  return fallback;
}

export function saveReadingSpeedProfileToStorage(profile: ReadingSpeedProfile): void {
  try {
    localStorage.setItem(READING_SPEED_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('Failed to save reading speed profile to localStorage', e);
  }
}
