import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  Check,
  Globe,
  Sparkles,
  Layers,
  ChevronRight,
  X,
} from 'lucide-react';
import type { Feed, FeedItem } from '../types';
import { SourceAvatar } from './SourceAvatar';
import { triggerHapticSelection, triggerHapticComplete, triggerHapticError } from '../utils/haptics';

interface SourcesSectionProps {
  feeds: Feed[];
  articles: FeedItem[];
  selectedFeedId: string | null;
  isRefreshing: boolean;
  isOffline: boolean;
  onSelectSource: (feed: Feed) => void;
  onSelectAllSources: () => void;
  onRefreshFeed: (feed: Feed) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onDeleteFeed: (feedId: string) => void;
  onAddFeed: (feed: Omit<Feed, 'id'>) => void;
  onOpenFeedModal: () => void;
  onLoadDirectUrl: (url: string) => void;
  isLoadingDirectUrl: boolean;
  onOpenIosModal: () => void;
}

const CURATED_PRESETS = [
  {
    title: 'The Daily Star',
    url: 'https://www.thedailystar.net/rss.xml',
    siteUrl: 'https://www.thedailystar.net',
    category: 'Bangladesh',
    tags: ['tag_bd', 'tag_investigative'],
  },
  {
    title: 'Prothom Alo (English)',
    url: 'https://en.prothomalo.com/feed',
    siteUrl: 'https://en.prothomalo.com',
    category: 'Bangladesh',
    tags: ['tag_bd', 'tag_world'],
  },
  {
    title: 'প্রথম আলো (Prothom Alo Bangla)',
    url: 'https://www.prothomalo.com/feed',
    siteUrl: 'https://www.prothomalo.com',
    category: 'Bangladesh',
    tags: ['tag_bd'],
  },
  {
    title: 'The Business Standard (TBS)',
    url: 'https://www.tbsnews.net',
    siteUrl: 'https://www.tbsnews.net',
    category: 'Finance',
    tags: ['tag_bd', 'tag_markets'],
  },
  {
    title: 'bdnews24.com',
    url: 'https://bdnews24.com',
    siteUrl: 'https://bdnews24.com',
    category: 'Bangladesh',
    tags: ['tag_bd', 'tag_breaking'],
  },
  {
    title: 'The Financial Express (BD)',
    url: 'https://thefinancialexpress.com.bd',
    siteUrl: 'https://thefinancialexpress.com.bd',
    category: 'Finance',
    tags: ['tag_bd', 'tag_markets'],
  },
  {
    title: 'Dhaka Tribune',
    url: 'https://www.dhakatribune.com',
    siteUrl: 'https://www.dhakatribune.com',
    category: 'Bangladesh',
    tags: ['tag_bd', 'tag_opinion'],
  },
  {
    title: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    siteUrl: 'https://bbc.com/news',
    category: 'World',
    tags: ['tag_world', 'tag_breaking'],
  },
  {
    title: 'The Guardian',
    url: 'https://www.theguardian.com/world/rss',
    siteUrl: 'https://theguardian.com',
    category: 'World',
    tags: ['tag_world', 'tag_opinion'],
  },
  {
    title: 'Bangladeshi Travel Dispatches',
    url: '/api/blogs',
    siteUrl: 'https://chinta.app/travel',
    category: 'Community',
    tags: ['tag_travel', 'tag_bd'],
  },
];

