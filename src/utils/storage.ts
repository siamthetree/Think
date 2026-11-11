import type { Tag, Feed, FeedItem, ReaderPreferences } from '../types';

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

export const INITIAL_FEEDS: Feed[] = [
  {
    id: 'daily_star',
    title: 'The Daily Star',
    url: 'https://www.thedailystar.net/rss.xml',
    siteUrl: 'https://www.thedailystar.net',
    description: 'Leading English-language daily newspaper in Bangladesh.',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_investigative'],
  },
  {
    id: 'prothom_alo_en',
    title: 'Prothom Alo (English)',
    url: 'https://en.prothomalo.com',
    siteUrl: 'https://en.prothomalo.com',
    description: 'National news, politics, economy, and views from Dhaka.',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_world'],
  },
  {
    id: 'prothom_alo_bn',
    title: 'প্রথম আলো (Prothom Alo Bangla)',
    url: 'https://www.prothomalo.com',
    siteUrl: 'https://www.prothomalo.com',
    description: 'বাংলাদেশের শীর্ষস্থানীয় বাংলা দৈনিক পত্রিকা (Direct & Feed Reader)।',
    category: 'Bangladesh (বাংলা)',
    defaultTags: ['tag_bd'],
  },
  {
    id: 'bdnews24',
    title: 'bdnews24.com',
    url: 'https://bdnews24.com',
    siteUrl: 'https://bdnews24.com',
    description: 'Direct Portal Reader - Loads stories directly from bdnews24.com without needing RSS.',
    category: 'Bangladesh (Direct URL)',
    defaultTags: ['tag_bd', 'tag_breaking'],
  },
  {
    id: 'fe_bd',
    title: 'The Financial Express (BD)',
    url: 'https://thefinancialexpress.com.bd',
    siteUrl: 'https://thefinancialexpress.com.bd',
    description: 'Direct Portal Reader - Trade, banking, and economic news from Bangladesh.',
    category: 'Bangladesh Finance',
    defaultTags: ['tag_bd', 'tag_markets'],
  },
  {
    id: 'tbs_news',
    title: 'The Business Standard (TBS)',
    url: 'https://www.tbsnews.net',
    siteUrl: 'https://www.tbsnews.net',
    description: 'Direct Portal Reader - Business, economy, and policy journalism in Bangladesh.',
    category: 'Bangladesh Finance',
    defaultTags: ['tag_bd', 'tag_markets'],
  },
  {
    id: 'dhaka_tribune',
    title: 'Dhaka Tribune',
    url: 'https://www.dhakatribune.com',
    siteUrl: 'https://www.dhakatribune.com',
    description: 'Direct Portal Reader - National politics, foreign affairs, and Dhaka dispatches.',
    category: 'Bangladesh',
    defaultTags: ['tag_bd', 'tag_opinion'],
  },
  {
    id: 'bbc_world',
    title: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    siteUrl: 'https://bbc.com/news',
    description: 'Global news, correspondents, and impartial reporting.',
    category: 'World',
    defaultTags: ['tag_world', 'tag_breaking'],
  },
];

const STORAGE_KEYS = {
  FEEDS: 'paperpress_feeds_v2',
  ARTICLES: 'paperpress_articles_v2',
  TAGS: 'paperpress_tags_v2',
  PREFS: 'paperpress_reader_prefs_v2',
  FOLDERS: 'paperpress_folders_v1',
};

export const DEFAULT_FOLDERS: string[] = [
  'Bangladesh',
  'Bangladesh (বাংলা)',
  'Bangladesh Finance',
  'World',
];

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  font: 'serif',
  fontSize: 18,
  theme: 'slate',
  lineHeight: 'relaxed',
  distractionFree: false,
};

// Storage limits (localStorage is roughly 5 MB per origin)
const MAX_UNSAVED_ARTICLES = 400;
const MAX_HTML_CHARS = 60000;
const FULL_BODY_MIN_CHARS = 800;

// Demo stories shipped by older versions. They were invented, so they are removed on load.
const LEGACY_DEMO_ID = /^art_(ds|pa_en|pa_bn|bdnews|fe|tbs|dt|bbc)_\d+$/;

/** True when the article carries a full body that can be read without network access. */
export function hasFullBody(item: Pick<FeedItem, 'contentClean'>): boolean {
  return (item.contentClean || '').trim().length >= FULL_BODY_MIN_CHARS;
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

/**
 * Keep every bookmarked story plus the newest unsaved ones, and cap the size of each body.
 * Bookmarked stories are never dropped.
 */
export function pruneArticles(articles: FeedItem[], maxUnsaved = MAX_UNSAVED_ARTICLES): FeedItem[] {
  const saved = articles.filter((a) => a.isBookmarked);
  const others = articles
    .filter((a) => !a.isBookmarked)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxUnsaved);
  return [...saved, ...others]
    .map((a) =>
      a.contentHtml && a.contentHtml.length > MAX_HTML_CHARS
        ? { ...a, contentHtml: a.contentHtml.slice(0, MAX_HTML_CHARS) }
        : a
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function loadFeedsFromStorage(): Feed[] {
  return readArray<Feed>(STORAGE_KEYS.FEEDS) || INITIAL_FEEDS;
}

export function saveFeedsToStorage(feeds: Feed[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.FEEDS, JSON.stringify(feeds));
  } catch (e) {
    console.error('Failed to save feeds to localStorage', e);
  }
}

const PLACEHOLDER_SUMMARY_RE = /tap to load full story|full story loads in the app's reading mode/i;

export function isPlaceholderSummary(text?: string): boolean {
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
      const cleanHtml =
        a.contentHtml && isPlaceholderSummary(a.contentHtml) ? '' : a.contentHtml;
      return {
        ...a,
        summary: cleanSummary,
        contentHtml: cleanHtml,
        tags: Array.isArray(a.tags) ? a.tags : [],
        // Older versions marked every story as cached. Only stories with a real body count.
        isOfflineCached: Boolean(a.isOfflineCached) && hasFullBody(a),
      };
    });
}

export function saveArticlesToStorage(articles: FeedItem[]): void {
  let limit = MAX_UNSAVED_ARTICLES;
  // On a quota error, retry with fewer stories, then without stored HTML for unsaved ones.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      localStorage.setItem(STORAGE_KEYS.ARTICLES, JSON.stringify(pruneArticles(articles, limit)));
      return;
    } catch (e) {
      limit = Math.floor(limit / 2);
      if (limit < 20) break;
    }
  }
  try {
    const slim = pruneArticles(articles, 50).map((a) =>
      a.isBookmarked ? a : { ...a, contentHtml: undefined }
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

export function loadFoldersFromStorage(): string[] {
  const stored = readArray<string>(STORAGE_KEYS.FOLDERS);
  if (stored && stored.length > 0) {
    return Array.from(new Set([...DEFAULT_FOLDERS, ...stored.map((s) => s.trim()).filter(Boolean)]));
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

