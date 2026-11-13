import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  CheckCheck,
  ArrowDownCircle,
  ArrowUp,
  LayoutList,
  Rows3,
  Folder,
  X,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Rss,
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
import { DailyBriefingCard } from './components/DailyBriefingCard';
import { QuickPeekModal } from './components/QuickPeekModal';
import { ReadingHabitSheet } from './components/ReadingHabitSheet';
import { PerspectiveModal } from './components/PerspectiveModal';
import { QuoteShareModal } from './components/QuoteShareModal';
import { triggerHapticSelection, triggerHapticComplete } from './utils/haptics';
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
  loadReadingHabitFromStorage,
  saveReadingHabitToStorage,
  loadReadingProgressFromStorage,
  saveReadingProgressToStorage,
  loadReadArticleKeysFromStorage,
  saveReadArticleKeysToStorage,
  loadReadingSpeedProfileFromStorage,
  saveReadingSpeedProfileToStorage,
  hasFullBody,
  hydrateArticlesFromIndexedDb,
} from './utils/storage';
import { filterArticles, UNDATED_FALLBACK_EPOCH } from './utils/feedParser';
import {
  clusterStoriesByTopic,
  buildDailyBriefing,
  normalizeReadingHabitState,
  recordArticleReadInHabit,
  computeSpotifyReadingStats,
  findNewIncomingArticles,
  getArticleReadSignatures,
  deduplicateFeedItems,
  rankAndInterleaveFeedItems,
  filterOutAlreadyReadIncoming,
  clearReadArticlesForRefresh,
  reshuffleUnreadFeedItems,
  toDateKey,
  type ReadingHabitState,
  type ReadingProgressItem,
} from './utils/feedIntelligence';
import {
  createDefaultReadingSpeedProfile,
  normalizeReadingSpeedProfile,
  recordCompletedReadingSession,
  estimateArticleReadTime,
  type ReadingSpeedProfile,
} from './utils/readingSpeed';
import {
  fetchFeedWithFallback,
  extractArticleWithFallback,
} from './utils/apiClient';
import { blocksToHtml, escapeHtml, isJavaScriptWarningText } from './utils/sanitize';
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

  // Recover cached/saved articles from IndexedDB if WKWebView evicted localStorage
  useEffect(() => {
    let cancelled = false;
    hydrateArticlesFromIndexedDb().then((idbItems) => {
      if (cancelled || !idbItems || idbItems.length === 0) return;
      const sanitizedIdbItems = idbItems
        .filter((a) => {
          if (!a) return false;
          const alreadyRead = Boolean(
            a.isRead || (readKeysRef.current && filterOutAlreadyReadIncoming([a], readKeysRef.current).length === 0)
          );
          if (alreadyRead && !a.isBookmarked) return false;
          return true;
        })
        .map((a) => {
          const alreadyRead = Boolean(
            a.isRead || (readKeysRef.current && filterOutAlreadyReadIncoming([a], readKeysRef.current).length === 0)
          );
          return alreadyRead ? { ...a, isRead: true, hiddenFromFeed: true } : a;
        });
      if (sanitizedIdbItems.length > 0) {
        setArticles((prev) => mergeFeedItems(prev, sanitizedIdbItems, true));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  const [visibleCount, setVisibleCount] = useState(25);

  // Reset visible window when filters change
  useEffect(() => {
    setVisibleCount(25);
  }, [selectedFeedId, selectedFolder, selectedTagId, filterMode, searchQuery, currentTab]);

  // Blurry transparent header on Newsfeed scroll + infinite scroll window expansion
  const [isScrolled, setIsScrolled] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isFeedActivelyScrolling, setIsFeedActivelyScrolling] = useState(false);
  const lastScrollYRef = useRef(0);
  const scrollDeltaRef = useRef(0);
  const feedScrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedScrollIdleTimerRef.current) clearTimeout(feedScrollIdleTimerRef.current);
    };
  }, []);

  const handleFeedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop: currentScrollY, scrollHeight, clientHeight } = e.currentTarget;
    const delta = currentScrollY - lastScrollYRef.current;

    // Expand rendered article window smoothly as user scrolls down
    if (scrollHeight - currentScrollY - clientHeight < 800) {
      setVisibleCount((prev) => (prev < articles.length ? Math.min(prev + 25, articles.length) : prev));
    }

    // Track scroll depth so header gets blurry and transparent
    setIsScrolled(currentScrollY > 4);

    // Hide floating "Continue Reading" popup whenever user is actively scrolling
    if (Math.abs(delta) > 1 && currentScrollY > 4) {
      setIsFeedActivelyScrolling(true);
      if (feedScrollIdleTimerRef.current) clearTimeout(feedScrollIdleTimerRef.current);
      feedScrollIdleTimerRef.current = setTimeout(() => {
        setIsFeedActivelyScrolling(false);
      }, 700);
    }

    // Near top: always reveal header & flush any buffered background stories cleanly to top
    if (currentScrollY <= 20) {
      if (feedScrollIdleTimerRef.current) clearTimeout(feedScrollIdleTimerRef.current);
      setIsFeedActivelyScrolling(false);
      if (!isHeaderVisible) setIsHeaderVisible(true);
      if (pendingNewArticlesRef.current.length > 0) {
        const toMerge = pendingNewArticlesRef.current;
        pendingNewArticlesRef.current = [];
        setPendingNewArticles([]);
        setShowNewStoriesPill(false);
        const batchTs = Date.now();
        setArticles((prev) => mergeFeedItems(prev, toMerge, true, batchTs));
      }
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

  // Modals, Habit, Quick Peek & Offline State
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [tagModalArticle, setTagModalArticle] = useState<FeedItem | null>(null);
  const [isFeedModalOpen, setIsFeedModalOpen] = useState(false);
  const [isIosModalOpen, setIsIosModalOpen] = useState(false);
  const [isHabitSheetOpen, setIsHabitSheetOpen] = useState(false);
  const [quickPeekArticle, setQuickPeekArticle] = useState<FeedItem | null>(null);
  const [perspectiveArticle, setPerspectiveArticle] = useState<FeedItem | null>(null);
  const [shareCardArticle, setShareCardArticle] = useState<FeedItem | null>(null);
  const [isScanningPerspectiveSources, setIsScanningPerspectiveSources] = useState(false);
  const [isOpeningFullArticle, setIsOpeningFullArticle] = useState(false);
  const [loadingArticleId, setLoadingArticleId] = useState<string | null>(null);
  const [pendingNewArticles, setPendingNewArticles] = useState<FeedItem[]>([]);
  const [showNewStoriesPill, setShowNewStoriesPill] = useState(false);
  const [readerInitialScrollTop, setReaderInitialScrollTop] = useState(0);

  const [readingHabit, setReadingHabit] = useState<ReadingHabitState>(() => {
    const initial: ReadingHabitState = {
      dailyGoal: 3,
      todayDate: toDateKey(),
      todayReadIds: [],
      todayMinutes: 0,
      streakDays: 1,
      lastCompletedDate: null,
    };
    return normalizeReadingHabitState(loadReadingHabitFromStorage(initial));
  });

  const [readingSpeedProfile, setReadingSpeedProfile] = useState<ReadingSpeedProfile>(() =>
    normalizeReadingSpeedProfile(
      loadReadingSpeedProfileFromStorage(createDefaultReadingSpeedProfile())
    )
  );

  // Persistent set of article IDs, canonical links, & normalized headline keys the user has already read
  const readKeysRef = useRef<Set<string> | null>(null);
  if (readKeysRef.current === null) {
    const initSet = new Set<string>(loadReadArticleKeysFromStorage());
    for (const id of readingHabit.totalReadIds || []) initSet.add(id);
    for (const h of readingHabit.readHistory || []) initSet.add(h.id);
    for (const a of articles) {
      if (a.isRead) {
        for (const sig of getArticleReadSignatures(a)) {
          initSet.add(sig);
        }
      }
    }
    readKeysRef.current = initSet;
  }

  const persistReadKeys = () => {
    if (!readKeysRef.current) return;
    saveReadArticleKeysToStorage(Array.from(readKeysRef.current));
  };

  const recordReadKeys = (items: Array<Pick<FeedItem, 'id' | 'link' | 'title'>>) => {
    if (!readKeysRef.current) readKeysRef.current = new Set();
    let changed = false;
    for (const item of items) {
      for (const sig of getArticleReadSignatures(item)) {
        if (!readKeysRef.current.has(sig)) {
          readKeysRef.current.add(sig);
          changed = true;
        }
      }
    }
    if (changed) persistReadKeys();
  };

  const removeReadKeys = (item: Pick<FeedItem, 'id' | 'link' | 'title'>) => {
    if (!readKeysRef.current) return;
    let changed = false;
    for (const sig of getArticleReadSignatures(item)) {
      if (readKeysRef.current.delete(sig)) {
        changed = true;
      }
    }
    if (changed) persistReadKeys();
  };

  const [readingProgress, setReadingProgress] = useState<ReadingProgressItem | null>(() =>
    loadReadingProgressFromStorage<ReadingProgressItem>()
  );

  const [isOffline, setIsOffline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Live refs for background polling without stale closures
  const feedsRef = useRef(feeds);
  feedsRef.current = feeds;
  const articlesRef = useRef(articles);
  articlesRef.current = articles;
  const activeArticleRef = useRef(activeArticle);
  activeArticleRef.current = activeArticle;
  const isRefreshingRef = useRef(isRefreshing);
  isRefreshingRef.current = isRefreshing;
  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;
  const pendingNewArticlesRef = useRef(pendingNewArticles);
  pendingNewArticlesRef.current = pendingNewArticles;
  const readingSpeedProfileRef = useRef(readingSpeedProfile);
  readingSpeedProfileRef.current = readingSpeedProfile;

  // Persist "New Stories Available" popup until tapped by user or scrolled to top
  const revealNewStoriesPill = () => {
    setShowNewStoriesPill(true);
  };

  // Synchronize state changes to localStorage (debounced to keep iOS UI thread 100% fluid)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveFeedsToStorage(feeds);
    }, 400);
    return () => clearTimeout(timer);
  }, [feeds]);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveArticlesToStorage(articles);
    }, 600);
    return () => clearTimeout(timer);
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

  useEffect(() => {
    saveReadingHabitToStorage(readingHabit);
  }, [readingHabit]);

  useEffect(() => {
    saveReadingProgressToStorage(readingProgress);
  }, [readingProgress]);

  useEffect(() => {
    saveReadingSpeedProfileToStorage(readingSpeedProfile);
  }, [readingSpeedProfile]);



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
  const performFullCloudSync = async () => {};

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

  // Sync a single feed (>=50 items, server-side read exclusion)
  const syncFeed = async (feed: Feed): Promise<FeedItem[] | null> => {
    try {
      const excludeKeys = readKeysRef.current
        ? Array.from(readKeysRef.current).slice(-1500)
        : [];
      const data = await fetchFeedWithFallback({
        url: feed.url,
        feedId: feed.id,
        title: feed.title,
        tags: feed.defaultTags || [],
        minItems: 50,
        excludeKeys,
      });
      if (data && Array.isArray(data.items)) {
        const discoveredUrl = data.resolvedFeedUrl || feed.url;
        setFeeds((prev) =>
          prev.map((f) => {
            if (f.id !== feed.id) return f;
            const looksLikeRawDomain =
              f.title === 'Newspaper Feed' ||
              f.title === 'Newspaper Source' ||
              /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(f.title.trim());
            return {
              ...f,
              url: discoveredUrl,
              siteUrl: f.siteUrl || feed.url,
              title:
                looksLikeRawDomain && data.feedTitle && data.feedTitle !== 'RSS Feed'
                  ? data.feedTitle
                  : f.title,
            };
          })
        );
        return deduplicateFeedItems(
          data.items.map((item) => ({
            ...item,
            feedId: feed.id,
            feedTitle: data.feedTitle || feed.title,
          }))
        );
      }
    } catch (e) {
      console.warn(`Sync failed for ${feed.title}:`, e);
      return null;
    }
    return [];
  };

  // Merge a fresh snapshot from a source without losing local read/bookmark/cache state.
  // Stamps newly discovered/refreshed stories with refreshBatchTs so FB/IG-style fresh items surface at top.
  const mergeFeedItems = (
    previous: FeedItem[],
    incomingRaw: FeedItem[],
    excludeAlreadyRead = false,
    refreshBatchTs?: number
  ) => {
    const filteredRaw =
      excludeAlreadyRead && readKeysRef.current
        ? filterOutAlreadyReadIncoming(incomingRaw, readKeysRef.current)
        : incomingRaw;

    const dedupIncoming = deduplicateFeedItems(filteredRaw);
    const incoming = dedupIncoming.map((item) => ({
      ...item,
      isOfflineCached: hasFullBody(item),
      fetchedBatchTs: refreshBatchTs ?? item.fetchedBatchTs,
    }));

    const existingSigs = new Set<string>();
    for (const prevItem of previous) {
      for (const sig of getArticleReadSignatures(prevItem)) {
        existingSigs.add(sig);
      }
    }

    const incomingById = new Map<string, FeedItem>();
    const incomingBySig = new Map<string, FeedItem>();
    for (const inc of incoming) {
      incomingById.set(inc.id, inc);
      for (const sig of getArticleReadSignatures(inc)) {
        if (!incomingBySig.has(sig)) incomingBySig.set(sig, inc);
      }
    }

    const matchedIncomingIds = new Set<string>();

    const refreshed = previous.map((article) => {
      let latest = incomingById.get(article.id);
      if (!latest) {
        for (const sig of getArticleReadSignatures(article)) {
          const hit = incomingBySig.get(sig);
          if (hit) {
            latest = hit;
            break;
          }
        }
      }
      if (!latest) return article;
      matchedIncomingIds.add(latest.id);
      const keepExistingDate =
        latest.timestamp <= UNDATED_FALLBACK_EPOCH && article.timestamp > UNDATED_FALLBACK_EPOCH;
      return {
        ...latest,
        id: article.id,
        timestamp: keepExistingDate ? article.timestamp : latest.timestamp,
        pubDate: keepExistingDate ? article.pubDate : latest.pubDate,
        isRead: article.isRead,
        isBookmarked: article.isBookmarked,
        hiddenFromFeed: article.hiddenFromFeed,
        isOfflineCached: article.isOfflineCached || latest.isOfflineCached,
        contentHtml: hasFullBody(article) && !hasFullBody(latest) ? article.contentHtml : latest.contentHtml,
        contentClean: hasFullBody(article) && !hasFullBody(latest) ? article.contentClean : latest.contentClean,
        cachedAt: article.cachedAt,
        fetchedBatchTs: article.fetchedBatchTs ?? latest.fetchedBatchTs,
        tags: article.tags.length > 0 ? article.tags : latest.tags,
      };
    });

    const additions = incoming.filter((item) => {
      if (matchedIncomingIds.has(item.id)) return false;
      for (const sig of getArticleReadSignatures(item)) {
        if (existingSigs.has(sig)) return false;
      }
      if (excludeAlreadyRead && readKeysRef.current) {
        for (const sig of getArticleReadSignatures(item)) {
          if (readKeysRef.current.has(sig)) return false;
        }
      }
      return true;
    });

    return rankAndInterleaveFeedItems(deduplicateFeedItems([...additions, ...refreshed]));
  };

  // Helper to clear read stories in a refreshed scope and persist their keys
  const clearScopeReadArticles = (scopePredicate?: (item: FeedItem) => boolean) => {
    setArticles((prev) => {
      const { nextArticles, newlyRecordedKeys } = clearReadArticlesForRefresh(prev, scopePredicate);
      if (newlyRecordedKeys.length > 0) {
        if (!readKeysRef.current) readKeysRef.current = new Set();
        let changed = false;
        for (const k of newlyRecordedKeys) {
          if (!readKeysRef.current.has(k)) {
            readKeysRef.current.add(k);
            changed = true;
          }
        }
        if (changed) persistReadKeys();
      }
      return nextArticles;
    });
  };

  // Listen for background startup feed updates in memory without repeated localStorage round-trips
  useEffect(() => {
    const handleIncomingArticles = (e: Event) => {
      const custom = e as CustomEvent<{
        items?: FeedItem[];
        resolvedFeeds?: Array<{ id: string; url: string }>;
      }>;
      const incomingItemsRaw = custom.detail?.items;
      const resolvedFeeds = custom.detail?.resolvedFeeds;

      if (incomingItemsRaw && incomingItemsRaw.length > 0) {
        const unreadIncoming = readKeysRef.current
          ? filterOutAlreadyReadIncoming(incomingItemsRaw, readKeysRef.current)
          : incomingItemsRaw;

        if (unreadIncoming.length > 0) {
          const batchTs = Date.now();
          // Decide synchronously outside state updater to avoid side-effects inside updater
          if (
            (lastScrollYRef.current > 180 || activeArticleRef.current !== null) &&
            articlesRef.current.length > 0
          ) {
            const brandNew = findNewIncomingArticles(
              articlesRef.current,
              unreadIncoming,
              readKeysRef.current || undefined
            );
            if (brandNew.length > 0) {
              setPendingNewArticles((curr) => deduplicateFeedItems([...brandNew, ...curr]));
              revealNewStoriesPill();
            }
          } else {
            setArticles((prev) => mergeFeedItems(prev, unreadIncoming, true, batchTs));
          }
        }
      }
      if (resolvedFeeds && resolvedFeeds.length > 0) {
        const urlById = new Map(resolvedFeeds.map((r) => [r.id, r.url]));
        setFeeds((prev) =>
          prev.map((f) => {
            const newUrl = urlById.get(f.id);
            return newUrl && newUrl !== f.url ? { ...f, url: newUrl } : f;
          })
        );
      }
    };

    window.addEventListener('chinta:incoming-articles', handleIncomingArticles);
    return () => {
      window.removeEventListener('chinta:incoming-articles', handleIncomingArticles);
    };
  }, []);

  // Continuous Background Feed Fetcher while the user is using the app
  const isBackgroundPollingRef = useRef(false);
  const runContinuousBackgroundSync = async () => {
    if (
      isOfflineRef.current ||
      isRefreshingRef.current ||
      isBackgroundPollingRef.current ||
      feedsRef.current.length === 0
    ) {
      return;
    }
    isBackgroundPollingRef.current = true;
    const pollBatchTs = Date.now();
    try {
      const currentFeeds = feedsRef.current;
      await runPool(currentFeeds, 2, async (feed) => {
        if (isOfflineRef.current || isRefreshingRef.current) return;
        const result = await syncFeed(feed);
        if (!result || result.length === 0) return;

        const unreadOnly = readKeysRef.current
          ? filterOutAlreadyReadIncoming(result, readKeysRef.current)
          : result;
        if (unreadOnly.length === 0) return;

        const brandNew = findNewIncomingArticles(
          articlesRef.current,
          unreadOnly,
          readKeysRef.current || undefined
        );
        if (brandNew.length === 0) return;

        if (
          (lastScrollYRef.current > 180 || activeArticleRef.current !== null) &&
          articlesRef.current.length > 0
        ) {
          setPendingNewArticles((curr) => deduplicateFeedItems([...brandNew, ...curr]));
          revealNewStoriesPill();
        } else {
          setArticles((prev) => mergeFeedItems(prev, unreadOnly, true, pollBatchTs));
        }
      });
    } finally {
      isBackgroundPollingRef.current = false;
    }
  };

  useEffect(() => {
    if (isOffline || feeds.length === 0) return;
    // Initial background catch-up shortly after user opens or adds feeds
    const kickoffTimer = setTimeout(() => {
      void runContinuousBackgroundSync();
    }, 6000);
    // Periodic background polling while user is actively using the app (every 45s)
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void runContinuousBackgroundSync();
      }
    }, 45_000);
    return () => {
      clearTimeout(kickoffTimer);
      clearInterval(interval);
    };
  }, [isOffline, feeds.length]);

  // Smart Background Pre-Extraction for Top 6 Unread Stories (0ms instant fully-loaded Reader open)
  const preExtractedIdsRef = useRef<Set<string>>(new Set());
  const unreadExtractSignature = useMemo(() => {
    return articles
      .filter(
        (a) =>
          !a.isRead &&
          !a.hiddenFromFeed &&
          !hasFullBody(a) &&
          a.link &&
          a.link.startsWith('http') &&
          !/\/video\//i.test(a.link) &&
          !preExtractedIdsRef.current.has(a.id)
      )
      .slice(0, 6)
      .map((a) => a.id)
      .join('|');
  }, [articles]);

  useEffect(() => {
    if (isOffline || !unreadExtractSignature) return;
    const candidates = articles
      .filter(
        (a) =>
          !a.isRead &&
          !a.hiddenFromFeed &&
          !hasFullBody(a) &&
          a.link &&
          a.link.startsWith('http') &&
          !/\/video\//i.test(a.link) &&
          !preExtractedIdsRef.current.has(a.id)
      )
      .slice(0, 6);

    if (candidates.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const candidate of candidates) {
        if (cancelled) break;
        preExtractedIdsRef.current.add(candidate.id);
        try {
          const data = await extractArticleWithFallback(candidate.link);
          if (!cancelled && data.success && data.blocks && data.blocks.length > 0) {
            const validBlocks = data.blocks.filter(
              (b) => !b.text || !isJavaScriptWarningText(b.text)
            );
            const contentClean = validBlocks
              .map((b) => b.text || '')
              .filter(Boolean)
              .join('\n\n');
            if (validBlocks.length > 0 && contentClean.length >= 120) {
              handleCacheExtractedArticle(candidate.id, {
                title: data.title,
                author: data.author,
                leadImage: data.leadImage,
                readTimeMin: data.readTimeMin,
                contentClean,
                contentHtml: blocksToHtml(validBlocks),
              });
            }
          }
        } catch {
          // silent background pre-fetch
        }
      }
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [unreadExtractSignature, isOffline]);

  // Click handler for a specific source: selects only that source, clears read items, and fetches unread updates
  const handleSelectSource = async (feed: Feed) => {
    triggerHapticSelection();
    setSelectedFeedId(feed.id);
    setSelectedFolder(null);
    setSelectedTagId(null);
    setFilterMode('all');
    setSearchQuery('');
    setCurrentTab('stories');
    setIsHeaderVisible(true);
    setVisibleCount(25);

    clearScopeReadArticles((item) => item.feedId === feed.id);

    if (isOffline) {
      notify(`Offline mode: Showing unread cached stories for ${feed.title}`);
      return;
    }

    pendingNewArticlesRef.current = pendingNewArticlesRef.current.filter((a) => a.feedId !== feed.id);
    setPendingNewArticles(pendingNewArticlesRef.current);
    setRefreshFailed(false);
    setIsRefreshing(true);
    const refreshBatchTs = Date.now();
    const baselineArticles = articlesRef.current;
    try {
      const incomingItems = await syncFeed(feed);
      if (incomingItems === null) {
        setRefreshFailed(true);
        setArticles((prev) =>
          reshuffleUnreadFeedItems(prev, (item) => item.feedId === feed.id, refreshBatchTs)
        );
        notify(`Could not reach ${feed.title}. Showing unread stories.`);
      } else {
        const unreadOnly = readKeysRef.current
          ? filterOutAlreadyReadIncoming(incomingItems, readKeysRef.current)
          : incomingItems;
        const genuinelyNew = findNewIncomingArticles(
          baselineArticles,
          unreadOnly,
          readKeysRef.current || undefined
        );
        if (genuinelyNew.length > 0) {
          setArticles((prev) => mergeFeedItems(prev, unreadOnly, true, refreshBatchTs));
        } else {
          setArticles((prev) => {
            const merged = unreadOnly.length > 0 ? mergeFeedItems(prev, unreadOnly, true) : prev;
            return reshuffleUnreadFeedItems(merged, (item) => item.feedId === feed.id, refreshBatchTs);
          });
        }
        const scrollEl = document.querySelector('[data-testid="pull-to-refresh-container"]');
        scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Click handler for a specific folder: selects that folder, clears read items, and fetches unread updates
  const handleSelectFolder = async (folderName: string) => {
    triggerHapticSelection();
    setSelectedFolder(folderName);
    setSelectedFeedId(null);
    setSelectedTagId(null);
    setFilterMode('all');
    setSearchQuery('');
    setCurrentTab('stories');
    setIsHeaderVisible(true);
    setVisibleCount(25);

    const folderFeeds = feeds.filter((f) => (f.category?.trim() || '') === folderName);
    const folderFeedIdSet = new Set(folderFeeds.map((f) => f.id));
    clearScopeReadArticles((item) => folderFeedIdSet.has(item.feedId));

    if (isOffline || folderFeeds.length === 0) {
      if (isOffline) notify(`Offline mode: Showing unread cached stories in ${folderName}`);
      return;
    }

    pendingNewArticlesRef.current = pendingNewArticlesRef.current.filter((a) => !folderFeedIdSet.has(a.feedId));
    setPendingNewArticles(pendingNewArticlesRef.current);

    setRefreshFailed(false);
    setIsRefreshing(true);
    const refreshBatchTs = Date.now();
    const baselineArticles = articlesRef.current;
    let addedNewCount = 0;
    try {
      let failedCount = 0;
      await runPool(folderFeeds, 4, async (f) => {
        const result = await syncFeed(f);
        if (result === null) {
          failedCount += 1;
        } else {
          const unreadOnly = readKeysRef.current
            ? filterOutAlreadyReadIncoming(result, readKeysRef.current)
            : result;
          if (unreadOnly.length > 0) {
            const genuinelyNew = findNewIncomingArticles(
              baselineArticles,
              unreadOnly,
              readKeysRef.current || undefined
            );
            addedNewCount += genuinelyNew.length;
            setArticles((prev) => mergeFeedItems(prev, unreadOnly, true, refreshBatchTs));
          }
        }
      });
      if (addedNewCount === 0) {
        setArticles((prev) =>
          reshuffleUnreadFeedItems(prev, (item) => folderFeedIdSet.has(item.feedId), refreshBatchTs)
        );
      }
      if (failedCount === folderFeeds.length) {
        setRefreshFailed(true);
      } else {
        const scrollEl = document.querySelector('[data-testid="pull-to-refresh-container"]');
        scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Refresh active source, active folder, or all sources - brings new unread content at the top, or reshuffles unread stories if no new items arrived
  const handleRefreshActive = async () => {
    clearScopeReadArticles();

    if (isOffline) {
      const refreshBatchTs = Date.now();
      setArticles((prev) => reshuffleUnreadFeedItems(prev, undefined, refreshBatchTs));
      notify('Offline mode active. Showing unread cached stories.');
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

    if (feeds.length === 0) {
      notify('Add a source in the Sources tab to fetch stories');
      return;
    }

    pendingNewArticlesRef.current = [];
    setPendingNewArticles([]);
    setShowNewStoriesPill(false);
    setVisibleCount(25);

    setRefreshFailed(false);
    setIsRefreshing(true);
    const refreshBatchTs = Date.now();
    const countedNewIds = new Set<string>();
    const baselineArticles = articlesRef.current;
    let addedNewCount = 0;
    try {
      let failedCount = 0;
      await runPool(feeds, 5, async (f) => {
        const result = await syncFeed(f);
        if (result === null) {
          failedCount += 1;
        } else {
          const unreadOnly = readKeysRef.current
            ? filterOutAlreadyReadIncoming(result, readKeysRef.current)
            : result;
          if (unreadOnly.length > 0) {
            const genuinelyNew = findNewIncomingArticles(
              baselineArticles,
              unreadOnly,
              readKeysRef.current || undefined
            );
            for (const item of genuinelyNew) {
              if (!countedNewIds.has(item.id)) {
                countedNewIds.add(item.id);
                addedNewCount += 1;
              }
            }
            setArticles((prev) => mergeFeedItems(prev, unreadOnly, true, refreshBatchTs));
          }
        }
      });

      if (addedNewCount === 0) {
        setArticles((prev) => reshuffleUnreadFeedItems(prev, undefined, refreshBatchTs));
      }

      const scrollEl = document.querySelector('[data-testid="pull-to-refresh-container"]');
      scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
      setIsHeaderVisible(true);

      // Error feedback only when nothing could be refreshed; a partial refresh still counts as done
      if (failedCount === feeds.length) setRefreshFailed(true);
      if (failedCount === feeds.length) {
        notify('Could not refresh sources. Showing unread stories.');
      } else if (addedNewCount > 0) {
        notify(`Refreshed · ${addedNewCount} new ${addedNewCount === 1 ? 'story' : 'stories'}`);
      } else {
        const unreadRemaining = articlesRef.current.filter((a) => !a.isRead && !a.hiddenFromFeed).length;
        notify(
          unreadRemaining > 0
            ? `Feed updated · ${unreadRemaining} unread ${unreadRemaining === 1 ? 'story' : 'stories'}`
            : 'All caught up · No unread stories'
        );
      }
    } catch {
      setRefreshFailed(true);
      notify('Refresh failed. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Direct URL Loader: When a link is given, search for its RSS link first; if available add RSS link, otherwise website link
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

      const hostName = parsedUrl.hostname.replace(/^www\./, '');
      const existingFeed = feeds.find(
        (f) =>
          f.url === targetUrl ||
          f.siteUrl === targetUrl ||
          f.url.includes(hostName) ||
          (f.siteUrl && f.siteUrl.includes(hostName))
      );

      if (existingFeed) {
        setDirectUrlInput('');
        await handleSelectSource(existingFeed);
        return;
      }

      const tempFeedId = makeFeedId();
      const feedResult = await fetchFeedWithFallback({
        url: targetUrl,
        feedId: tempFeedId,
        title: hostName,
        tags: ['tag_bd'],
      });

      if (feedResult && Array.isArray(feedResult.items) && feedResult.items.length > 0) {
        const finalUrl = feedResult.resolvedFeedUrl || targetUrl;
        const resolvedTitle =
          feedResult.feedTitle && feedResult.feedTitle !== 'RSS Feed'
            ? feedResult.feedTitle
            : hostName;
        const newFeed: Feed = {
          id: tempFeedId,
          title: resolvedTitle,
          url: finalUrl,
          siteUrl: parsedUrl.origin,
          description: `Source for ${resolvedTitle}`,
          category: '',
          defaultTags: ['tag_bd'],
          unreadCount: 0,
        };
        setFeeds((prev) => [newFeed, ...prev]);
        setArticles((prev) =>
          mergeFeedItems(
            prev,
            feedResult.items.map((item) => ({
              ...item,
              feedId: newFeed.id,
              feedTitle: newFeed.title,
            }))
          )
        );
        setSelectedFeedId(newFeed.id);
        setSelectedFolder(null);
        setSelectedTagId(null);
        setFilterMode('all');
        setCurrentTab('stories');
        setDirectUrlInput('');
        notify(
          finalUrl !== targetUrl
            ? `Added RSS feed for ${resolvedTitle}`
            : `Added website source ${resolvedTitle}`
        );
        return;
      }

      // If no feed items were returned, check if it's a single article or still add as website link
      const data = await extractArticleWithFallback(targetUrl);
      if (data.success && data.blocks && data.blocks.length > 0) {
        const htmlContent = blocksToHtml(data.blocks);
        const cleanText = data.blocks
          .map((b: any) => b.text || '')
          .filter(Boolean)
          .join(' ');

        const directArticle: FeedItem = {
          id: `direct_${Date.now()}`,
          feedId: selectedFeedId || tempFeedId,
          feedTitle: data.siteName || hostName,
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
        const newFeed: Feed = {
          id: tempFeedId,
          title: hostName,
          url: targetUrl,
          siteUrl: targetUrl,
          category: '',
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

  // Cache extracted article content back into articles state and activeArticle for offline/instant reading
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
    const speedProfile = readingSpeedProfileRef.current;
    setArticles((prev) =>
      prev.map((a) => {
        if (a.id !== articleId) return a;
        const merged = {
          ...a,
          title: extracted.title || a.title,
          author: extracted.author || a.author,
          imageUrl: extracted.leadImage || a.imageUrl,
          readTimeMin: extracted.readTimeMin || a.readTimeMin,
          contentClean: extracted.contentClean || a.contentClean,
          contentHtml: extracted.contentHtml || a.contentHtml,
          isOfflineCached: true,
          cachedAt: Date.now(),
        };
        return {
          ...merged,
          readTimeMin: estimateArticleReadTime(merged, speedProfile).minutes,
        };
      })
    );
    setActiveArticle((curr) => {
      if (!curr || curr.id !== articleId) return curr;
      const merged = {
        ...curr,
        title: extracted.title || curr.title,
        author: extracted.author || curr.author,
        imageUrl: extracted.leadImage || curr.imageUrl,
        readTimeMin: extracted.readTimeMin || curr.readTimeMin,
        contentClean: extracted.contentClean || curr.contentClean,
        contentHtml: extracted.contentHtml || curr.contentHtml,
        isOfflineCached: true,
        cachedAt: Date.now(),
      };
      return {
        ...merged,
        readTimeMin: estimateArticleReadTime(merged, speedProfile).minutes,
      };
    });
  };

  // Learn the reader's personal (words, lines, language) reading pace after 15 completed articles
  const handleCompleteReadingSession = (session: {
    article: FeedItem;
    text: string;
    contentHtml?: string;
    activeMs: number;
  }) => {
    const res = recordCompletedReadingSession(readingSpeedProfileRef.current, {
      articleId: session.article.id,
      text: session.text,
      contentHtml: session.contentHtml ?? session.article.contentHtml,
      title: session.article.title,
      activeMs: session.activeMs,
    });
    if (!res.recorded) return;

    readingSpeedProfileRef.current = res.nextProfile;
    setReadingSpeedProfile(res.nextProfile);

    if (res.justCalibrated) {
      const langLabel = res.language === 'bn' ? 'Bangla' : 'English';
      triggerHapticComplete();
      if (res.learnedWpm) {
        notify(`Reading pace calibrated (${langLabel}: ${res.learnedWpm.toLocaleString()} wpm)`);
      } else {
        notify('Reading pace calibrated across 15 articles');
      }
    }
  };

  // Share any feed article directly in Chinta's story card (with article photo & author name)
  const handleShareArticleFromFeed = (article: FeedItem) => {
    const latest = articles.find((a) => a.id === article.id) || article;
    setShareCardArticle(latest);
    if (
      (!latest.imageUrl || !latest.author) &&
      !isOffline &&
      latest.link &&
      latest.link.startsWith('http') &&
      !/news\.google\.com\/rss\/articles\//i.test(latest.link)
    ) {
      extractArticleWithFallback(latest.link)
        .then((data) => {
          if (!data || !data.success) return;
          const nextLeadImage = data.leadImage || latest.imageUrl;
          const nextAuthor = data.author || latest.author;
          const contentClean = (data.blocks || [])
            .map((b) => b.text || '')
            .filter(Boolean)
            .join('\n\n');
          const contentHtml =
            data.blocks && data.blocks.length > 0 ? blocksToHtml(data.blocks) : undefined;
          if (nextLeadImage || nextAuthor || contentClean) {
            handleCacheExtractedArticle(latest.id, {
              title: data.title || latest.title,
              author: nextAuthor,
              leadImage: nextLeadImage,
              readTimeMin: data.readTimeMin || latest.readTimeMin,
              contentClean: contentClean || undefined,
              contentHtml,
            });
            setShareCardArticle((curr) =>
              curr && curr.id === latest.id
                ? {
                    ...curr,
                    title: data.title || curr.title,
                    author: nextAuthor || curr.author,
                    imageUrl: nextLeadImage || curr.imageUrl,
                    contentClean: contentClean || curr.contentClean,
                    contentHtml: contentHtml || curr.contentHtml,
                  }
                : curr
            );
          }
        })
        .catch(() => {
          // ignore background enrichment failure
        });
    }
  };

  // Open article fully loaded in ReaderView, mark as read, and record stats
  const handleOpenArticle = async (article: FeedItem, resumeScrollTop = 0) => {
    const rawLatest = articles.find((a) => a.id === article.id) || article;
    const latest: FeedItem = { ...rawLatest, isRead: true };
    setReaderInitialScrollTop(resumeScrollTop);

    // Mark as read immediately and persist key so refreshing never brings this read story back
    recordReadKeys([latest]);
    setArticles((prev) =>
      prev.map((a) => (a.id === latest.id ? { ...a, isRead: true } : a))
    );

    const estimatedMin = estimateArticleReadTime(latest, readingSpeedProfileRef.current).minutes;

    setReadingHabit((prev) => {
      const { nextState, justHitDailyGoal } = recordArticleReadInHabit(
        prev,
        latest.id,
        estimatedMin,
        toDateKey(),
        {
          title: latest.title,
          feedId: latest.feedId,
          feedTitle: latest.feedTitle,
          feedUrl: latest.feedUrl,
          imageUrl: latest.imageUrl,
          tags: latest.tags,
        }
      );
      if (justHitDailyGoal) {
        setTimeout(() => {
          triggerHapticComplete();
          notify(`Daily reading goal complete! ${nextState.streakDays}-day streak`);
        }, 400);
      }
      return nextState;
    });

    // Ensure the article opens fully loaded in reading view
    if (
      !hasFullBody(latest) &&
      !isOffline &&
      latest.link &&
      latest.link.startsWith('http') &&
      !/\/video\//i.test(latest.link) &&
      !/news\.google\.com\/rss\/articles\//i.test(latest.link)
    ) {
      setLoadingArticleId(latest.id);
      setIsOpeningFullArticle(true);
      try {
        const extractionPromise = extractArticleWithFallback(latest.link);
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 2400)
        );
        const data = await Promise.race([extractionPromise, timeoutPromise]);
        if (data && data.success && data.blocks && data.blocks.length > 0) {
          const validBlocks = data.blocks.filter(
            (b) => !b.text || !isJavaScriptWarningText(b.text)
          );
          const contentClean = validBlocks
            .map((b) => b.text || '')
            .filter(Boolean)
            .join('\n\n');
          if (validBlocks.length > 0 && contentClean.length >= 80) {
            const contentHtml = blocksToHtml(validBlocks);
            const preEstimateArticle: FeedItem = {
              ...latest,
              isRead: true,
              title: data.title || latest.title,
              author: data.author || latest.author,
              imageUrl: data.leadImage || latest.imageUrl,
              readTimeMin: data.readTimeMin || latest.readTimeMin,
              contentClean,
              contentHtml,
              isOfflineCached: true,
              cachedAt: Date.now(),
            };
            const fullyLoadedArticle: FeedItem = {
              ...preEstimateArticle,
              readTimeMin: estimateArticleReadTime(
                preEstimateArticle,
                readingSpeedProfileRef.current
              ).minutes,
            };
            handleCacheExtractedArticle(latest.id, {
              title: fullyLoadedArticle.title,
              author: fullyLoadedArticle.author,
              leadImage: fullyLoadedArticle.imageUrl,
              readTimeMin: fullyLoadedArticle.readTimeMin,
              contentClean: fullyLoadedArticle.contentClean,
              contentHtml: fullyLoadedArticle.contentHtml,
            });
            setActiveArticle(fullyLoadedArticle);
            return;
          }
        }
      } catch {
        // Fallback to existing content
      } finally {
        setLoadingArticleId(null);
        setIsOpeningFullArticle(false);
      }
    }

    setActiveArticle(latest);
  };

  // Scan all app sources for Perspective coverage of a story
  const hasScannedPerspectiveOnceRef = useRef(false);
  const handleScanAllSourcesForPerspective = async (_target: FeedItem) => {
    if (isOffline || isScanningPerspectiveSources) return;
    setIsScanningPerspectiveSources(true);
    try {
      const incomingItems: FeedItem[] = [];
      await runPool(feeds.slice(0, 12), 4, async (f) => {
        const result = await syncFeed(f);
        if (result && result.length > 0) {
          incomingItems.push(...result);
        }
      });
      if (incomingItems.length > 0) {
        setArticles((prev) => mergeFeedItems(prev, incomingItems));
      }
    } finally {
      setIsScanningPerspectiveSources(false);
    }
  };

  const handleOpenPerspective = (article: FeedItem) => {
    setPerspectiveArticle(article);
    if (!hasScannedPerspectiveOnceRef.current && !isOffline) {
      hasScannedPerspectiveOnceRef.current = true;
      handleScanAllSourcesForPerspective(article);
    }
  };

  // Track reading progress for the Floating "Continue Reading" Resume Bar
  const handleReadingProgressChange = (
    article: FeedItem,
    progressPercent: number,
    scrollTop: number
  ) => {
    if (progressPercent >= 92) {
      // Completed reading the article -> clear from resume bar if it was this article
      setReadingProgress((curr) => (curr?.articleId === article.id ? null : curr));
    } else if (progressPercent >= 5) {
      setReadingProgress({
        articleId: article.id,
        title: article.title,
        feedTitle: article.feedTitle,
        progressPercent,
        scrollTop,
        updatedAt: Date.now(),
      });
    }
  };

  // Article Actions
  const handleToggleBookmark = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = articles.find((a) => a.id === id) || activeArticle || quickPeekArticle;
    const nextBookmarked = target ? !target.isBookmarked : true;
    setArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isBookmarked: !a.isBookmarked } : a))
    );
    if (activeArticle && activeArticle.id === id) {
      setActiveArticle((curr) => (curr ? { ...curr, isBookmarked: !curr.isBookmarked } : null));
    }
    if (quickPeekArticle && quickPeekArticle.id === id) {
      setQuickPeekArticle((curr) => (curr ? { ...curr, isBookmarked: !curr.isBookmarked } : null));
    }

  };

  const handleToggleRead = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = articles.find((a) => a.id === id);
    const markingAsRead = target ? !target.isRead : true;

    setArticles((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              isRead: !a.isRead,
              hiddenFromFeed: markingAsRead ? a.hiddenFromFeed : false,
            }
          : a
      )
    );
    if (activeArticle && activeArticle.id === id) {
      setActiveArticle((curr) => (curr ? { ...curr, isRead: !curr.isRead } : null));
    }

    if (target) {
      if (markingAsRead) {
        recordReadKeys([target]);
      } else {
        removeReadKeys(target);
      }
    }

    if (markingAsRead && target) {
      setReadingHabit((prev) => {
        const { nextState, justHitDailyGoal } = recordArticleReadInHabit(
          prev,
          target.id,
          target.readTimeMin || 3,
          toDateKey(),
          {
            title: target.title,
            feedId: target.feedId,
            feedTitle: target.feedTitle,
            feedUrl: target.feedUrl,
            imageUrl: target.imageUrl,
            tags: target.tags,
          }
        );
        if (justHitDailyGoal) {
          triggerHapticComplete();
          notify(`Daily reading goal complete! ${nextState.streakDays}-day streak`);
        }
        return nextState;
      });
    }
  };

  const handleMarkSourceAsRead = () => {
    const affected = articles.filter((a) => {
      if (selectedFeedId) return a.feedId === selectedFeedId;
      if (selectedFolder && selectedFolderFeedIds) return selectedFolderFeedIds.includes(a.feedId);
      return true;
    });
    recordReadKeys(affected);

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
    const removedFeed = feeds.find((f) => f.id === feedId);
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
  const displayedArticles = deduplicateFeedItems(
    filterArticles(articles, {
      selectedFeedId: currentTab === 'stories' && !selectedTagId ? selectedFeedId : null,
      selectedFeedIds:
        currentTab === 'stories' && !selectedTagId && !selectedFeedId ? selectedFolderFeedIds : null,
      selectedTagId,
      searchQuery,
      filterMode: currentTab === 'saved' ? 'bookmarked' : filterMode,
    })
  );

  // Group related coverage into Developing Story Clusters
  const storyClusters = useMemo(() => {
    return clusterStoriesByTopic(displayedArticles.slice(0, visibleCount));
  }, [displayedArticles, visibleCount]);

  // Build Daily 5-Story Smart Edition Briefing
  const dailyBriefing = useMemo(() => {
    return buildDailyBriefing(articles);
  }, [articles]);

  const activeSourceUnreadCount = displayedArticles.filter((a) => !a.isRead).length;
  const totalUnreadCount = articles.filter((a) => !a.isRead).length;

  // Previous / Next article navigation in ReaderView
  const handlePrevArticle = () => {
    if (!activeArticle || displayedArticles.length === 0) return;
    const currentIndex = displayedArticles.findIndex((a) => a.id === activeArticle.id);
    if (currentIndex > 0) {
      handleOpenArticle(displayedArticles[currentIndex - 1], 0);
    } else {
      handleOpenArticle(displayedArticles[displayedArticles.length - 1], 0);
    }
  };

  const handleNextArticle = () => {
    if (!activeArticle || displayedArticles.length === 0) return;
    const currentIndex = displayedArticles.findIndex((a) => a.id === activeArticle.id);
    if (currentIndex >= 0 && currentIndex < displayedArticles.length - 1) {
      handleOpenArticle(displayedArticles[currentIndex + 1], 0);
    } else {
      handleOpenArticle(displayedArticles[0], 0);
    }
  };

  // Apply buffered new stories when user taps the "↑ X New Stories Available" pill
  const handleApplyPendingNewStories = () => {
    triggerHapticSelection();
    setShowNewStoriesPill(false);
    const toApply = pendingNewArticlesRef.current.length > 0
      ? pendingNewArticlesRef.current
      : pendingNewArticles;
    pendingNewArticlesRef.current = [];
    setPendingNewArticles([]);
    if (toApply.length > 0) {
      const batchTs = Date.now();
      setArticles((prev) => mergeFeedItems(prev, toApply, true, batchTs));
    }
    setVisibleCount((v) => Math.max(25, v));
    const scrollEl = document.querySelector('[data-testid="pull-to-refresh-container"]');
    scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
    setIsHeaderVisible(true);
  };

  // Scroll the active feed or list smoothly back to top (iOS status-bar / active-tab tap convention)
  const scrollActiveFeedToTop = () => {
    const scrollEl = document.querySelector('[data-testid="pull-to-refresh-container"]');
    scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
    setIsHeaderVisible(true);
  };

  const showDailyBriefing =
    currentTab === 'stories' &&
    !selectedFeedId &&
    !selectedFolder &&
    !selectedTagId &&
    filterMode === 'all' &&
    !searchQuery &&
    dailyBriefing.stories.length >= 3;

  const spotifyStats = useMemo(
    () => computeSpotifyReadingStats(readingHabit, articles, feeds, tags),
    [readingHabit, articles, feeds, tags]
  );

  const habitReadToday = readingHabit.todayReadIds.length;
  const habitGoal = Math.max(1, readingHabit.dailyGoal || 3);

  return (
    <IPhoneFrame
      isOffline={isOffline}
      onToggleOffline={() => setIsOffline(!isOffline)}
      onRefreshAll={handleRefreshActive}
      isRefreshing={isRefreshing}
      onOpenIosModal={() => setIsIosModalOpen(true)}
    >
      {/* Toast Notification - spring in from top */}
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

              {/* Floating Top 3D Liquid Glass Orbs & Capsule (Double-tap header area to scroll to top) */}
              <header
                onDoubleClick={() => {
                  triggerHapticSelection();
                  scrollActiveFeedToTop();
                }}
                className={`absolute top-0 left-0 right-0 z-30 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2 pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isHeaderVisible
                    ? 'translate-y-0 opacity-100'
                    : '-translate-y-20 opacity-0'
                }`}
              >
                <div className="flex items-center justify-between gap-2 pt-1">
                  {/* Top-Left: Spotify-Style Reading Stats Pill & Active Filter Pill */}
                  <div className="flex items-center gap-2 min-w-0 pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setIsHabitSheetOpen(true);
                      }}
                      aria-label="Open Reading Stats and Story Share"
                      title="Reading Stats & Story Share"
                      className="liquid-glass-pill h-10 px-3 rounded-full flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-white active:scale-95 transition-transform shrink-0"
                    >
                      <BarChart3 className="w-3.5 h-3.5 text-[#FF6719]" />
                      <span className="font-mono tabular-nums">
                        {spotifyStats.totalMinutesRead}m
                      </span>
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
                        className="liquid-glass-pill h-10 px-3.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-stone-900 dark:text-white truncate max-w-[160px] active:scale-95 transition-transform"
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
                  <div className="liquid-glass-pill h-12 pl-3.5 pr-2 rounded-full flex items-center gap-2.5 shrink-0 pointer-events-auto ml-auto">
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

                    {/* Layered Circular Filter Orb */}
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

                {/* Floating Liquid Glass Search Bar */}
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

              {/* Floating "↑ New Stories Available" Liquid Glass Pill (persists until tapped or scrolled to top) */}
              {showNewStoriesPill && pendingNewArticles.length > 0 && (
                <div className="absolute top-[calc(max(env(safe-area-inset-top,0px),0.75rem)+3.75rem)] left-1/2 -translate-x-1/2 z-30 pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-200">
                  <button
                    type="button"
                    data-testid="new-stories-pill"
                    onClick={handleApplyPendingNewStories}
                    className="liquid-glass-pill px-4 py-2 rounded-full flex items-center gap-2 text-xs font-semibold text-white bg-[#FF6719]/90 shadow-xl active:scale-95 transition-transform"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                    <span className="tabular-nums">
                      {pendingNewArticles.length} New {pendingNewArticles.length === 1 ? 'Story' : 'Stories'} Available
                    </span>
                  </button>
                </div>
              )}

              {/* Articles Feed with Pull to Refresh - scrolls directly under top & bottom Liquid Glass */}
              <PullToRefresh
                className="h-full pt-[calc(max(env(safe-area-inset-top,0px),0.75rem)+3.75rem)] pb-32"
                onScroll={handleFeedScroll}
                onRefresh={handleRefreshActive}
                isRefreshing={isRefreshing}
                refreshFailed={refreshFailed}
                disabled={isOffline}
              >
                {/* Collapsible 5-Story Daily Smart Edition Briefing */}
                {showDailyBriefing && (
                  <DailyBriefingCard
                    briefing={dailyBriefing}
                    onSelectStory={(art) => handleOpenArticle(art, 0)}
                    onQuickPeek={(art) => setQuickPeekArticle(art)}
                  />
                )}

                <div className="divide-y divide-stone-200/50 dark:divide-white/[0.08]">
                  {storyClusters.map((cluster) => (
                    <ArticleCard
                      key={cluster.id}
                      article={cluster.primary}
                      perspectives={cluster.perspectives}
                      viewMode={feedViewMode}
                      readingSpeedProfile={readingSpeedProfile}
                      isLoadingArticleId={loadingArticleId}
                      onSelect={(art) => handleOpenArticle(art, 0)}
                      onToggleBookmark={handleToggleBookmark}
                      onToggleRead={handleToggleRead}
                      onQuickPeek={(art) => setQuickPeekArticle(art)}
                      onOpenPerspective={(art) => handleOpenPerspective(art)}
                      onShareArticle={handleShareArticleFromFeed}
                      onOpenTagManager={(art, e) => {
                        e.stopPropagation();
                        setTagModalArticle(art);
                        setIsTagModalOpen(true);
                      }}
                    />
                  ))}
                </div>

                {/* "You're All Caught Up" Dopamine Milestone Footer */}
                {displayedArticles.length > 0 && (
                  <div className="mx-4 my-6 p-5 rounded-3xl liquid-glass border border-stone-200/70 dark:border-white/[0.08] text-center">
                    <div className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center mx-auto mb-2.5">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 mb-1">
                      You’re All Caught Up
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mb-3 tabular-nums">
                      {habitReadToday} {habitReadToday === 1 ? 'story' : 'stories'} read today ·{' '}
                      {readingHabit.todayMinutes}m mindful reading · {readingHabit.streakDays}d streak
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        handleRefreshActive();
                      }}
                      disabled={isRefreshing || isOffline}
                      className="px-4 py-2 rounded-xl text-xs font-semibold liquid-glass-pill text-stone-800 dark:text-stone-100 hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {isRefreshing ? 'Checking Sources…' : 'Check for Fresh Updates'}
                    </button>
                  </div>
                )}

                {feeds.length === 0 && displayedArticles.length === 0 ? (
                  <div className="mx-4 my-10 p-6 rounded-3xl liquid-glass border border-stone-200/70 dark:border-white/[0.08] text-center">
                    <div className="w-12 h-12 rounded-2xl bg-[#FF6719]/15 text-[#FF6719] flex items-center justify-center mx-auto mb-3.5">
                      <Rss className="w-6 h-6" />
                    </div>
                    <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100 mb-1.5">
                      Your Newsfeed is Empty
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed max-w-xs mx-auto mb-5">
                      No preloaded sources are enabled. Add any newspaper, website URL, or RSS link in the Sources tab to build your personal feed.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setCurrentTab('feeds');
                      }}
                      className="px-5 py-2.5 rounded-full text-xs font-semibold bg-[#FF6719] text-white shadow-lg shadow-[#FF6719]/25 active:scale-95 transition-transform"
                    >
                      Add Your First Source →
                    </button>
                  </div>
                ) : (
                  displayedArticles.length === 0 && (
                    <div className="py-16 px-6 text-center text-stone-500">
                      <p className="font-serif text-base text-stone-800 dark:text-stone-200 mb-1">
                        No stories found for this filter
                      </p>
                      <p className="text-xs mb-4">
                        Try switching filters or pull down to check for new articles.
                      </p>
                      <button
                        type="button"
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
                  )
                )}
              </PullToRefresh>

              {/* Floating "Continue Reading" Resume Mini-Bar (hides during scrolling) */}
              {readingProgress && !activeArticle && (
                <div
                  data-testid="continue-reading-bar"
                  className={`absolute bottom-[calc(max(env(safe-area-inset-bottom,0px),0.5rem)+4.25rem)] left-4 right-4 z-30 transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isFeedActivelyScrolling || !isHeaderVisible
                      ? 'translate-y-24 opacity-0 pointer-events-none'
                      : 'translate-y-0 opacity-100 pointer-events-auto'
                  }`}
                >
                  <div className="liquid-glass-pill px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-3 shadow-xl border border-stone-200/80 dark:border-white/15">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        const target = articles.find((a) => a.id === readingProgress.articleId);
                        if (target) {
                          handleOpenArticle(target, readingProgress.scrollTop);
                        } else {
                          setReadingProgress(null);
                        }
                      }}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                    >
                      <BookOpen className="w-4 h-4 text-[#FF6719] shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                          <span className="font-semibold text-[#FF6719]">Continue Reading</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{readingProgress.progressPercent}% read</span>
                        </div>
                        <div className="font-serif text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {readingProgress.title}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setReadingProgress(null);
                      }}
                      aria-label="Dismiss continue reading bar"
                      className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-white transition-colors shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
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
                        clearScopeReadArticles();
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
                    readingSpeedProfile={readingSpeedProfile}
                    isLoadingArticleId={loadingArticleId}
                    onSelect={(art) => handleOpenArticle(art, 0)}
                    onToggleBookmark={handleToggleBookmark}
                    onToggleRead={handleToggleRead}
                    onQuickPeek={(art) => setQuickPeekArticle(art)}
                    onOpenPerspective={(art) => handleOpenPerspective(art)}
                    onShareArticle={handleShareArticleFromFeed}
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
              onSyncNow={performFullCloudSync}
            />
          )}

          {/* Bottom Floating iOS 26 Liquid Glass Capsule Dock */}
          <TabBar
            currentTab={currentTab}
            isVisible={isHeaderVisible || currentTab !== 'stories'}
            onReselectActiveTab={(tab) => {
              if (tab === 'stories') {
                scrollActiveFeedToTop();
              }
            }}
            onSelectTab={(tab) => {
              clearScopeReadArticles();
              setCurrentTab(tab);
              setIsHeaderVisible(true);
              setIsFeedActivelyScrolling(false);
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

          {/* Sleek Full-Story Pre-load Overlay when opening an uncached article */}
          {isOpeningFullArticle && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 backdrop-blur-xs animate-in fade-in duration-100">
              <div className="liquid-glass-pill px-4 py-2.5 rounded-full flex items-center gap-2.5 text-xs font-semibold text-stone-900 dark:text-white shadow-2xl">
                <div className="w-3.5 h-3.5 border-2 border-[#FF6719] border-t-transparent rounded-full animate-spin shrink-0" />
                <span>Loading full story for Reader View…</span>
              </div>
            </div>
          )}

          {/* Reader View - iOS push navigation slide-in */}
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
                onPrevArticle={handlePrevArticle}
                onNextArticle={handleNextArticle}
                initialScrollTop={readerInitialScrollTop}
                onReadingProgressChange={handleReadingProgressChange}
                readingSpeedProfile={readingSpeedProfile}
                onCompleteReadingSession={handleCompleteReadingSession}
                onCacheExtractedArticle={handleCacheExtractedArticle}
                onOpenPerspective={(art) => handleOpenPerspective(art)}
              />
            </div>
          )}
        </div>

      {/* Modals */}
      <PerspectiveModal
        targetArticle={perspectiveArticle}
        allArticles={articles}
        feeds={feeds}
        readingSpeedProfile={readingSpeedProfile}
        isScanningSources={isScanningPerspectiveSources}
        onScanAllSources={handleScanAllSourcesForPerspective}
        onClose={() => setPerspectiveArticle(null)}
        onSelectArticle={(art) => handleOpenArticle(art, 0)}
        onCacheExtractedArticle={handleCacheExtractedArticle}
      />

      <QuickPeekModal
        article={quickPeekArticle}
        readingSpeedProfile={readingSpeedProfile}
        onClose={() => setQuickPeekArticle(null)}
        onReadFull={(art) => handleOpenArticle(art, 0)}
        onToggleBookmark={(id) => handleToggleBookmark(id)}
      />

      {shareCardArticle && (
        <QuoteShareModal
          isOpen={Boolean(shareCardArticle)}
          onClose={() => setShareCardArticle(null)}
          article={shareCardArticle}
          initialMode="song"
          estimatedReadTimeMin={
            estimateArticleReadTime(shareCardArticle, readingSpeedProfile).minutes
          }
        />
      )}

      <ReadingHabitSheet
        isOpen={isHabitSheetOpen}
        onClose={() => setIsHabitSheetOpen(false)}
        habit={readingHabit}
        stats={spotifyStats}
        readingSpeedProfile={readingSpeedProfile}
        onChangeDailyGoal={(goal) => {
          setReadingHabit((prev) => ({ ...prev, dailyGoal: goal }));
          notify(`Daily reading goal set to ${goal} stories`);
        }}
      />

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
