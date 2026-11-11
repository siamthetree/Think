import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  CheckCheck,
  ArrowDownCircle,
  LayoutList,
  Rows3,
  PenSquare,
  Send,
  Sparkles,
  Trash2,
  Image as ImageIcon,
  BookOpen,
} from 'lucide-react';
import { IPhoneFrame } from './components/IPhoneFrame';
import { ArticleCard } from './components/ArticleCard';
import { ReaderView } from './components/ReaderView';
import { TabBar, type TabType } from './components/TabBar';
import { TagManagerModal } from './components/TagManagerModal';
import { FeedManagerModal } from './components/FeedManagerModal';
import { IosBuildModal } from './components/IosBuildModal';
import { PullToRefresh } from './components/PullToRefresh';
import type { Feed, FeedItem, Tag, ReaderPreferences } from './types';
import {
  loadFeedsFromStorage,
  saveFeedsToStorage,
  loadArticlesFromStorage,
  saveArticlesToStorage,
  loadTagsFromStorage,
  saveTagsToStorage,
  loadPreferencesFromStorage,
  savePreferencesToStorage,
  hasFullBody,
} from './utils/storage';
import { filterArticles, calculateReadTime } from './utils/feedParser';
import {
  fetchFeedWithFallback,
  extractArticleWithFallback,
  publishBlogToDatabase,
} from './utils/apiClient';
import { blocksToHtml, escapeHtml } from './utils/sanitize';

