export interface Tag {
  id: string;
  name: string;
  color: string; // e.g. '#2563EB', '#059669', '#DC2626', etc.
}

export interface Feed {
  id: string;
  title: string;
  url: string;
  siteUrl?: string;
  description?: string;
  category: string;
  defaultTags: string[];
  iconUrl?: string;
  lastFetched?: number;
  unreadCount?: number;
}

export type FeedSource = Feed;

export interface FeedItem {
  id: string;
  feedId: string;
  feedTitle: string;
  feedUrl: string;
  title: string;
  link: string;
  pubDate: string; // ISO string or formatted
  timestamp: number; // for chronological sorting
  author?: string;
  summary: string;
  contentHtml?: string;
  contentClean?: string;
  imageUrl?: string;
  tags: string[]; // tag IDs
  isRead: boolean;
  isBookmarked: boolean;
  isOfflineCached: boolean;
  hiddenFromFeed?: boolean;
  cachedAt?: number;
  fetchedBatchTs?: number;
  readTimeMin: number;
}

export type ReaderFont = 'serif' | 'sans' | 'mono';
export type ReaderTheme = 'paper' | 'sepia' | 'clean' | 'slate' | 'oled';
export type ReaderLineHeight = 'normal' | 'relaxed' | 'loose';

export interface PrivacyPreferences {
  blockThirdPartyMedia: boolean;
  strictTextOnlyMode: boolean;
  privacyRelayUrl: string;
  staticFeedMirrorUrl: string;
}

export interface ReaderPreferences {
  font: ReaderFont;
  fontSize: number; // 15 to 24px
  theme: ReaderTheme;
  lineHeight: ReaderLineHeight;
  distractionFree: boolean;
  blockThirdPartyMedia?: boolean;
  strictTextOnlyMode?: boolean;
  privacyRelayUrl?: string;
  staticFeedMirrorUrl?: string;
}

export interface CuratedFeedGroup {
  category: string;
  feeds: {
    title: string;
    url: string;
    siteUrl: string;
    description: string;
    tags: string[];
  }[];
}

export interface TravelBlog {
  id: string;
  title: string;
  author: string;
  groupName: string;
  groupContact?: string;
  location: string;
  summary: string;
  content: string;
  coverImage?: string;
  publishedAt: string;
  timestamp: number;
  readTimeMin: number;
  likesCount?: number;
}
