import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  CheckCheck,
  ArrowDownCircle,
  LayoutList,
  Rows3,
  Folder,
  X,
} from 'lucide-react';
import { IPhoneFrame } from './components/IPhoneFrame';
import { ArticleCard } from './components/ArticleCard';
import { ReaderView } from './components/ReaderView';
import { TabBar, type TabType } from './components/TabBar';
import { SourcesSection } from './components/SourcesSection';
import { TagManagerModal } from './components/TagManagerModal';
import { FeedManagerModal } from './components/FeedManagerModal';
import { IosBuildModal } from './components/IosBuildModal';
import { PullToRefresh } from './components/PullToRefresh';
import { triggerHapticSelection } from './utils/haptics';
import type { Feed, FeedItem, Tag, ReaderPreferences } from './types';
import {
  loadFeedsFromStorage,
  saveFeedsToStorage,
  loadArticlesFromStorage,
  saveArticlesToStorage,
  loadTagsFromStorage,
  saveTagsToStorage,
  loadFoldersFromStorage,
  saveFoldersToStorage,
  loadPreferencesFromStorage,
  savePreferencesToStorage,
  hasFullBody,
} from './utils/storage';
import { filterArticles } from './utils/feedParser';
import {
  fetchFeedWithFallback,
  extractArticleWithFallback,
} from './utils/apiClient';
import { blocksToHtml, escapeHtml } from './utils/sanitize';