export default function App() {
  // Core Persistent State
  const [feeds, setFeeds] = useState<Feed[]>(loadFeedsFromStorage);
  const [articles, setArticles] = useState<FeedItem[]>(loadArticlesFromStorage);
  const [tags, setTags] = useState<Tag[]>(loadTagsFromStorage);
  const [preferences, setPreferences] = useState<ReaderPreferences>(() => {
    return loadPreferencesFromStorage();
  });

  useEffect(() => {
    const isDark = preferences.theme === 'slate' || preferences.theme === 'oled';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [preferences.theme]);

  // Navigation & Active Source State
  // The app only displays a source's feed when a specific source is clicked (selectedFeedId !== null)
  const [currentTab, setCurrentTab] = useState<TabType>('stories');
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
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

  // User Draft & Published Posts (local state list persisted alongside RSS items)
  const [userPosts, setUserPosts] = useState<FeedItem[]>(() => {
    try {
      const stored = localStorage.getItem('chinta_user_posts_v1');
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('chinta_user_posts_v1', JSON.stringify(userPosts));
    } catch {}
  }, [userPosts]);

  // Form State for Write tab
  const [writeTitle, setWriteTitle] = useState('');
  const [writeContent, setWriteContent] = useState('');
  const [writeAuthor, setWriteAuthor] = useState('');
  const [writeGroup, setWriteGroup] = useState('Travelers of Bangladesh (TOB)');
  const [writeLocation, setWriteLocation] = useState('');
  const [writeCoverImage, setWriteCoverImage] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublishPost = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = writeTitle.trim();
    const trimmedContent = writeContent.trim();
    if (!trimmedTitle || !trimmedContent) {
      notify('Please enter a title and content for your story.');
      return;
    }

    setIsPublishing(true);
    const authorName = writeAuthor.trim() || 'Community Writer';
    const groupName = writeGroup.trim();
    const locationName = writeLocation.trim();
    const now = Date.now();
    const postId = `post_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const readTime = calculateReadTime(trimmedContent);

    const paragraphs = trimmedContent
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const groupBadgeHtml = groupName
      ? `<div class="travel-group-badge mb-4 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-200">
           <p class="text-xs uppercase font-bold tracking-wider text-emerald-400 mb-1">Bangladeshi Travel Group Dispatch</p>
           <p class="text-sm font-semibold text-stone-100">${escapeHtml(groupName)} · Writer: ${escapeHtml(authorName)}</p>
           ${locationName ? `<p class="text-xs text-stone-300 mt-1">📍 Destination: ${escapeHtml(locationName)}</p>` : ''}
         </div>`
      : '';

    const contentHtml = `
      ${groupBadgeHtml}
      ${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
    `;

    const newPost: FeedItem = {
      id: postId,
      feedId: 'travel_blogs_bd',
      feedTitle: groupName || 'Community Travel Dispatch',
      feedUrl: '/api/blogs',
      title: trimmedTitle,
      link: `https://chinta.app/posts/${postId}`,
      pubDate: new Date(now).toISOString(),
      timestamp: now,
      author: authorName,
      summary: trimmedContent.slice(0, 240),
      contentHtml,
      contentClean: trimmedContent,
      imageUrl: writeCoverImage.trim() || undefined,
      tags: ['tag_bd'],
      isRead: true,
      isBookmarked: false,
      isOfflineCached: true,
      cachedAt: now,
      readTimeMin: readTime,
    };

    // 1. Add to local state list
    setUserPosts((prev) => [newPost, ...prev]);

    // 2. Persist alongside RSS items in feed
    setArticles((prev) => [newPost, ...prev]);

    // 3. Post to server database (/api/blogs)
    publishBlogToDatabase({
      title: trimmedTitle,
      author: authorName,
      groupName: groupName || 'Community Writer',
      location: locationName,
      summary: trimmedContent.slice(0, 240),
      content: trimmedContent,
      coverImage: writeCoverImage.trim() || undefined,
    }).catch((err) => console.warn('Cloud sync for blog skipped:', err));

    setWriteTitle('');
    setWriteContent('');
    setWriteLocation('');
    setWriteCoverImage('');
    setIsPublishing(false);

    // Switch to newsfeed
    setCurrentTab('stories');
    setSelectedFeedId(null);
    setSelectedTagId(null);
    notify('Story published to newsfeed!');
  };

  const handleDeleteUserPost = (postId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setUserPosts((prev) => prev.filter((p) => p.id !== postId));
    setArticles((prev) => prev.filter((a) => a.id !== postId));
    notify('Post removed from feed');
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
        if (data.resolvedFeedUrl && data.resolvedFeedUrl !== feed.url) {
          setFeeds((prev) =>
            prev.map((f) =>
              f.id === feed.id
                ? {
                    ...f,
                    url: data.resolvedFeedUrl!,
                    title: f.title === 'Newspaper Feed' && data.feedTitle ? data.feedTitle : f.title,
                  }
                : f
            )
          );
        }
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
    setSelectedFeedId(feed.id);
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

  // Refresh active source (or all sources if triggered from top bar)
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
  const handleLoadDirectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    let targetUrl = directUrlInput.trim();
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
      prev.map((a) => (!selectedFeedId || a.feedId === selectedFeedId ? { ...a, isRead: true } : a))
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

  // Filtered Articles calculation:
  // When in Stories tab and a source is clicked, only show that specific source's feed
  const displayedArticles = filterArticles(articles, {
    selectedFeedId: currentTab === 'stories' && !selectedTagId ? selectedFeedId : null,
    selectedTagId,
    searchQuery,
    filterMode: currentTab === 'saved' ? 'bookmarked' : filterMode,
  });

  const activeSourceUnreadCount = displayedArticles.filter((a) => !a.isRead).length;
  const totalUnreadCount = articles.filter((a) => !a.isRead).length;

  const unreadCountByFeed = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of articles) {
      if (!a.isRead) {
        counts[a.feedId] = (counts[a.feedId] || 0) + 1;
      }
    }
    return counts;
  }, [articles]);

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
        <div className="absolute top-[max(env(safe-area-inset-top,12px),12px)] left-1/2 -translate-x-1/2 px-4 py-2.5 bg-stone-900/96 dark:bg-stone-100/96 text-white dark:text-stone-900 text-xs font-semibold rounded-full shadow-xl backdrop-blur-xl z-50 toast-enter whitespace-nowrap"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)' }}
        >
          {statusMessage}
        </div>
      )}

      {/* Main Screen Container */}
      <div className="flex-1 relative flex flex-col h-full overflow-hidden bg-stone-50 dark:bg-[#090A0C] text-stone-900 dark:text-stone-100">
          {/* TAB 1: Latest feed with optional source filtering */}
          {currentTab === 'stories' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* NEWSFEED (all sources, or the one source/tag selected) */}
              <div className="flex-1 relative h-full overflow-hidden">
                  {/* Status Bar subtle backdrop shield during scroll or when header is collapsed */}
                  <div
                    aria-hidden="true"
                    className={`absolute top-0 left-0 right-0 h-[max(env(safe-area-inset-top,0px),0.75rem)] z-20 pointer-events-none transition-opacity duration-300 scroll-glass-overlay ${
                      !isHeaderVisible || isScrolled ? 'opacity-100' : 'opacity-0'
                    }`}
                  />

                  {/* Frosted Glass Substack Newsfeed Header: gets blurry and transparent during scroll */}
                  <header
                    className={`feed-scroll-header absolute top-0 left-0 right-0 z-30 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-0 border-b border-stone-200/70 dark:border-stone-800/80 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      isScrolled ? 'is-scrolled backdrop-blur-xl' : 'bg-white/95 dark:bg-[#090A0C]/95'
                    } ${
                      isHeaderVisible
                        ? 'translate-y-0 opacity-100 pointer-events-auto shadow-xs'
                        : '-translate-y-full opacity-0 pointer-events-none'
                    }`}
                  >
                    {/* The source title becomes Newsfeed when browsing all feeds */}
                    <div className="flex items-center justify-between pt-1 mb-1.5">
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        {/* Substack signature orange bookmark glyph */}
                        <div className="w-5 h-6 bg-[#FF6719] rounded-[3px] flex items-center justify-center text-white font-serif font-black text-xs shadow-xs shrink-0 select-none">
                          চ
                        </div>
                        <div className="min-w-0">
                          <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100 truncate">
                            {selectedFeed?.title || 'Newsfeed'}
                          </h1>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Substack View Switcher: Magazine vs Compact List */}
                        <div className="flex items-center bg-stone-100 dark:bg-stone-800/80 p-0.5 rounded-lg mr-1 border border-stone-200/60 dark:border-stone-700/60">
                          <button
                            type="button"
                            onClick={() => setFeedViewMode('magazine')}
                            aria-label="Magazine View"
                            title="Substack Magazine View"
                            className={`p-1.5 rounded-md transition-colors ${
                              feedViewMode === 'magazine'
                                ? 'bg-white dark:bg-stone-700 text-[#FF6719] shadow-xs'
                                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
                            }`}
                          >
                            <LayoutList className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setFeedViewMode('compact')}
                            aria-label="Compact List View"
                            title="Compact Scanner View"
                            className={`p-1.5 rounded-md transition-colors ${
                              feedViewMode === 'compact'
                                ? 'bg-white dark:bg-stone-700 text-[#FF6719] shadow-xs'
                                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
                            }`}
                          >
                            <Rows3 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          onClick={() => setIsSearchOpen(!isSearchOpen)}
                          aria-label="Search stories"
                          className={`p-2 rounded-full transition-colors ${
                            isSearchOpen
                              ? 'bg-stone-200 dark:bg-stone-800 text-stone-900 dark:text-stone-100'
                              : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-100'
                          }`}
                        >
                          <Search className="w-4 h-4" />
                        </button>

                        <button
                          onClick={handleRefreshActive}
                          disabled={isRefreshing || isOffline}
                          aria-label="Refresh source feed"
                          title="Reload stories from source"
                          className="p-2 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors disabled:opacity-40"
                        >
                          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#FF6719]' : ''}`} />
                        </button>

                        <button
                          onClick={handleMarkSourceAsRead}
                          aria-label="Mark source as read"
                          title="Mark source stories as read"
                          className="p-2 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
                        >
                          <CheckCheck className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Collapsible Search Input */}
                    {isSearchOpen && (
                      <div className="mt-1 mb-2 animate-in fade-in duration-100">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                          <input
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={`Search in ${selectedFeed?.title || 'stories'}...`}
                            className="w-full pl-8 pr-3 py-1.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                          />
                        </div>
                      </div>
                    )}

                    {/* Substack Style Navigation Underline Tabs */}
                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-4 px-4 pt-1">
                      {[
                        { id: 'all', label: 'Home' },
                        { id: 'unread', label: `Unread (${activeSourceUnreadCount})` },
                        { id: 'bookmarked', label: 'Saved' },
                        { id: 'offline', label: 'Offline' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setFilterMode(tab.id as any)}
                          className={`relative pb-2.5 px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
                            filterMode === tab.id
                              ? 'text-stone-950 dark:text-stone-50 font-semibold'
                              : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                          }`}
                        >
                          <span>{tab.label}</span>
                          {filterMode === tab.id && (
                            <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#FF6719] rounded-full animate-in fade-in duration-150" />
                          )}
                        </button>
                      ))}
                    </div>
                  </header>

                  {/* Active Source's Articles Feed with Pull to Refresh & Scroll Fill */}
                  <PullToRefresh
                    className="h-full pt-[calc(max(env(safe-area-inset-top,0px),0.75rem)+5.5rem)] pb-28"
                    onScroll={handleFeedScroll}
                    onRefresh={handleRefreshActive}
                    isRefreshing={isRefreshing}
                    refreshFailed={refreshFailed}
                    disabled={isOffline}
                  >
                    <div className="divide-y divide-stone-200/50 dark:divide-stone-800/60">
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
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-200"
                        >
                          Show All Stories
                        </button>
                      </div>
                    )}
                  </PullToRefresh>
                </div>
            </div>
          )}

          {/* TAB: WRITE & DRAFT BLOG POSTS */}
          {currentTab === 'write' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-stone-50 dark:bg-[#090A0C]">
              <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-3 bg-white/95 dark:bg-[#090A0C]/95 backdrop-blur-xl border-b border-stone-200/70 dark:border-stone-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#FF6719]/15 flex items-center justify-center text-[#FF6719]">
                    <PenSquare className="w-4 h-4 stroke-[2.2]" />
                  </div>
                  <div>
                    <h1 className="font-serif text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                      Write & Publish
                    </h1>
                    <span className="text-[11px] text-stone-500 dark:text-stone-400 block -mt-0.5">
                      Draft posts & broadcast to newsfeed
                    </span>
                  </div>
                </div>

                <button
                  onClick={handlePublishPost}
                  disabled={!writeTitle.trim() || !writeContent.trim() || isPublishing}
                  className="px-3.5 py-1.5 bg-[#FF6719] hover:bg-[#ff5700] disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isPublishing ? 'Publishing...' : 'Publish'}</span>
                </button>
              </header>

              <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-4 no-scrollbar">
                {/* Draft Form Card */}
                <form onSubmit={handlePublishPost} className="p-4 rounded-2xl bg-white dark:bg-[#14161B] border border-stone-200/70 dark:border-stone-800/80 shadow-xs space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      Post Title <span className="text-[#FF6719]">*</span>
                    </label>
                    <input
                      type="text"
                      value={writeTitle}
                      onChange={(e) => setWriteTitle(e.target.value)}
                      placeholder="Story headline or travel dispatch..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/70 text-sm font-medium text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
                        Writer Name
                      </label>
                      <input
                        type="text"
                        value={writeAuthor}
                        onChange={(e) => setWriteAuthor(e.target.value)}
                        placeholder="Your name or pen name..."
                        className="w-full px-3 py-2 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/70 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
                        Destination / Region
                      </label>
                      <input
                        type="text"
                        value={writeLocation}
                        onChange={(e) => setWriteLocation(e.target.value)}
                        placeholder="e.g. Bandarban, Sunamganj..."
                        className="w-full px-3 py-2 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/70 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                      />
                    </div>
                  </div>

                  {/* Travel Group Selection with one-tap chips */}
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1.5">
                      Travel Group / Publication
                    </label>
                    <input
                      type="text"
                      value={writeGroup}
                      onChange={(e) => setWriteGroup(e.target.value)}
                      placeholder="e.g. Travelers of Bangladesh (TOB)..."
                      className="w-full px-3 py-2 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/70 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719] mb-1.5"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'Travelers of Bangladesh (TOB)',
                        'Chhayanaut Wanderers',
                        'Bengal Trekkers Guild',
                        'BD Travelers Club',
                        'Solo Explorer BD',
                      ].map((grp) => (
                        <button
                          key={grp}
                          type="button"
                          onClick={() => setWriteGroup(grp)}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors ${
                            writeGroup === grp
                              ? 'bg-emerald-600 text-white'
                              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
                          }`}
                        >
                          {grp}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Content Textarea */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
                        Story Paragraphs <span className="text-[#FF6719]">*</span>
                      </label>
                      <span className="text-[10px] text-stone-400">
                        {writeContent.trim().split(/\s+/).filter(Boolean).length} words · ~{calculateReadTime(writeContent)} min read
                      </span>
                    </div>
                    <textarea
                      rows={6}
                      value={writeContent}
                      onChange={(e) => setWriteContent(e.target.value)}
                      placeholder="Write your story, travelogue, reflections, or dispatch here. Separate paragraphs with an empty line..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/70 text-xs leading-relaxed text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                    />
                  </div>

                  {/* Cover Photo URL (Optional) with quick presets */}
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
                      Cover Photo URL (Optional)
                    </label>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-stone-400 shrink-0 ml-1" />
                      <input
                        type="url"
                        value={writeCoverImage}
                        onChange={(e) => setWriteCoverImage(e.target.value)}
                        placeholder="https://images.unsplash.com/..."
                        className="flex-1 px-3 py-1.5 rounded-xl bg-stone-100/70 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/70 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-stone-400">
                      <span>Presets:</span>
                      <button
                        type="button"
                        onClick={() =>
                          setWriteCoverImage(
                            'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=800&q=80'
                          )
                        }
                        className="underline hover:text-stone-200"
                      >
                        Hills
                      </button>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() =>
                          setWriteCoverImage(
                            'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80'
                          )
                        }
                        className="underline hover:text-stone-200"
                      >
                        Haor Waters
                      </button>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() =>
                          setWriteCoverImage(
                            'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80'
                          )
                        }
                        className="underline hover:text-stone-200"
                      >
                        Mountain Peak
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!writeTitle.trim() || !writeContent.trim() || isPublishing}
                    className="w-full py-2.5 bg-[#FF6719] hover:bg-[#ff5700] disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isPublishing ? 'Publishing Story...' : 'Publish to Newsfeed'}</span>
                  </button>
                </form>

                {/* Local State List: Published Stories by this device */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                      Your Published Stories ({userPosts.length})
                    </h2>
                    <span className="text-[11px] text-stone-400">Persisted locally in feed</span>
                  </div>

                  {userPosts.length === 0 ? (
                    <div className="p-6 rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 text-center text-xs text-stone-400">
                      <p>You haven’t published any stories yet.</p>
                      <p className="mt-1 text-[11px]">Draft a story above and tap Publish to see it broadcast in your newsfeed!</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userPosts.map((post) => (
                        <div
                          key={post.id}
                          onClick={() => setActiveArticle(post)}
                          className="p-3.5 rounded-2xl bg-white dark:bg-[#14161B] border border-stone-200/70 dark:border-stone-800/80 shadow-xs hover:border-[#FF6719]/40 transition-colors cursor-pointer flex items-start justify-between gap-3 group"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-semibold text-[#FF6719] block mb-0.5">
                              {post.feedTitle}
                            </span>
                            <h3 className="font-serif font-bold text-sm text-stone-900 dark:text-stone-100 line-clamp-1 mb-1 group-hover:text-[#FF6719] transition-colors">
                              {post.title}
                            </h3>
                            <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 leading-relaxed mb-2">
                              {post.summary}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-stone-400">
                              <span>By {post.author || 'You'}</span>
                              <span>·</span>
                              <span>{post.readTimeMin}m read</span>
                              <span>·</span>
                              <span className="text-emerald-500 font-medium">In Feed</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 pt-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveArticle(post);
                              }}
                              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-colors"
                              title="Read full story"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteUserPost(post.id, e)}
                              className="p-1.5 rounded-lg text-stone-400 hover:text-red-400 hover:bg-stone-800 transition-colors"
                              title="Delete story"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TAGS & CATEGORIES */}
          {currentTab === 'tags' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-3 bg-stone-50/95 dark:bg-[#090A0C]/95 backdrop-blur-xl border-b border-stone-200/60 dark:border-stone-800/60 flex items-center justify-between">
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
                  className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
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
                        setSelectedTagId(tag.id);
                        setCurrentTab('stories');
                      }}
                      className="p-3.5 rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-white/60 dark:bg-stone-800/40 hover:bg-white dark:hover:bg-stone-800 cursor-pointer transition-all shadow-xs"
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
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
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
              <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-3 bg-stone-50/95 dark:bg-[#090A0C]/95 backdrop-blur-xl border-b border-stone-200/60 dark:border-stone-800/60">
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
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-xs transition-colors"
                    title="Download full text of the newest stories for offline use"
                  >
                    <ArrowDownCircle className={`w-3.5 h-3.5 ${isCachingAll ? 'animate-pulse' : ''}`} />
                    <span>{isCachingAll ? 'Saving...' : 'Save All'}</span>
                  </button>
                </div>

                {/* Offline Status Banner */}
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between">
                  <div>
                    <span className="font-semibold block">Offline Reading Ready</span>
                    <span className="opacity-80 text-[11px]">
                      {articles.filter((a) => a.isOfflineCached).length} stories cached on device
                    </span>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-emerald-800 dark:text-emerald-300 font-bold">
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

          {/* TAB 4: NEWSPAPER SOURCES & DIRECT URL LOADER */}
          {currentTab === 'feeds' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-3 bg-stone-50/95 dark:bg-[#090A0C]/95 backdrop-blur-xl border-b border-stone-200/60 dark:border-stone-800/60">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                      Newspaper Sources
                    </h1>
                    <span className="text-xs text-stone-500">
                      Click any newspaper to load & read its feed
                    </span>
                  </div>

                  <button
                    onClick={() => setIsFeedModalOpen(true)}
                    className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Feed</span>
                  </button>
                </div>

                {/* Direct URL Reader input in Sources tab too */}
                <form onSubmit={handleLoadDirectUrl} className="mt-1">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={directUrlInput}
                      onChange={(e) => setDirectUrlInput(e.target.value)}
                      placeholder="Paste any BD portal or article URL to read..."
                      aria-label="Paste any portal or article URL"
                      className="flex-1 px-3 py-1.5 bg-white dark:bg-stone-800 rounded-xl text-xs border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                    />
                    <button
                      type="submit"
                      disabled={!directUrlInput.trim() || isLoadingDirectUrl}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold disabled:opacity-40 transition-colors shrink-0"
                    >
                      {isLoadingDirectUrl ? 'Loading...' : 'Load URL'}
                    </button>
                  </div>
                </form>
              </header>

              <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-3 no-scrollbar">
                {feeds.map((feed) => {
                  const feedArticles = articles.filter((a) => a.feedId === feed.id);
                  const unread = feedArticles.filter((a) => !a.isRead).length;

                  return (
                    <div
                      key={feed.id}
                      onClick={() => handleSelectSource(feed)}
                      className="p-3.5 rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-white/60 dark:bg-stone-800/40 hover:bg-white dark:hover:bg-stone-800 transition-all shadow-xs cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 pr-2">
                          <span className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 block truncate">
                            {feed.title}
                          </span>
                          <span className="text-[11px] text-stone-500 dark:text-stone-400 block truncate">
                            {feed.url}
                          </span>
                        </div>

                        <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
                          {feedArticles.length} stories
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-stone-200/60 dark:border-stone-800/60 text-xs text-stone-500">
                        <span>{unread} unread</span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSource(feed);
                            }}
                            className="text-emerald-700 dark:text-emerald-400 font-semibold"
                          >
                            Load Source Feed →
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFeed(feed.id);
                            }}
                            className="text-stone-400 hover:text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="pt-2 space-y-2">
                  <button
                    onClick={() => setIsFeedModalOpen(true)}
                    className="w-full py-3 rounded-2xl border border-dashed border-stone-300 dark:border-stone-700 text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                  >
                    + Discover & Add More Bangladeshi Newspapers
                  </button>

                  <button
                    onClick={() => setIsIosModalOpen(true)}
                    className="w-full py-3 rounded-2xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
                  >
                    <span>Export to GitHub & Build iOS .ipa</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom iOS Navigation Bar */}
          <TabBar
            currentTab={currentTab}
            isVisible={isHeaderVisible || currentTab !== 'stories'}
            onSelectTab={(tab) => {
              setCurrentTab(tab);
              setIsHeaderVisible(true);
              if (tab === 'stories') {
                setSelectedFeedId(null);
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
