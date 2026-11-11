import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  Check,
  Folder,
  FolderPlus,
  FolderInput,
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
  onMoveFeedToFolder: (feedId: string, folderName: string) => void;
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
  onMoveFeedToFolder,
  onRefreshFeed,
  onRefreshAll,
  onDeleteFeed,
  onAddFeed,
  onOpenFeedModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [inputTitle, setInputTitle] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);

  // Source currently being moved between folders
  const [movingFeed, setMovingFeed] = useState<Feed | null>(null);
  const [moveNewFolderName, setMoveNewFolderName] = useState('');
  const [isCreatingFolderInMove, setIsCreatingFolderInMove] = useState(false);

  // All named folders (persisted folders + any non-empty categories on feeds)
  const allFolders = useMemo(() => {
    const set = new Set<string>();
    for (const folder of folders) {
      if (folder && folder.trim()) set.add(folder.trim());
    }
    for (const f of feeds) {
      if (f.category && f.category.trim()) {
        set.add(f.category.trim());
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

  // Uncategorized sources (not assigned to any folder)
  const uncategorizedFeeds = useMemo(() => {
    return filteredFeeds.filter((f) => !f.category || !f.category.trim());
  }, [filteredFeeds]);

  // Group categorized feeds by folder
  const groupedByFolder = useMemo(() => {
    const map = new Map<string, Feed[]>();
    for (const folder of allFolders) {
      map.set(folder, []);
    }
    for (const feed of filteredFeeds) {
      const folder = feed.category?.trim();
      if (!folder) continue;
      if (!map.has(folder)) {
        map.set(folder, []);
      }
      map.get(folder)!.push(feed);
    }
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

  const handleOpenMoveMenu = (e: React.MouseEvent, feed: Feed) => {
    e.stopPropagation();
    triggerHapticSelection();
    setMovingFeed(feed);
    setIsCreatingFolderInMove(false);
    setMoveNewFolderName('');
  };

  // Add source without forcing any categorization or folder
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = inputUrl.trim();
    if (!rawUrl) return;

    triggerHapticSelection();

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
      category: '',
      defaultTags: [],
      unreadCount: 0,
    });

    setInputUrl('');
    setInputTitle('');
    setIsAddOpen(false);
    triggerHapticComplete();
  };

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    triggerHapticComplete();
    onCreateFolder(trimmed);
    setNewFolderName('');
    setIsNewFolderOpen(false);
  };

  const renderSourceRow = (feed: Feed, indented = false) => {
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
        className={`px-3.5 py-2.5 flex items-center justify-between gap-2 cursor-pointer select-none transition-colors ${
          isSelected
            ? 'bg-[#FF6719]/8 dark:bg-[#FF6719]/12'
            : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
        }`}
      >
        <div className={`flex items-center gap-3 min-w-0 flex-1 ${indented ? 'pl-2' : ''}`}>
          <SourceAvatar name={feed.title} url={feed.url} size="sm" />
          <div className="min-w-0 flex-1">
            <span className="font-serif font-medium text-sm text-stone-900 dark:text-stone-100 truncate block">
              {feed.title}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {unread > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-stone-400 dark:text-stone-500 mr-1">
              {unread}
            </span>
          )}

          {/* Move to Folder button */}
          <button
            type="button"
            onClick={(e) => handleOpenMoveMenu(e, feed)}
            title="Move source to another folder"
            aria-label={`Move ${feed.title} to folder`}
            className="p-1.5 rounded-lg text-stone-400 hover:text-[#FF6719] dark:hover:text-[#FF6719] transition-colors"
          >
            <FolderInput className="w-3.5 h-3.5" />
          </button>

          {/* Refresh single source */}
          <button
            type="button"
            onClick={(e) => handleSingleRefresh(e, feed)}
            disabled={isThisRefreshing || isOffline}
            title="Refresh source"
            aria-label={`Refresh ${feed.title}`}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isThisRefreshing ? 'animate-spin text-[#FF6719]' : ''}`}
            />
          </button>

          {/* Remove source */}
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
  };

  return (
    <div className="flex-1 relative flex flex-col h-full overflow-hidden bg-stone-50 dark:bg-[#090A0C]">
      {/* Progressive Atmospheric Top Blur Mask */}
      <div
        aria-hidden="true"
        className="top-progressive-blur absolute top-0 left-0 right-0 h-28 z-10 pointer-events-none"
      />

      {/* Floating Top 3D Liquid Glass Controls */}
      <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2.5 z-20 space-y-2.5">
        <div className="flex items-center justify-between gap-2 pt-1">
          {/* Top-Left: Floating 3D Liquid Glass Title Pill */}
          <div className="liquid-glass-pill h-12 px-4 rounded-full flex items-center gap-2.5">
            <h1 className="font-serif text-lg font-bold tracking-tight text-stone-900 dark:text-white">
              Sources
            </h1>
            <span className="text-xs text-stone-500 dark:text-stone-300 font-mono tabular-nums">
              {feeds.length}
            </span>
          </div>

          {/* Top-Right: Floating 3D Liquid Glass Action Pill */}
          <div className="liquid-glass-pill h-12 px-2.5 rounded-full flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                onRefreshAll();
              }}
              disabled={isRefreshing || isOffline}
              aria-label="Refresh all sources"
              title="Refresh all"
              className="w-9 h-9 flex items-center justify-center rounded-full text-stone-800 dark:text-white transition-transform disabled:opacity-40 active:scale-90"
            >
              <RefreshCw
                className={`w-4 h-4 stroke-[2] ${isRefreshing ? 'animate-spin text-[#FF6719]' : ''}`}
              />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setIsNewFolderOpen(!isNewFolderOpen);
                setIsAddOpen(false);
              }}
              aria-label="Create new folder"
              title="New Folder"
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                isNewFolderOpen
                  ? 'bg-[#FF6719] text-white shadow-sm'
                  : 'text-stone-800 dark:text-white'
              }`}
            >
              <FolderPlus className="w-4 h-4 stroke-[2]" />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setIsAddOpen(!isAddOpen);
                setIsNewFolderOpen(false);
              }}
              aria-label="Add source"
              title="Add source"
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                isAddOpen
                  ? 'bg-[#FF6719] text-white shadow-sm'
                  : 'text-stone-800 dark:text-white'
              }`}
            >
              {isAddOpen ? (
                <X className="w-4 h-4 stroke-[2.2]" />
              ) : (
                <Plus className="w-4 h-4 stroke-[2.4]" />
              )}
            </button>
          </div>
        </div>

        {/* Floating 3D Liquid Glass Search Capsule */}
        <div className="liquid-glass-pill rounded-full px-3.5 py-2 flex items-center gap-2">
          <Search className="w-4 h-4 text-stone-500 dark:text-stone-300 shrink-0 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter folders or sources..."
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
        </div>
      </header>

      {/* Main Scrollable Folder & Source List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 pb-28 space-y-3.5 no-scrollbar">
        {/* Create Folder Form */}
        {isNewFolderOpen && (
          <form
            onSubmit={handleCreateFolderSubmit}
            className="p-3.5 rounded-2xl liquid-glass border border-[#FF6719]/30 shadow-sm space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                Create Folder
              </span>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                Cancel
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name (e.g. Tech, Opinion)..."
                className="flex-1 px-3 py-2 rounded-xl text-xs bg-white/80 dark:bg-black/40 border border-stone-200/80 dark:border-white/[0.08] text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
              />
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="px-4 py-2 bg-[#FF6719] hover:bg-[#FF5500] text-white rounded-xl text-xs font-semibold disabled:opacity-40 transition-all shadow-xs"
              >
                Create
              </button>
            </div>
          </form>
        )}

        {/* Add Source Card — Does NOT force any categorization or folder */}
        {isAddOpen && (
          <form
            onSubmit={handleAddSubmit}
            className="p-3.5 rounded-2xl liquid-glass border border-[#FF6719]/30 shadow-sm space-y-3 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                Add Newspaper or Blog
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
                placeholder="Website or RSS URL (e.g. economist.com or bdnews24.com)"
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

            <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-snug">
              Searches automatically for an RSS feed across URL combinations; if none is found, the website URL is added directly.
            </p>

            <button
              type="submit"
              disabled={!inputUrl.trim()}
              className="w-full py-2.5 bg-[#FF6719] hover:bg-[#FF5500] text-white rounded-xl text-xs font-semibold disabled:opacity-40 transition-all shadow-xs active:scale-[0.98]"
            >
              Add Source
            </button>
          </form>
        )}

        {/* Uncategorized Sources (Added without forced folder categorization) */}
        {uncategorizedFeeds.length > 0 && (
          <section className="rounded-2xl liquid-glass overflow-hidden divide-y divide-stone-200/40 dark:divide-white/[0.05]">
            {uncategorizedFeeds.map((feed) => renderSourceRow(feed, false))}
          </section>
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
                  {folderFeeds.map((feed) => renderSourceRow(feed, true))}

                  {folderFeeds.length === 0 && (
                    <div className="px-4 py-3 text-xs text-stone-400">
                      Empty folder — tap the folder icon on any source to move it here.
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {groupedByFolder.length === 0 && uncategorizedFeeds.length === 0 && (
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

      {/* Liquid Glass Modal to Move a Source from One Folder to Another */}
      {movingFeed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setMovingFeed(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs liquid-glass rounded-3xl p-4 shadow-2xl border border-white/30 dark:border-white/15 text-stone-900 dark:text-stone-100 space-y-3 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-stone-200/60 dark:border-white/10">
              <div className="min-w-0 pr-2">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-stone-400 block">
                  Move Source
                </span>
                <span className="font-serif font-semibold text-sm truncate block">
                  {movingFeed.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMovingFeed(null)}
                className="p-1 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto no-scrollbar">
              {/* Option: No Folder (Uncategorized) */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticComplete();
                  onMoveFeedToFolder(movingFeed.id, '');
                  setMovingFeed(null);
                }}
                className={`w-full px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                  !movingFeed.category?.trim()
                    ? 'bg-[#FF6719]/15 text-[#FF6719] font-semibold'
                    : 'hover:bg-stone-200/60 dark:hover:bg-white/[0.06] text-stone-600 dark:text-stone-300'
                }`}
              >
                <span>No Folder (Uncategorized)</span>
                {!movingFeed.category?.trim() && <Check className="w-3.5 h-3.5 text-[#FF6719]" />}
              </button>

              {/* Existing Folders */}
              {allFolders.map((folder) => {
                const isCurrent = (movingFeed.category?.trim() || '') === folder;
                return (
                  <button
                    key={folder}
                    type="button"
                    onClick={() => {
                      triggerHapticComplete();
                      onMoveFeedToFolder(movingFeed.id, folder);
                      setMovingFeed(null);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                      isCurrent
                        ? 'bg-[#FF6719]/15 text-[#FF6719] font-semibold'
                        : 'hover:bg-stone-200/60 dark:hover:bg-white/[0.06] text-stone-800 dark:text-stone-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className="w-3.5 h-3.5 text-[#FF6719] shrink-0" />
                      <span className="truncate">{folder}</span>
                    </div>
                    {isCurrent && <Check className="w-3.5 h-3.5 text-[#FF6719] shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Option to create a new folder and move into it */}
            <div className="pt-2 border-t border-stone-200/60 dark:border-white/10">
              {isCreatingFolderInMove ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!moveNewFolderName.trim()) return;
                    triggerHapticComplete();
                    onMoveFeedToFolder(movingFeed.id, moveNewFolderName.trim());
                    setMovingFeed(null);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    autoFocus
                    value={moveNewFolderName}
                    onChange={(e) => setMoveNewFolderName(e.target.value)}
                    placeholder="New folder name..."
                    className="flex-1 px-2.5 py-1.5 rounded-xl text-xs bg-white/80 dark:bg-black/40 border border-[#FF6719]/50 text-stone-900 dark:text-stone-100 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!moveNewFolderName.trim()}
                    className="px-3 py-1.5 bg-[#FF6719] text-white rounded-xl text-xs font-semibold disabled:opacity-40"
                  >
                    Move
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCreatingFolderInMove(true)}
                  className="w-full py-1.5 text-xs font-semibold text-[#FF6719] flex items-center justify-center gap-1.5 hover:opacity-80"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>+ Move to New Folder</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
