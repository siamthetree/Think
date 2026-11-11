import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  Check,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  X,
} from 'lucide-react';
import type { Feed, FeedItem } from '../types';
import { SourceAvatar } from './SourceAvatar';
import { triggerHapticSelection, triggerHapticComplete, triggerHapticError } from '../utils/haptics';

interface SourcesSectionProps {
  feeds: Feed[];
  articles: FeedItem[];
  folders: string[];
  selectedFeedId: string | null;
  selectedFolder: string | null;
  isRefreshing: boolean;
  isOffline: boolean;
  onSelectSource: (feed: Feed) => void;
  onSelectFolder: (folderName: string) => void;
  onCreateFolder: (folderName: string) => void;
  onRefreshFeed: (feed: Feed) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onDeleteFeed: (feedId: string) => void;
  onAddFeed: (feed: Omit<Feed, 'id'>) => void;
  onOpenFeedModal: () => void;
  onLoadDirectUrl: (url: string, folderName?: string, customTitle?: string) => void;
  isLoadingDirectUrl: boolean;
  onOpenIosModal: () => void;
}

export const SourcesSection: React.FC<SourcesSectionProps> = ({
  feeds,
  articles,
  folders,
  selectedFeedId,
  selectedFolder,
  isRefreshing,
  isOffline,
  onSelectSource,
  onSelectFolder,
  onCreateFolder,
  onRefreshFeed,
  onRefreshAll,
  onDeleteFeed,
  onAddFeed,
  onOpenFeedModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [inputTitle, setInputTitle] = useState('');
  const [selectedFolderForNew, setSelectedFolderForNew] = useState<string>(
    folders[0] || 'Bangladesh'
  );
  const [isCreatingNewFolder, setIsCreatingNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);

  // Combine persisted folders + any categories present on feeds
  const allFolders = useMemo(() => {
    const set = new Set<string>(folders);
    for (const f of feeds) {
      if (f.category && f.category.trim()) {
        set.add(f.category.trim());
      } else {
        set.add('General');
      }
    }
    return Array.from(set);
  }, [folders, feeds]);

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

  // Unread counts per feed
  const unreadCountByFeed = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of articles) {
      if (!a.isRead) {
        counts[a.feedId] = (counts[a.feedId] || 0) + 1;
      }
    }
    return counts;
  }, [articles]);

  // Group filtered feeds by folder
  const groupedByFolder = useMemo(() => {
    const map = new Map<string, Feed[]>();
    for (const folder of allFolders) {
      map.set(folder, []);
    }
    for (const feed of filteredFeeds) {
      const folder = feed.category?.trim() || 'General';
      if (!map.has(folder)) {
        map.set(folder, []);
      }
      map.get(folder)!.push(feed);
    }
    // When searching, hide empty folders; otherwise show all folders that have feeds or were explicitly created
    return Array.from(map.entries()).filter(
      ([, list]) => list.length > 0 || (!searchQuery.trim() && folders.length > 0)
    );
  }, [allFolders, filteredFeeds, searchQuery, folders]);

  const toggleFolderCollapse = (e: React.MouseEvent, folderName: string) => {
    e.stopPropagation();
    triggerHapticSelection();
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  const handleFolderClick = (folderName: string) => {
    triggerHapticSelection();
    onSelectFolder(folderName);
  };

  const handleSelectFeed = (feed: Feed) => {
    triggerHapticSelection();
    onSelectSource(feed);
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
    const rawUrl = inputUrl.trim();
    if (!rawUrl) return;

    triggerHapticSelection();

    let targetFolder = selectedFolderForNew.trim() || 'Bangladesh';
    if (isCreatingNewFolder && newFolderName.trim()) {
      targetFolder = newFolderName.trim();
      onCreateFolder(targetFolder);
    }

    const formattedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let cleanTitle = inputTitle.trim();
    if (!cleanTitle) {
      try {
        const u = new URL(formattedUrl);
        cleanTitle = u.hostname.replace(/^www\./, '');
      } catch {
        cleanTitle = 'Newspaper Source';
      }
    }

    onAddFeed({
      title: cleanTitle,
      url: formattedUrl,
      siteUrl: formattedUrl,
      category: targetFolder,
      defaultTags: ['tag_bd'],
      unreadCount: 0,
    });

    setInputUrl('');
    setInputTitle('');
    setNewFolderName('');
    setIsCreatingNewFolder(false);
    setIsAddOpen(false);
    triggerHapticComplete();
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-stone-50 dark:bg-[#090A0C]">
      {/* Minimal iOS 26 Liquid Glass Navigation Header */}
      <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2.5 liquid-glass-header border-b border-stone-200/60 dark:border-white/[0.07] z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-baseline gap-2">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Sources
            </h1>
            <span className="text-xs text-stone-400 font-mono tabular-nums">
              {feeds.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                onRefreshAll();
              }}
              disabled={isRefreshing || isOffline}
              aria-label="Refresh all sources"
              title="Refresh all"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors disabled:opacity-40 active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#FF6719]' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setIsAddOpen(!isAddOpen);
              }}
              aria-label="Add source or folder"
              title="Add source or folder"
              className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full transition-colors active:scale-95 ${
                isAddOpen
                  ? 'bg-[#FF6719] text-white'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {isAddOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4 stroke-[2.2]" />}
            </button>
          </div>
        </div>

        {/* Minimal Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter folders or sources..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-stone-200/60 dark:bg-white/[0.06] border border-transparent dark:border-white/[0.06] text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
          />
        </div>
      </header>

      {/* Main Scrollable Folder & Source List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-28 space-y-3.5 no-scrollbar">
        {/* Collapsible Add Source + Folder Creation Card */}
        {isAddOpen && (
          <form
            onSubmit={handleAddSubmit}
            className="p-3.5 rounded-2xl liquid-glass border border-[#FF6719]/30 shadow-sm space-y-3 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                Add News Source
              </span>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                required
                autoFocus
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Website or RSS URL (e.g. bdnews24.com)"
                className="w-full px-3 py-2 rounded-xl text-xs bg-white/80 dark:bg-black/40 border border-stone-200/80 dark:border-white/[0.08] text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
              />

              <input
                type="text"
                value={inputTitle}
                onChange={(e) => setInputTitle(e.target.value)}
                placeholder="Source Title (optional)"
                className="w-full px-3 py-2 rounded-xl text-xs bg-white/80 dark:bg-black/40 border border-stone-200/80 dark:border-white/[0.08] text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
              />
            </div>

            {/* Folder Selection & New Folder Creation */}
            <div className="space-y-2 pt-0.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-[#FF6719]" />
                  <span>Folder</span>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setIsCreatingNewFolder(!isCreatingNewFolder);
                  }}
                  className="text-[11px] font-semibold text-[#FF6719] flex items-center gap-1 hover:opacity-80"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>{isCreatingNewFolder ? 'Choose Existing' : '+ New Folder'}</span>
                </button>
              </div>

              {isCreatingNewFolder ? (
                <input
                  type="text"
                  required
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Enter new folder name (e.g. Tech, Politics)..."
                  className="w-full px-3 py-2 rounded-xl text-xs bg-white/80 dark:bg-black/40 border border-[#FF6719]/50 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
                />
              ) : (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                  {allFolders.map((folder) => {
                    const isPicked = selectedFolderForNew === folder;
                    return (
                      <button
                        key={folder}
                        type="button"
                        onClick={() => {
                          triggerHapticSelection();
                          setSelectedFolderForNew(folder);
                        }}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                          isPicked
                            ? 'bg-[#FF6719] text-white font-semibold shadow-xs'
                            : 'bg-stone-200/70 dark:bg-white/[0.06] text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                        }`}
                      >
                        {folder}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!inputUrl.trim() || (isCreatingNewFolder && !newFolderName.trim())}
              className="w-full py-2.5 bg-[#FF6719] hover:bg-[#FF5500] text-white rounded-xl text-xs font-semibold disabled:opacity-40 transition-all shadow-xs active:scale-[0.98]"
            >
              Add Source to {isCreatingNewFolder ? newFolderName.trim() || 'New Folder' : selectedFolderForNew}
            </button>
          </form>
        )}

        {/* Folders & Their Sources */}
        {groupedByFolder.map(([folderName, folderFeeds]) => {
          const isCollapsed = Boolean(collapsedFolders[folderName]);
          const isFolderSelected = selectedFolder === folderName && !selectedFeedId;
          const folderUnread = folderFeeds.reduce(
            (sum, f) => sum + (unreadCountByFeed[f.id] || 0),
            0
          );

          return (
            <section
              key={folderName}
              className={`rounded-2xl liquid-glass overflow-hidden transition-all ${
                isFolderSelected
                  ? 'ring-1.5 ring-[#FF6719] shadow-[0_4px_20px_rgba(255,103,25,0.15)]'
                  : ''
              }`}
            >
              {/* Folder Row — Clicking opens Newsfeed filtered to this folder's sources */}
              <div
                onClick={() => handleFolderClick(folderName)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleFolderClick(folderName);
                  }
                }}
                className={`px-3.5 py-2.5 flex items-center justify-between gap-2 cursor-pointer select-none border-b border-stone-200/50 dark:border-white/[0.06] transition-colors ${
                  isFolderSelected
                    ? 'bg-[#FF6719]/10 dark:bg-[#FF6719]/15'
                    : 'bg-stone-100/50 dark:bg-white/[0.02] hover:bg-stone-200/40 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={(e) => toggleFolderCollapse(e, folderName)}
                    aria-label={isCollapsed ? `Expand ${folderName}` : `Collapse ${folderName}`}
                    className="p-1 -ml-1 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <Folder
                    className={`w-4 h-4 shrink-0 ${
                      isFolderSelected ? 'text-[#FF6719]' : 'text-stone-500 dark:text-stone-400'
                    }`}
                  />

                  <span className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 truncate">
                    {folderName}
                  </span>

                  <span className="text-[11px] text-stone-400 font-mono tabular-nums">
                    ({folderFeeds.length})
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {folderUnread > 0 && (
                    <span className="text-[11px] font-mono tabular-nums text-stone-500 dark:text-stone-400">
                      {folderUnread} unread
                    </span>
                  )}
                  <span className="text-[11px] font-medium text-[#FF6719] flex items-center gap-0.5">
                    <span>Read</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>

              {/* Sources Inside Folder */}
              {!isCollapsed && (
                <div className="divide-y divide-stone-200/40 dark:divide-white/[0.05]">
                  {folderFeeds.map((feed) => {
                    const isSelected = selectedFeedId === feed.id;
                    const unread = unreadCountByFeed[feed.id] || 0;
                    const isThisRefreshing = refreshingFeedId === feed.id;

                    return (
                      <div
                        key={feed.id}
                        onClick={() => handleSelectFeed(feed)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectFeed(feed);
                          }
                        }}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                          isSelected
                            ? 'bg-[#FF6719]/8 dark:bg-[#FF6719]/12'
                            : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 pl-2">
                          <SourceAvatar name={feed.title} url={feed.url} size="sm" />
                          <span className="font-serif font-medium text-sm text-stone-900 dark:text-stone-100 truncate">
                            {feed.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {unread > 0 && (
                            <span className="text-[11px] font-mono tabular-nums text-stone-400 dark:text-stone-500 mr-1">
                              {unread}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={(e) => handleSingleRefresh(e, feed)}
                            disabled={isThisRefreshing || isOffline}
                            title="Refresh source"
                            aria-label={`Refresh ${feed.title}`}
                            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                isThisRefreshing ? 'animate-spin text-[#FF6719]' : ''
                              }`}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, feed)}
                            title="Remove source"
                            aria-label={`Remove ${feed.title}`}
                            className="p-1.5 rounded-lg text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>

                          {isSelected && <Check className="w-4 h-4 text-[#FF6719] shrink-0" />}
                        </div>
                      </div>
                    );
                  })}

                  {folderFeeds.length === 0 && (
                    <div className="px-4 py-3 text-xs text-stone-400 flex items-center justify-between">
                      <span>Empty folder</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFolderForNew(folderName);
                          setIsCreatingNewFolder(false);
                          setIsAddOpen(true);
                        }}
                        className="text-[#FF6719] font-medium hover:underline"
                      >
                        + Add source here
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {groupedByFolder.length === 0 && (
          <div className="py-12 text-center text-xs text-stone-400">
            No matching sources found.
          </div>
        )}

        {/* Minimal OPML Link */}
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onOpenFeedModal();
            }}
            className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          >
            Manage Folders & OPML Subscriptions
          </button>
        </div>
      </div>
    </div>
  );
};