export default function App() {
  // Core Persistent State
  const [feeds, setFeeds] = useState<Feed[]>(loadFeedsFromStorage);
  const [articles, setArticles] = useState<FeedItem[]>(loadArticlesFromStorage);
  const [tags, setTags] = useState<Tag[]>(loadTagsFromStorage);
  const [folders, setFolders] = useState<string[]>(loadFoldersFromStorage);
  const [preferences, setPreferences] = useState<ReaderPreferences>(() => {
    return loadPreferencesFromStorage();
  });

  useEffect(() => {
    const isDark = preferences.theme === 'slate' || preferences.theme === 'oled';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [preferences.theme]);

  // Navigation & Active Source / Folder State
  const [currentTab, setCurrentTab] = useState<TabType>('stories');
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<FeedItem | null>(null);

  // Filters within a selected source or tag view
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'bookmarked' | 'offline'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [feedViewMode, setFeedViewMode] = useState<'magazine' | 'compact'>('magazine');

  // Blurry transparent header on Newsfeed scroll
  const [isScrolled, setIsScrolled] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const scrollDeltaRef = useRef(0);

  const handleFeedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentScrollY = e.currentTarget.scrollTop;
    const delta = currentScrollY - lastScrollYRef.current;

    // Track scroll depth so header gets blurry and transparent
    setIsScrolled(currentScrollY > 4);

    // Near top: always reveal header
    if (currentScrollY <= 20) {
      if (!isHeaderVisible) setIsHeaderVisible(true);
      lastScrollYRef.current = currentScrollY;
      scrollDeltaRef.current = 0;
      return;
    }

    // Accumulate directional scroll delta to prevent jitter
    if ((delta > 0 && scrollDeltaRef.current < 0) || (delta < 0 && scrollDeltaRef.current > 0)) {
      scrollDeltaRef.current = 0;
    }
    scrollDeltaRef.current += delta;

    // Scrolling down: hide header and let newsfeed fill the screen
    if (scrollDeltaRef.current > 60 && currentScrollY > 140 && isHeaderVisible) {
      setIsHeaderVisible(false);
    }
    // Scrolling up: reveal header
    else if (scrollDeltaRef.current < -20 && !isHeaderVisible) {
      setIsHeaderVisible(true);
    }

    lastScrollYRef.current = currentScrollY;
  };

  // Direct URL Reader State (for loading any Bangladeshi news portal or article URL without RSS)
  const [directUrlInput, setDirectUrlInput] = useState('');
  const [isLoadingDirectUrl, setIsLoadingDirectUrl] = useState(false);

  // Modals & Offline State
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [tagModalArticle, setTagModalArticle] = useState<FeedItem | null>(null);
  const [isFeedModalOpen, setIsFeedModalOpen] = useState(false);
  const [isIosModalOpen, setIsIosModalOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Synchronize state changes to localStorage
  useEffect(() => {
    saveFeedsToStorage(feeds);
  }, [feeds]);

  useEffect(() => {
    saveArticlesToStorage(articles);
  }, [articles]);

  useEffect(() => {
    saveTagsToStorage(tags);
  }, [tags]);

  useEffect(() => {
    saveFoldersToStorage(folders);
  }, [folders]);

  useEffect(() => {
    savePreferencesToStorage(preferences);
  }, [preferences]);

  // Temporary status notification
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (msg: string) => {
    setStatusMessage(msg);
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => {
      setStatusMessage(null);
    }, 3000);
  };

  // Unique IDs even when many feeds are created in the same millisecond (OPML import)
  const idCounterRef = useRef(0);
  const makeFeedId = () => `feed_${Date.now()}_${idCounterRef.current++}`;

  // Run async jobs with a small concurrency limit so refresh-all does not fire every request at once
  const runPool = async <T,>(items: T[], limit: number, job: (item: T) => Promise<void>) => {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) {
        const next = queue.shift() as T;
        await job(next);
      }
    });
    await Promise.all(workers);
  };

  // Sync a single feed (supports XML RSS, Direct HTML Portal Scraping, and standalone iOS IPA fallback)
  const syncFeed = async (feed: Feed): Promise<FeedItem[] | null> => {
    try {
      const data = await fetchFeedWithFallback({
        url: feed.url,
        feedId: feed.id,
        title: feed.title,
        tags: feed.defaultTags || [],
      });
      if (data && Array.isArray(data.items)) {
        const discoveredUrl = data.resolvedFeedUrl;
        setFeeds((prev) =>
          prev.map((f) => {
            if (f.id !== feed.id) return f;
            const looksLikeRawDomain =
              f.title === 'Newspaper Feed' ||
              f.title === 'Newspaper Source' ||
              /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(f.title.trim());
            return {
              ...f,
              url: discoveredUrl || f.url,
              title:
                looksLikeRawDomain && data.feedTitle && data.feedTitle !== 'RSS Feed'
                  ? data.feedTitle
                  : f.title,
            };
          })
        );
        return data.items.map((item) => ({
          ...item,
          feedId: feed.id,
          feedTitle: data.feedTitle || feed.title,
        }));
      }
    } catch (e) {
      console.warn(`Sync failed for ${feed.title}:`, e);
      return null;
    }
    return [];
  };

  // Merge a fresh snapshot from a source without losing local read/bookmark/cache state.
  const mergeFeedItems = (previous: FeedItem[], incomingRaw: FeedItem[]) => {
    // A story counts as cached only when it carries a real body, not just a teaser
    const incoming = incomingRaw.map((item) => ({ ...item, isOfflineCached: hasFullBody(item) }));
    const incomingById = new Map(incoming.map((item) => [item.id, item]));
    const incomingByLink = new Map(incoming.map((item) => [item.link, item]));
    const seen = new Set<string>();

    const refreshed = previous.map((article) => {
      const latest = incomingById.get(article.id) || incomingByLink.get(article.link);
      if (!latest) return article;
      seen.add(latest.id);
      return {
        ...latest,
        isRead: article.isRead,
        isBookmarked: article.isBookmarked,
        // Keep the stored body if the fresh copy only has a teaser
        isOfflineCached: article.isOfflineCached || latest.isOfflineCached,
        contentHtml: hasFullBody(article) && !hasFullBody(latest) ? article.contentHtml : latest.contentHtml,
        contentClean: hasFullBody(article) && !hasFullBody(latest) ? article.contentClean : latest.contentClean,
        cachedAt: article.cachedAt,
        tags: article.tags.length > 0 ? article.tags : latest.tags,
      };
    });

    const additions = incoming.filter((item) => !seen.has(item.id) && !previous.some((a) => a.link === item.link));
    return [...additions, ...refreshed].sort((a, b) => b.timestamp - a.timestamp);
  };

  // Click handler for a specific source: selects only that source and loads its feed
  const handleSelectSource = async (feed: Feed) => {
    triggerHapticSelection();
    setSelectedFeedId(feed.id);
    setSelectedFolder(null);
    setSelectedTagId(null);
    setFilterMode('all');
    setSearchQuery('');
    setCurrentTab('stories');
    setIsHeaderVisible(true);

    if (isOffline) {
      notify(`Offline mode: Showing cached stories for ${feed.title}`);
      return;
    }

    setRefreshFailed(false);
    setIsRefreshing(true);
    try {
      const incomingItems = await syncFeed(feed);
      if (incomingItems === null) {
        setRefreshFailed(true);
        notify(`Could not reach ${feed.title}. Showing cached stories.`);
      } else if (incomingItems.length > 0) {
        setArticles((prev) => {
          return mergeFeedItems(prev, incomingItems);
        });
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Click handler for a specific folder: selects that folder and shows news from all sources in that folder
  const handleSelectFolder = async (folderName: string) => {
    triggerHapticSelection();
    setSelectedFolder(folderName);
    setSelectedFeedId(null);
    setSelectedTagId(null);
    setFilterMode('all');
    setSearchQuery('');
    setCurrentTab('stories');
    setIsHeaderVisible(true);

    const folderFeeds = feeds.filter((f) => (f.category?.trim() || '') === folderName);
    if (isOffline || folderFeeds.length === 0) {
      if (isOffline) notify(`Offline mode: Showing cached stories in ${folderName}`);
      return;
    }

    setRefreshFailed(false);
    setIsRefreshing(true);
    try {
      const incomingItems: FeedItem[] = [];
      let failedCount = 0;
      await runPool(folderFeeds, 4, async (f) => {
        const result = await syncFeed(f);
        if (result === null) failedCount += 1;
        else incomingItems.push(...result);
      });
      if (incomingItems.length > 0) {
        setArticles((prev) => mergeFeedItems(prev, incomingItems));
      }
      if (failedCount === folderFeeds.length) {
        setRefreshFailed(true);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateFolder = (folderName: string) => {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    setFolders((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const handleMoveFeedToFolder = (feedId: string, folderName: string) => {
    const target = folderName.trim();
    if (target) {
      setFolders((prev) => (prev.includes(target) ? prev : [...prev, target]));
    }
    const targetFeed = feeds.find((f) => f.id === feedId);
    setFeeds((prev) =>
      prev.map((f) => (f.id === feedId ? { ...f, category: target } : f))
    );
    notify(
      target
        ? `Moved "${targetFeed?.title || 'Source'}" to ${target}`
        : `Moved "${targetFeed?.title || 'Source'}" out of folder`
    );
  };

  // Refresh active source, active folder, or all sources if triggered from top bar
  const handleRefreshActive = async () => {
    if (isOffline) {
      notify('Offline mode active. Using locally cached articles.');
      return;
    }

    const activeFeed = feeds.find((f) => f.id === selectedFeedId);
    if (activeFeed) {
      await handleSelectSource(activeFeed);
      return;
    }

    if (selectedFolder) {
      await handleSelectFolder(selectedFolder);
      return;
    }

    setRefreshFailed(false);
    setIsRefreshing(true);
    try {
      const incomingItems: FeedItem[] = [];
      let failedCount = 0;
      await runPool(feeds, 4, async (f) => {
        const result = await syncFeed(f);
        if (result === null) failedCount += 1;
        else incomingItems.push(...result);
      });

      if (incomingItems.length > 0) {
        setArticles((prev) => mergeFeedItems(prev, incomingItems));
      }
      // Error feedback only when nothing could be refreshed; a partial refresh still counts as done
      if (failedCount === feeds.length) setRefreshFailed(true);
      if (failedCount > 0) {
        notify(
          failedCount === feeds.length
            ? 'Could not refresh any source. Check your connection.'
            : `${failedCount} of ${feeds.length} sources could not be refreshed`
        );
      }
    } catch {
      setRefreshFailed(true);
      notify('Refresh failed. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Direct URL Loader: Load any article or Bangladeshi news portal URL directly into clean Reader Mode
  const processDirectUrl = async (rawUrl: string) => {
    let targetUrl = rawUrl.trim();
    if (!targetUrl) return;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    setIsLoadingDirectUrl(true);
    try {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        notify('Please enter a valid URL');
        setIsLoadingDirectUrl(false);
        return;
      }

      const pathSegments = parsedUrl.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
      const onlySegment = pathSegments[0] || '';
      const looksLikeArticleSlug =
        /\d/.test(onlySegment) || (onlySegment.match(/-/g) || []).length >= 2 || onlySegment.endsWith('.html');
      const isHomepageOrPortalRoot =
        pathSegments.length === 0 || (pathSegments.length === 1 && !looksLikeArticleSlug);

      // If it's a portal homepage (like https://bdnews24.com or https://samakal.com), load as a Portal Source!
      if (isHomepageOrPortalRoot) {
        const hostName = parsedUrl.hostname.replace(/^www\./, '');
        const existingFeed = feeds.find(
          (f) => f.url.includes(hostName) || (f.siteUrl && f.siteUrl.includes(hostName))
        );

        if (existingFeed) {
          setDirectUrlInput('');
          await handleSelectSource(existingFeed);
          return;
        }

        const newFeed: Feed = {
          id: makeFeedId(),
          title: hostName,
          url: targetUrl,
          siteUrl: targetUrl,
          description: `Direct Portal Reader for ${hostName}`,
          category: 'Direct Portal',
          defaultTags: ['tag_bd'],
          unreadCount: 0,
        };
        setFeeds((prev) => [newFeed, ...prev]);
        setDirectUrlInput('');
        await handleSelectSource(newFeed);
        notify(`Loaded portal feed from ${hostName}`);
        return;
      }

      // Otherwise it's a direct article URL: extract and open immediately in Clean Distraction-Free Reader View!
      const data = await extractArticleWithFallback(targetUrl);

      if (data.success && data.blocks && data.blocks.length > 0) {
        const htmlContent = blocksToHtml(data.blocks);
        const cleanText = data.blocks
          .map((b: any) => b.text || '')
          .filter(Boolean)
          .join(' ');

        const directArticle: FeedItem = {
          id: `direct_${Date.now()}`,
          feedId: selectedFeedId || 'direct_reader',
          feedTitle: data.siteName || parsedUrl.hostname.replace(/^www\./, ''),
          feedUrl: parsedUrl.origin,
          title: data.title || 'Direct Article',
          link: targetUrl,
          pubDate: new Date().toISOString(),
          timestamp: Date.now(),
          author: data.author,
          summary: cleanText.slice(0, 220),
          contentHtml: htmlContent,
          contentClean: cleanText,
          imageUrl: data.leadImage,
          tags: ['tag_bd'],
          isRead: true,
          isBookmarked: false,
          isOfflineCached: true,
          cachedAt: Date.now(),
          readTimeMin: data.readTimeMin || 3,
        };

        setArticles((prev) => [directArticle, ...prev]);
        setDirectUrlInput('');
        setActiveArticle(directArticle);
        notify('Loaded directly in Distraction-Free Reader Mode');
      } else {
        // Fallback: try loading as a portal feed if it wasn't a single article
        const hostName = parsedUrl.hostname.replace(/^www\./, '');
        const newFeed: Feed = {
          id: makeFeedId(),
          title: hostName,
          url: targetUrl,
          siteUrl: targetUrl,
          category: 'Direct Portal',
          defaultTags: ['tag_bd'],
          unreadCount: 0,
        };
        setFeeds((prev) => [newFeed, ...prev]);
        setDirectUrlInput('');
        await handleSelectSource(newFeed);
      }
    } catch {
      notify('Could not load URL. Please check the link.');
    } finally {
      setIsLoadingDirectUrl(false);
    }
  };

  const handleLoadDirectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    await processDirectUrl(directUrlInput);
  };

  // Cache extracted article content back into articles state for offline reading
  const handleCacheExtractedArticle = (
    articleId: string,
    extracted: {
      title?: string;
      author?: string;
      leadImage?: string;
      readTimeMin?: number;
      contentClean?: string;
      contentHtml?: string;
    }
  ) => {
    setArticles((prev) =>
      prev.map((a) =>
        a.id === articleId
          ? {
              ...a,
              title: extracted.title || a.title,
              author: extracted.author || a.author,
              imageUrl: extracted.leadImage || a.imageUrl,
              readTimeMin: extracted.readTimeMin || a.readTimeMin,
              contentClean: extracted.contentClean || a.contentClean,
              contentHtml: extracted.contentHtml || a.contentHtml,
              isOfflineCached: true,
              cachedAt: Date.now(),
            }
          : a
      )
    );
  };

  // Article Actions
  const handleToggleBookmark = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isBookmarked: !a.isBookmarked } : a))
    );
    if (activeArticle && activeArticle.id === id) {
      setActiveArticle((curr) => (curr ? { ...curr, isBookmarked: !curr.isBookmarked } : null));
    }
  };

  const handleToggleRead = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isRead: !a.isRead } : a))
    );
    if (activeArticle && activeArticle.id === id) {
      setActiveArticle((curr) => (curr ? { ...curr, isRead: !curr.isRead } : null));
    }
  };

  const handleMarkSourceAsRead = () => {
    setArticles((prev) =>
      prev.map((a) => {
        if (selectedFeedId) {
          return a.feedId === selectedFeedId ? { ...a, isRead: true } : a;
        }
        if (selectedFolder && selectedFolderFeedIds) {
          return selectedFolderFeedIds.includes(a.feedId) ? { ...a, isRead: true } : a;
        }
        return { ...a, isRead: true };
      })
    );
    notify('Stories marked as read');
  };

  const handleToggleOfflineCache = (article: FeedItem) => {
    const nextState = !article.isOfflineCached;
    setArticles((prev) =>
      prev.map((a) =>
        a.id === article.id
          ? { ...a, isOfflineCached: nextState, cachedAt: nextState ? Date.now() : undefined }
          : a
      )
    );
    if (activeArticle && activeArticle.id === article.id) {
      setActiveArticle((curr) => (curr ? { ...curr, isOfflineCached: nextState } : null));
    }
    notify(nextState ? 'Saved for offline reading' : 'Removed from offline cache');
  };

  const [isCachingAll, setIsCachingAll] = useState(false);

  // Downloads full article text for the newest stories that only have a teaser
  const handleCacheAllForOffline = async () => {
    if (isOffline) {
      notify('Go online to download stories for offline reading');
      return;
    }
    if (isCachingAll) return;

    const pending = articles
      .filter((a) => !hasFullBody(a) && a.link && a.link.startsWith('http'))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 40);

    if (pending.length === 0) {
      notify('Everything is already saved for offline reading');
      return;
    }

    setIsCachingAll(true);
    notify(`Downloading ${pending.length} stories...`);
    let done = 0;
    try {
      await runPool(pending, 4, async (article) => {
        try {
          const data = await extractArticleWithFallback(article.link);
          if (data.success && data.blocks && data.blocks.length > 0) {
            const contentClean = data.blocks
              .map((b) => b.text || '')
              .filter(Boolean)
              .join('\n\n');
            handleCacheExtractedArticle(article.id, {
              title: data.title,
              author: data.author,
              leadImage: data.leadImage,
              readTimeMin: data.readTimeMin,
              contentClean,
              contentHtml: blocksToHtml(data.blocks),
            });
            done += 1;
          }
        } catch {
          // skip stories that cannot be fetched
        }
      });
    } finally {
      setIsCachingAll(false);
    }
    notify(done > 0 ? `Saved ${done} of ${pending.length} stories for offline reading` : 'Could not download stories');
  };

  // Tag Management
  const handleSaveArticleTags = (articleId: string, tagIds: string[]) => {
    setArticles((prev) =>
      prev.map((a) => (a.id === articleId ? { ...a, tags: tagIds } : a))
    );
    if (activeArticle && activeArticle.id === articleId) {
      setActiveArticle((curr) => (curr ? { ...curr, tags: tagIds } : null));
    }
  };

  const handleCreateTag = (name: string, color: string) => {
    const newTag: Tag = {
      id: `tag_${Date.now()}`,
      name,
      color,
    };
    setTags((prev) => [...prev, newTag]);
    notify(`Created tag "${name}"`);
  };

  const handleDeleteTag = (tagId: string) => {
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    setArticles((prev) =>
      prev.map((a) => ({ ...a, tags: a.tags.filter((id) => id !== tagId) }))
    );
    if (selectedTagId === tagId) {
      setSelectedTagId(null);
    }
  };

  // Feed Management
  const handleAddFeed = async (newFeedData: Omit<Feed, 'id'>) => {
    const newFeed: Feed = {
      ...newFeedData,
      id: makeFeedId(),
    };
    setFeeds((prev) => [newFeed, ...prev]);
    notify(`Added ${newFeed.title}`);

    // Select and sync the newly added source immediately
    await handleSelectSource(newFeed);
  };

  const handleDeleteFeed = (feedId: string) => {
    setFeeds((prev) => prev.filter((f) => f.id !== feedId));
    if (selectedFeedId === feedId) {
      setSelectedFeedId(null);
    }
    notify('Source removed');
  };

  // OPML Export & Import
  const handleExportOPML = () => {
    const opmlText = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Chinta Subscriptions</title>
  </head>
  <body>
    ${feeds
      .map(
        (f) =>
          `<outline text="${escapeHtml(f.title)}" title="${escapeHtml(f.title)}" type="rss" xmlUrl="${escapeHtml(f.url)}" htmlUrl="${escapeHtml(f.siteUrl || '')}" category="${escapeHtml(f.category)}"/>`
      )
      .join('\n    ')}
  </body>
</opml>`;

    const blob = new Blob([opmlText], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chinta_subscriptions.opml';
    a.click();
    URL.revokeObjectURL(url);
    notify('OPML subscriptions exported');
  };

  const handleImportOPML = (xmlText: string) => {
    try {
      const readAttr = (tag: string, name: string): string => {
        const m = tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, 'i'));
        if (!m) return '';
        return m[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&');
      };

      const outlineTags = [...xmlText.matchAll(/<outline\b[^>]*>/gi)].map((m) => m[0]);
      const existingUrls = new Set(feeds.map((f) => f.url));
      const imported: Feed[] = [];

      for (const tag of outlineTags) {
        const url = readAttr(tag, 'xmlUrl').trim();
        if (!url || existingUrls.has(url)) continue;
        existingUrls.add(url);
        imported.push({
          id: makeFeedId(),
          title: readAttr(tag, 'title') || readAttr(tag, 'text') || 'Imported Feed',
          url,
          siteUrl: readAttr(tag, 'htmlUrl') || undefined,
          category: readAttr(tag, 'category') || 'Imported',
          defaultTags: ['tag_bd'],
          unreadCount: 0,
        });
      }

      if (imported.length > 0) {
        setFeeds((prev) => [...imported, ...prev]);
      }
      notify(`Imported ${imported.length} feeds from OPML`);
    } catch {
      notify('Failed to parse OPML file');
    }
  };

  const selectedFeed = feeds.find((f) => f.id === selectedFeedId) || null;

  const selectedFolderFeedIds = useMemo(() => {
    if (!selectedFolder) return null;
    return feeds
      .filter((f) => (f.category?.trim() || '') === selectedFolder)
      .map((f) => f.id);
  }, [feeds, selectedFolder]);

  // Filtered Articles calculation:
  // When in Stories tab and a source or folder is clicked, only show that specific source's or folder's feed
  const displayedArticles = filterArticles(articles, {
    selectedFeedId: currentTab === 'stories' && !selectedTagId ? selectedFeedId : null,
    selectedFeedIds:
      currentTab === 'stories' && !selectedTagId && !selectedFeedId ? selectedFolderFeedIds : null,
    selectedTagId,
    searchQuery,
    filterMode: currentTab === 'saved' ? 'bookmarked' : filterMode,
  });

  const activeSourceUnreadCount = displayedArticles.filter((a) => !a.isRead).length;
  const totalUnreadCount = articles.filter((a) => !a.isRead).length;

  // Next article in reader view
  const handleNextArticle = () => {
    if (!activeArticle) return;
    const currentIndex = displayedArticles.findIndex((a) => a.id === activeArticle.id);
    if (currentIndex >= 0 && currentIndex < displayedArticles.length - 1) {
      setActiveArticle(displayedArticles[currentIndex + 1]);
    } else if (displayedArticles.length > 0) {
      setActiveArticle(displayedArticles[0]);
    }
  };

  return (
    <IPhoneFrame
      isOffline={isOffline}
      onToggleOffline={() => setIsOffline(!isOffline)}
      onRefreshAll={handleRefreshActive}
      isRefreshing={isRefreshing}
      onOpenIosModal={() => setIsIosModalOpen(true)}
    >
      {/* Toast Notification — spring in from top */}
      {statusMessage && (
        <div
          className="absolute top-[max(env(safe-area-inset-top,12px),12px)] left-1/2 -translate-x-1/2 px-4 py-2.5 bg-stone-900/96 dark:bg-stone-100/96 text-white dark:text-stone-900 text-xs font-semibold rounded-full shadow-xl backdrop-blur-xl z-50 toast-enter whitespace-nowrap"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)' }}
        >
          {statusMessage}
        </div>
      )}

      {/* Main Screen Container */}
      <div className="flex-1 relative flex flex-col h-full overflow-hidden bg-stone-50 dark:bg-[#090A0C] text-stone-900 dark:text-stone-100">
        {/* TAB 1: Latest feed with optional source or folder filtering */}
        {currentTab === 'stories' && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* NEWSFEED (all sources, or the one source/folder/tag selected) */}
            <div className="flex-1 relative h-full overflow-hidden">
              {/* Progressive Atmospheric Top Blur Mask (content scrolls directly underneath and blurs softly) */}
              <div
                aria-hidden="true"
                className="top-progressive-blur absolute top-0 left-0 right-0 h-28 z-20 pointer-events-none"
              />

              {/* Floating Top 3D Liquid Glass Orbs & Capsule (matches reference photo) */}
              <header
                className={`absolute top-0 left-0 right-0 z-30 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2 pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isHeaderVisible
                    ? 'translate-y-0 opacity-100'
                    : '-translate-y-20 opacity-0'
                }`}
              >
                <div className="flex items-center justify-between gap-2 pt-1">
                  {/* Top-Left: Floating 3D Liquid Glass Ribbon Orb + Active Folder/Source Pill */}
                  <div className="flex items-center gap-2 min-w-0 pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setSelectedFeedId(null);
                        setSelectedFolder(null);
                        setSelectedTagId(null);
                        setFilterMode('all');
                      }}
                      title="All Stories"
                      aria-label="All Stories"
                      className="liquid-glass-pill w-12 h-12 rounded-full flex items-center justify-center shrink-0 active:scale-92 transition-transform"
                    >
                      {/* Iconic Orange Ribbon Bookmark Icon */}
                      <svg
                        viewBox="0 0 24 24"
                        className="w-5 h-5 text-[#FF6719] fill-current"
                        aria-hidden="true"
                      >
                        <path d="M4 3h16v2.5H4V3zm0 4.5h16V10H4V7.5zm0 4.5h16v9l-8-3.8L4 21v-9z" />
                      </svg>
                    </button>

                    {(selectedFeed || selectedFolder || filterMode !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          triggerHapticSelection();
                          setSelectedFeedId(null);
                          setSelectedFolder(null);
                          setSelectedTagId(null);
                          setFilterMode('all');
                        }}
                        title="Clear filter and show all stories"
                        className="liquid-glass-pill h-10 px-3.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-stone-900 dark:text-white truncate max-w-[180px] active:scale-95 transition-transform"
                      >
                        {selectedFolder && <Folder className="w-3.5 h-3.5 text-[#FF6719] shrink-0" />}
                        <span className="truncate">
                          {selectedFeed?.title ||
                            selectedFolder ||
                            (filterMode === 'unread'
                              ? `Unread (${activeSourceUnreadCount})`
                              : filterMode === 'bookmarked'
                                ? 'Saved'
                                : 'Offline')}
                        </span>
                        <X className="w-3.5 h-3.5 opacity-70 shrink-0" />
                      </button>
                    )}
                  </div>

                  {/* Top-Right: Floating 3D Liquid Glass Capsule Pill (Search + View/Refresh + Layered Avatar Orb) */}
                  <div className="liquid-glass-pill h-12 pl-3.5 pr-2 rounded-full flex items-center gap-2.5 shrink-0 pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setIsSearchOpen(!isSearchOpen);
                      }}
                      aria-label="Search stories"
                      title="Search stories"
                      className={`p-1.5 rounded-full transition-transform active:scale-90 ${
                        isSearchOpen
                          ? 'text-[#FF6719]'
                          : 'text-stone-900 dark:text-white opacity-90 hover:opacity-100'
                      }`}
                    >
                      <Search className="w-5 h-5 stroke-[2.2]" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setFeedViewMode((m) => (m === 'magazine' ? 'compact' : 'magazine'));
                      }}
                      aria-label="Toggle view mode"
                      title={feedViewMode === 'magazine' ? 'Switch to Compact List' : 'Switch to Magazine View'}
                      className="p-1.5 rounded-full text-stone-900 dark:text-white opacity-85 hover:opacity-100 transition-transform active:scale-90"
                    >
                      {feedViewMode === 'magazine' ? (
                        <Rows3 className="w-4 h-4 stroke-[2]" />
                      ) : (
                        <LayoutList className="w-4 h-4 stroke-[2]" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleRefreshActive}
                      disabled={isRefreshing || isOffline}
                      aria-label="Refresh feed"
                      title="Refresh stories"
                      className="p-1.5 rounded-full text-stone-900 dark:text-white opacity-85 hover:opacity-100 transition-transform active:scale-90 disabled:opacity-40"
                    >
                      <RefreshCw
                        className={`w-4 h-4 stroke-[2] ${
                          isRefreshing ? 'animate-spin text-[#FF6719]' : ''
                        }`}
                      />
                    </button>

                    {/* Layered Circular Filter Orb (matches the orange/teal layered circle inside the top-right pill in the reference photo) */}
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        const order: Array<'all' | 'unread' | 'bookmarked' | 'offline'> = [
                          'all',
                          'unread',
                          'bookmarked',
                          'offline',
                        ];
                        const next = order[(order.indexOf(filterMode) + 1) % order.length];
                        setFilterMode(next);
                        notify(
                          next === 'all'
                            ? 'Showing All Stories'
                            : next === 'unread'
                              ? `Showing Unread Stories (${activeSourceUnreadCount})`
                              : next === 'bookmarked'
                                ? 'Showing Saved Stories'
                                : 'Showing Offline Cached Stories'
                        );
                      }}
                      title="Tap to cycle filter: All · Unread · Saved · Offline"
                      aria-label="Cycle story filter"
                      className="relative w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-transform ml-0.5"
                    >
                      <span
                        className="absolute inset-0 rounded-full translate-x-[2px] translate-y-[1px]"
                        style={{
                          background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                          border: '1px solid rgba(255,255,255,0.45)',
                        }}
                      />
                      <span
                        className="relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                        style={{
                          background: 'linear-gradient(145deg, #FF982E 0%, #FF6719 100%)',
                          border: '1.5px solid rgba(255,255,255,0.85)',
                        }}
                      >
                        {filterMode === 'all' ? '' : filterMode[0].toUpperCase()}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Floating Liquid Glass Search Bar & Quick Filter Pills */}
                {isSearchOpen && (
                  <div className="mt-2.5 pointer-events-auto animate-in fade-in duration-150 space-y-2">
                    <div className="liquid-glass-pill rounded-full px-3.5 py-2 flex items-center gap-2">
                      <Search className="w-4 h-4 text-stone-500 dark:text-stone-300 shrink-0" />
                      <input
                        type="search"
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`Search in ${selectedFeed?.title || selectedFolder || 'stories'}...`}
                        className="w-full bg-transparent text-xs text-stone-900 dark:text-white placeholder-stone-500 dark:placeholder-stone-300 focus:outline-none"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="text-stone-400 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleMarkSourceAsRead}
                        title="Mark stories as read"
                        className="p-1 text-stone-500 dark:text-stone-300 hover:text-[#FF6719]"
                      >
                        <CheckCheck className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </header>

              {/* Articles Feed with Pull to Refresh — scrolls directly under top & bottom Liquid Glass */}
              <PullToRefresh
                className="h-full pt-[calc(max(env(safe-area-inset-top,0px),0.75rem)+3.75rem)] pb-28"
                onScroll={handleFeedScroll}
                onRefresh={handleRefreshActive}
                isRefreshing={isRefreshing}
                refreshFailed={refreshFailed}
                disabled={isOffline}
              >
                <div className="divide-y divide-stone-200/50 dark:divide-white/[0.08]">
                  {displayedArticles.map((article) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      viewMode={feedViewMode}
                      onSelect={(art) => setActiveArticle(art)}
                      onToggleBookmark={handleToggleBookmark}
                      onToggleRead={handleToggleRead}
                      onOpenTagManager={(art, e) => {
                        e.stopPropagation();
                        setTagModalArticle(art);
                        setIsTagModalOpen(true);
                      }}
                    />
                  ))}
                </div>

                {displayedArticles.length === 0 && (
                  <div className="py-16 px-6 text-center text-stone-500">
                    <p className="font-serif text-base text-stone-800 dark:text-stone-200 mb-1">
                      No stories found for this filter
                    </p>
                    <p className="text-xs mb-4">
                      Try switching filters or pull down to check for new articles.
                    </p>
                    <button
                      onClick={() => {
                        setFilterMode('all');
                        setSearchQuery('');
                        setSelectedTagId(null);
                        setSelectedFeedId(null);
                        setSelectedFolder(null);
                      }}
                      className="px-3.5 py-1.5 rounded-full text-xs font-medium liquid-glass-pill text-stone-800 dark:text-stone-200"
                    >
                      Show All Stories
                    </button>
                  </div>
                )}
              </PullToRefresh>
            </div>
          </div>
        )}

          {/* TAB 2: TAGS & CATEGORIES */}
          {currentTab === 'tags' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-3 liquid-glass-header border-b border-stone-200/60 dark:border-white/[0.08] flex items-center justify-between">
                <div>
                  <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                    Categorization
                  </h1>
                  <span className="text-xs text-stone-500">
                    Customizable tag-based information management
                  </span>
                </div>

                <button
                  onClick={() => {
                    setTagModalArticle(null);
                    setIsTagModalOpen(true);
                  }}
                  className="px-3.5 py-1.5 liquid-glass-pill rounded-full text-xs font-semibold text-stone-900 dark:text-white flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-[#FF6719]" />
                  <span>New Tag</span>
                </button>
              </header>

              <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-3 no-scrollbar">
                {tags.map((tag) => {
                  const tagArticles = articles.filter((a) => a.tags.includes(tag.id));
                  const unreadTagCount = tagArticles.filter((a) => !a.isRead).length;

                  return (
                    <div
                      key={tag.id}
                      onClick={() => {
                        setSelectedFeedId(null);
                        setSelectedFolder(null);
                        setSelectedTagId(tag.id);
                        setCurrentTab('stories');
                      }}
                      className="p-3.5 rounded-2xl liquid-glass cursor-pointer transition-all active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3.5 h-3.5 rounded-full shrink-0"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100">
                            {tag.name}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">
                          {tagArticles.length} stories
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                        <span>
                          {unreadTagCount > 0 ? `${unreadTagCount} unread stories` : 'All caught up'}
                        </span>
                        <span className="text-[#FF6719] font-medium">
                          Browse Tag →
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: SAVED & OFFLINE HUB */}
          {currentTab === 'saved' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-3 liquid-glass-header border-b border-stone-200/60 dark:border-white/[0.08]">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                      Offline & Saved
                    </h1>
                    <span className="text-xs text-stone-500">
                      Distraction-free reading anywhere, anytime
                    </span>
                  </div>

                  <button
                    onClick={handleCacheAllForOffline}
                    disabled={isCachingAll}
                    className="px-3.5 py-1.5 liquid-glass-pill disabled:opacity-50 text-stone-900 dark:text-white rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Download full text of the newest stories for offline use"
                  >
                    <ArrowDownCircle className={`w-3.5 h-3.5 text-emerald-500 ${isCachingAll ? 'animate-pulse' : ''}`} />
                    <span>{isCachingAll ? 'Saving...' : 'Save All'}</span>
                  </button>
                </div>

                {/* Offline Status Banner */}
                <div className="p-3 liquid-glass rounded-2xl text-xs text-stone-800 dark:text-stone-200 flex items-center justify-between">
                  <div>
                    <span className="font-semibold block">Offline Reading Ready</span>
                    <span className="opacity-75 text-[11px]">
                      {articles.filter((a) => a.isOfflineCached).length} stories cached on device
                    </span>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-emerald-600 dark:text-emerald-400 font-bold">
                    Zero-Data Mode
                  </span>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto pb-28 no-scrollbar">
                {displayedArticles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    viewMode={feedViewMode}
                    onSelect={(art) => setActiveArticle(art)}
                    onToggleBookmark={handleToggleBookmark}
                    onToggleRead={handleToggleRead}
                    onOpenTagManager={(art, e) => {
                      e.stopPropagation();
                      setTagModalArticle(art);
                      setIsTagModalOpen(true);
                    }}
                  />
                ))}

                {displayedArticles.length === 0 && (
                  <div className="py-16 px-6 text-center text-stone-500">
                    <p className="font-serif text-base text-stone-800 dark:text-stone-200 mb-1">
                      No saved articles yet
                    </p>
                    <p className="text-xs">
                      Tap the bookmark icon on any story to save it for offline reading.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: NEWSPAPER SOURCES & CHANNELS */}
          {currentTab === 'feeds' && (
            <SourcesSection
              feeds={feeds}
              articles={articles}
              folders={folders}
              selectedFeedId={selectedFeedId}
              selectedFolder={selectedFolder}
              isRefreshing={isRefreshing}
              isOffline={isOffline}
              onSelectSource={(feed) => handleSelectSource(feed)}
              onSelectFolder={(folderName) => handleSelectFolder(folderName)}
              onCreateFolder={(folderName) => handleCreateFolder(folderName)}
              onMoveFeedToFolder={handleMoveFeedToFolder}
              onRefreshFeed={async (feed) => {
                await handleSelectSource(feed);
              }}
              onRefreshAll={handleRefreshActive}
              onDeleteFeed={handleDeleteFeed}
              onAddFeed={handleAddFeed}
              onOpenFeedModal={() => setIsFeedModalOpen(true)}
              onLoadDirectUrl={(url) => processDirectUrl(url)}
              isLoadingDirectUrl={isLoadingDirectUrl}
              onOpenIosModal={() => setIsIosModalOpen(true)}
            />
          )}

          {/* Bottom Floating iOS 26 Liquid Glass Capsule Dock */}
          <TabBar
            currentTab={currentTab}
            isVisible={isHeaderVisible || currentTab !== 'stories'}
            onQuickAction={() => setIsFeedModalOpen(true)}
            onSelectTab={(tab) => {
              setCurrentTab(tab);
              setIsHeaderVisible(true);
              if (tab === 'stories') {
                setSelectedFeedId(null);
                setSelectedFolder(null);
                setSelectedTagId(null);
                setFilterMode('all');
              } else {
                setSelectedTagId(null);
                setSearchQuery('');
              }
            }}
            unreadCount={totalUnreadCount}
            isDark={preferences.theme === 'slate' || preferences.theme === 'oled'}
          />

          {/* Reader View — iOS push navigation slide-in */}
          {activeArticle && (
            <div className="absolute inset-0 z-50 overflow-hidden" style={{ background: 'inherit' }}>
              <ReaderView
                article={activeArticle}
                tags={tags}
                preferences={preferences}
                onUpdatePreferences={setPreferences}
                onBack={() => setActiveArticle(null)}
                onToggleBookmark={(id) => handleToggleBookmark(id)}
                onToggleRead={(id) => handleToggleRead(id)}
                onOpenTagManager={(art) => {
                  setTagModalArticle(art);
                  setIsTagModalOpen(true);
                }}
                onToggleOfflineCache={handleToggleOfflineCache}
                onNextArticle={handleNextArticle}
                onCacheExtractedArticle={handleCacheExtractedArticle}
              />
            </div>
          )}
        </div>

      {/* Modals */}
      <TagManagerModal
        isOpen={isTagModalOpen}
        onClose={() => {
          setIsTagModalOpen(false);
          setTagModalArticle(null);
        }}
        tags={tags}
        articles={articles}
        selectedArticle={tagModalArticle}
        onSaveArticleTags={handleSaveArticleTags}
        onCreateTag={handleCreateTag}
        onDeleteTag={handleDeleteTag}
      />

      <FeedManagerModal
        isOpen={isFeedModalOpen}
        onClose={() => setIsFeedModalOpen(false)}
        feeds={feeds}
        tags={tags}
        folders={folders}
        onCreateFolder={handleCreateFolder}
        onMoveFeedToFolder={handleMoveFeedToFolder}
        onAddFeed={handleAddFeed}
        onDeleteFeed={handleDeleteFeed}
        onImportOPML={handleImportOPML}
        onExportOPML={handleExportOPML}
      />

      <IosBuildModal
        isOpen={isIosModalOpen}
        onClose={() => setIsIosModalOpen(false)}
      />
    </IPhoneFrame>
  );
}