export const SourcesSection: React.FC<SourcesSectionProps> = ({
  feeds,
  articles,
  selectedFeedId,
  isRefreshing,
  isOffline,
  onSelectSource,
  onSelectAllSources,
  onRefreshFeed,
  onRefreshAll,
  onDeleteFeed,
  onAddFeed,
  onOpenFeedModal,
  onLoadDirectUrl,
  isLoadingDirectUrl,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);

  // Filtered feeds by search query
  const filteredFeeds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return feeds;
    return feeds.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.url.toLowerCase().includes(q) ||
        (f.category && f.category.toLowerCase().includes(q))
    );
  }, [feeds, searchQuery]);

  // Unsubscribed presets
  const availablePresets = useMemo(() => {
    const subscribedUrls = new Set(feeds.map((f) => f.url.toLowerCase().replace(/\/+$/, '')));
    return CURATED_PRESETS.filter((p) => {
      const cleanUrl = p.url.toLowerCase().replace(/\/+$/, '');
      return !subscribedUrls.has(cleanUrl);
    });
  }, [feeds]);

  const totalUnreadCount = useMemo(() => {
    return articles.filter((a) => !a.isRead).length;
  }, [articles]);

  const unreadCountByFeed = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of articles) {
      if (!a.isRead) {
        counts[a.feedId] = (counts[a.feedId] || 0) + 1;
      }
    }
    return counts;
  }, [articles]);

  const handleSelect = (feed: Feed) => {
    triggerHapticSelection();
    onSelectSource(feed);
  };

  const handleSelectAll = () => {
    triggerHapticSelection();
    onSelectAllSources();
  };

  const handleSingleRefresh = async (e: React.MouseEvent, feed: Feed) => {
    e.stopPropagation();
    triggerHapticSelection();
    setRefreshingFeedId(feed.id);
    try {
      await onRefreshFeed(feed);
      triggerHapticComplete();
    } catch {
      triggerHapticError();
    } finally {
      setRefreshingFeedId(null);
    }
  };

  const handleDelete = (e: React.MouseEvent, feed: Feed) => {
    e.stopPropagation();
    triggerHapticSelection();
    onDeleteFeed(feed.id);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = inputUrl.trim();
    if (!url) return;
    triggerHapticSelection();
    onLoadDirectUrl(url);
    setInputUrl('');
    setIsAddOpen(false);
  };

  const handleAddPreset = (preset: (typeof CURATED_PRESETS)[0]) => {
    triggerHapticSelection();
    onAddFeed({
      title: preset.title,
      url: preset.url,
      siteUrl: preset.siteUrl,
      category: preset.category,
      defaultTags: preset.tags,
      unreadCount: 0,
    });
    triggerHapticComplete();
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-stone-50 dark:bg-[#090A0C]">
      {/* Minimal Apple Navigation Bar */}
      <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2.5 bg-white/80 dark:bg-[#090A0C]/80 backdrop-blur-2xl border-b border-stone-200/60 dark:border-white/[0.06] z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-baseline gap-2">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Sources
            </h1>
            <span className="text-xs text-stone-400 font-mono">
              {feeds.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                triggerHapticSelection();
                onRefreshAll();
              }}
              disabled={isRefreshing || isOffline}
              aria-label="Refresh all sources"
              title="Refresh all"
              className="p-2 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors disabled:opacity-40 active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#FF6719]' : ''}`} />
            </button>

            <button
              onClick={() => {
                triggerHapticSelection();
                setIsAddOpen(!isAddOpen);
              }}
              aria-label="Add source"
              title="Add source"
              className="p-2 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors active:scale-95"
            >
              {isAddOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4 stroke-[2.2]" />}
            </button>
          </div>
        </div>

        {/* Compact Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sources..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-stone-100 dark:bg-stone-900 border border-transparent dark:border-white/[0.06] text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
          />
        </div>
      </header>

      {/* Main List Area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28 space-y-3 no-scrollbar">
        {/* Minimal Add Input (Collapsible) */}
        {isAddOpen && (
          <form
            onSubmit={handleAddSubmit}
            className="p-3 rounded-2xl liquid-glass border border-[#FF6719]/30 shadow-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            <input
              type="text"
              required
              autoFocus
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Paste newspaper portal or RSS URL..."
              className="flex-1 px-3 py-1.5 text-xs bg-transparent text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!inputUrl.trim() || isLoadingDirectUrl}
              className="px-3 py-1.5 bg-[#FF6719] hover:bg-[#FF5500] text-white rounded-xl text-xs font-semibold disabled:opacity-40 transition-colors shrink-0 shadow-xs active:scale-95"
            >
              {isLoadingDirectUrl ? 'Loading...' : 'Add'}
            </button>
          </form>
        )}

        {/* Unified Stream / All Feeds Row */}
        <div
          onClick={handleSelectAll}
          role="button"
          tabIndex={0}
          className={`p-3 rounded-2xl liquid-glass liquid-glass-interactive cursor-pointer flex items-center justify-between transition-all ${
            !selectedFeedId
              ? 'ring-1.5 ring-[#FF6719] shadow-[0_2px_12px_rgba(255,103,25,0.15)]'
              : 'hover:shadow-xs'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
                !selectedFeedId
                  ? 'bg-[#FF6719] text-white'
                  : 'bg-stone-200/80 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
              }`}
            >
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 block truncate">
                All Feeds
              </span>
              <span className="text-[11px] text-stone-400 block -mt-0.5">
                Unified newspaper stream
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {totalUnreadCount > 0 && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                {totalUnreadCount}
              </span>
            )}
            {!selectedFeedId ? (
              <Check className="w-4 h-4 text-[#FF6719]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-stone-400" />
            )}
          </div>
        </div>

        {/* Subscribed Feeds Group */}
        <div className="rounded-2xl liquid-glass overflow-hidden divide-y divide-stone-200/50 dark:divide-white/[0.06] border border-white/40 dark:border-white/[0.08] shadow-xs">
          {filteredFeeds.map((feed) => {
            const isSelected = selectedFeedId === feed.id;
            const unread = unreadCountByFeed[feed.id] || 0;
            const isThisRefreshing = refreshingFeedId === feed.id;

            return (
              <div
                key={feed.id}
                onClick={() => handleSelect(feed)}
                role="button"
                tabIndex={0}
                className={`group px-3.5 py-3 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                  isSelected
                    ? 'bg-[#FF6719]/8 dark:bg-[#FF6719]/12'
                    : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <SourceAvatar name={feed.title} url={feed.url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <span className="font-serif font-medium text-sm text-stone-900 dark:text-stone-100 block truncate leading-snug">
                      {feed.title}
                    </span>
                    <span className="text-[11px] text-stone-400 dark:text-stone-500 block truncate">
                      {feed.category || 'Newspaper'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {unread > 0 && (
                    <span
                      className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                        isSelected
                          ? 'bg-[#FF6719] text-white'
                          : 'bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
                      }`}
                    >
                      {unread}
                    </span>
                  )}

                  {/* Quick Refresh Icon */}
                  <button
                    type="button"
                    onClick={(e) => handleSingleRefresh(e, feed)}
                    disabled={isThisRefreshing || isOffline}
                    title="Refresh this feed"
                    className="p-1 rounded-md text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isThisRefreshing ? 'animate-spin text-[#FF6719]' : ''}`} />
                  </button>

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, feed)}
                    title="Remove source"
                    className="p-1 rounded-md text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {isSelected && (
                    <Check className="w-4 h-4 text-[#FF6719] shrink-0" />
                  )}
                </div>
              </div>
            );
          })}

          {filteredFeeds.length === 0 && (
            <div className="py-8 text-center text-xs text-stone-400">
              No sources found.
            </div>
          )}
        </div>

        {/* Minimal Curated Discovery Section (Togglable) */}
        {availablePresets.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => {
                triggerHapticSelection();
                setShowPresets(!showPresets);
              }}
              className="w-full py-2.5 px-3 rounded-xl text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 transition-colors flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#FF6719]" />
                Discover more news sources ({availablePresets.length})
              </span>
              <span className="text-[11px] font-semibold text-[#FF6719]">
                {showPresets ? 'Hide' : 'Show'}
              </span>
            </button>

            {showPresets && (
              <div className="mt-2 rounded-2xl liquid-glass overflow-hidden divide-y divide-stone-200/50 dark:divide-white/[0.06] border border-white/40 dark:border-white/[0.08] shadow-xs animate-in fade-in duration-150">
                {availablePresets.map((preset) => (
                  <div
                    key={preset.url}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <SourceAvatar name={preset.title} url={preset.url} size="sm" />
                      <div className="min-w-0">
                        <span className="font-serif font-medium text-xs text-stone-900 dark:text-stone-100 block truncate">
                          {preset.title}
                        </span>
                        <span className="text-[10px] text-stone-400 block truncate">
                          {preset.category}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleAddPreset(preset)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 active:scale-95 transition-all flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3 stroke-[2.5]" />
                      <span>Add</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Minimal OPML / Settings Link */}
        <div className="pt-2 text-center">
          <button
            onClick={() => {
              triggerHapticSelection();
              onOpenFeedModal();
            }}
            className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          >
            Import or Export OPML Subscriptions
          </button>
        </div>
      </div>
    </div>
  );
};
