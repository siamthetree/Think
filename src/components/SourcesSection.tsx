import React, { useState, useMemo, useRef } from 'react';
import {
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
  Globe,
  Loader2,
  Search,
  Cloud,
  LogOut,
  CheckCircle2,
} from 'lucide-react';
import type { Feed, FeedItem } from '../types';
import { useFirebase } from '../contexts/FirebaseContext';
import { SourceAvatar } from './SourceAvatar';
import {
  triggerHapticSelection,
  triggerHapticPull,
  triggerHapticDisarm,
  triggerHapticComplete,
  triggerHapticError,
} from '../utils/haptics';
import {
  computeSwipeActionState,
  computeReleaseVelocity,
  shouldCommitSwipeAction,
  type SwipeActionState,
  type GestureAxisLock,
  type VelocitySample,
} from '../utils/touchGestures';

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
  onAddFeed: (feed: Omit<Feed, 'id'>) => void | Promise<void>;
  onOpenFeedModal: () => void;
  onLoadDirectUrl: (url: string, folderName?: string, customTitle?: string) => void;
  isLoadingDirectUrl: boolean;
  onOpenIosModal: () => void;
  onSyncNow?: () => Promise<void>;
}

interface QuickAddSourcePreset {
  title: string;
  domain: string;
  url: string;
  siteUrl: string;
  defaultTags: string[];
}

const QUICK_ADD_PRESETS: QuickAddSourcePreset[] = [
  {
    title: 'The Daily Star',
    domain: 'thedailystar.net',
    url: 'https://www.thedailystar.net/rss.xml',
    siteUrl: 'https://www.thedailystar.net',
    defaultTags: ['tag_bd', 'tag_investigative'],
  },
  {
    title: 'Prothom Alo',
    domain: 'en.prothomalo.com',
    url: 'https://en.prothomalo.com/feed',
    siteUrl: 'https://en.prothomalo.com',
    defaultTags: ['tag_bd'],
  },
  {
    title: 'The Business Standard',
    domain: 'tbsnews.net',
    url: 'https://www.tbsnews.net/top-news/rss.xml',
    siteUrl: 'https://www.tbsnews.net',
    defaultTags: ['tag_bd', 'tag_markets'],
  },
  {
    title: 'Dhaka Tribune',
    domain: 'dhakatribune.com',
    url: 'https://www.dhakatribune.com',
    siteUrl: 'https://www.dhakatribune.com',
    defaultTags: ['tag_bd', 'tag_opinion'],
  },
  {
    title: 'bdnews24.com',
    domain: 'bdnews24.com',
    url: 'https://bdnews24.com',
    siteUrl: 'https://bdnews24.com',
    defaultTags: ['tag_bd', 'tag_breaking'],
  },
  {
    title: 'Financial Express',
    domain: 'thefinancialexpress.com.bd',
    url: 'https://thefinancialexpress.com.bd',
    siteUrl: 'https://thefinancialexpress.com.bd',
    defaultTags: ['tag_bd', 'tag_markets'],
  },
  {
    title: 'BBC News',
    domain: 'bbc.com',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    siteUrl: 'https://www.bbc.com/news',
    defaultTags: ['tag_world', 'tag_breaking'],
  },
  {
    title: 'Al Jazeera',
    domain: 'aljazeera.com',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    siteUrl: 'https://www.aljazeera.com',
    defaultTags: ['tag_world'],
  },
  {
    title: 'Reuters',
    domain: 'reuters.com',
    url: 'https://www.reuters.com',
    siteUrl: 'https://www.reuters.com',
    defaultTags: ['tag_world', 'tag_markets'],
  },
  {
    title: 'The Guardian',
    domain: 'theguardian.com',
    url: 'https://www.theguardian.com/world/rss',
    siteUrl: 'https://www.theguardian.com',
    defaultTags: ['tag_world', 'tag_investigative'],
  },
  {
    title: 'TechCrunch',
    domain: 'techcrunch.com',
    url: 'https://techcrunch.com/feed/',
    siteUrl: 'https://techcrunch.com',
    defaultTags: ['tag_tech'],
  },
  {
    title: 'The Verge',
    domain: 'theverge.com',
    url: 'https://www.theverge.com/rss/index.xml',
    siteUrl: 'https://www.theverge.com',
    defaultTags: ['tag_tech'],
  },
];

const INITIAL_ROW_SWIPE: SwipeActionState = {
  offsetX: 0,
  direction: 'none',
  progress: 0,
  armed: false,
  axisLock: 'undecided',
};

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
  onLoadDirectUrl,
  isLoadingDirectUrl,
  onSyncNow,
}) => {
  const {
    user,
    authReady,
    isSigningIn,
    cloudSyncStatus,
    cloudError,
    signInWithGoogle,
    signOutUser,
  } = useFirebase();
  const [omnibarInput, setOmnibarInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolderPill, setActiveFolderPill] = useState<string | null>(null);
  const [isDirectoryExpanded, setIsDirectoryExpanded] = useState(() => feeds.length === 0);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);
  const [addingPresetDomain, setAddingPresetDomain] = useState<string | null>(null);

  // Source currently being moved between folders
  const [movingFeed, setMovingFeed] = useState<Feed | null>(null);
  const [moveNewFolderName, setMoveNewFolderName] = useState('');
  const [isCreatingFolderInMove, setIsCreatingFolderInMove] = useState(false);

  // Swipe action state for individual source rows
  const [swipingFeedId, setSwipingFeedId] = useState<string | null>(null);
  const [rowSwipeState, setRowSwipeState] = useState<SwipeActionState>(INITIAL_ROW_SWIPE);
  const rowTouchStartRef = useRef<{
    feedId: string;
    pointerId: number;
    x: number;
    y: number;
    axisLock: GestureAxisLock;
    armed: boolean;
    samples: VelocitySample[];
  } | null>(null);
  const didRowSwipeRef = useRef(false);

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

  const unreadCountByFeed = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of articles) {
      if (!a.isRead) {
        counts[a.feedId] = (counts[a.feedId] || 0) + 1;
      }
    }
    return counts;
  }, [articles]);

  const filteredFeeds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return feeds.filter((f) => {
      if (activeFolderPill && (f.category?.trim() || '') !== activeFolderPill) {
        return false;
      }
      if (!q) return true;
      return (
        f.title.toLowerCase().includes(q) ||
        f.url.toLowerCase().includes(q) ||
        (f.category && f.category.toLowerCase().includes(q))
      );
    });
  }, [feeds, searchQuery, activeFolderPill]);

  const isPresetAdded = (preset: QuickAddSourcePreset) => {
    const normDomain = preset.domain.toLowerCase();
    return feeds.some(
      (f) =>
        f.url.toLowerCase().includes(normDomain) ||
        (f.siteUrl && f.siteUrl.toLowerCase().includes(normDomain)) ||
        f.title.toLowerCase() === preset.title.toLowerCase()
    );
  };

  const handleOmnibarSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = omnibarInput.trim();
    if (!trimmed) return;
    triggerHapticSelection();
    onLoadDirectUrl(trimmed);
    setOmnibarInput('');
  };

  const handleQuickAddPreset = async (preset: QuickAddSourcePreset) => {
    if (isPresetAdded(preset) || addingPresetDomain === preset.domain) return;
    triggerHapticSelection();
    setAddingPresetDomain(preset.domain);
    try {
      await onAddFeed({
        title: preset.title,
        url: preset.url,
        siteUrl: preset.siteUrl,
        category: activeFolderPill || '',
        defaultTags: preset.defaultTags,
        unreadCount: 0,
      });
      triggerHapticComplete();
    } finally {
      setAddingPresetDomain(null);
    }
  };

  const handleSingleRefresh = async (e: React.MouseEvent | null, feed: Feed) => {
    e?.stopPropagation();
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

  const handleOpenMoveMenu = (e: React.MouseEvent | null, feed: Feed) => {
    e?.stopPropagation();
    triggerHapticSelection();
    setMovingFeed(feed);
    setIsCreatingFolderInMove(false);
    setMoveNewFolderName('');
  };

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    triggerHapticComplete();
    onCreateFolder(trimmed);
    setActiveFolderPill(trimmed);
    setNewFolderName('');
    setIsNewFolderOpen(false);
  };

  const renderSourceRow = (feed: Feed) => {
    const isSelected = selectedFeedId === feed.id;
    const unread = unreadCountByFeed[feed.id] || 0;
    const isThisRefreshing = refreshingFeedId === feed.id;
    const activeSwipe = swipingFeedId === feed.id ? rowSwipeState : null;

    return (
      <div key={feed.id} className="relative overflow-hidden">
        {activeSwipe && activeSwipe.offsetX !== 0 && (
          <div
            aria-hidden="true"
            className={`absolute inset-0 flex items-center justify-between px-4 pointer-events-none select-none ${
              activeSwipe.direction === 'right'
                ? activeSwipe.armed
                  ? 'bg-emerald-500/25'
                  : 'bg-stone-200/60 dark:bg-white/[0.06]'
                : activeSwipe.armed
                  ? 'bg-[#FF6719]/25'
                  : 'bg-stone-200/60 dark:bg-white/[0.06]'
            }`}
          >
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold ${
                activeSwipe.direction === 'right' ? 'opacity-100' : 'opacity-0'
              } ${activeSwipe.armed ? 'text-emerald-500' : 'text-stone-500'}`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync Source</span>
            </div>
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold ml-auto ${
                activeSwipe.direction === 'left' ? 'opacity-100' : 'opacity-0'
              } ${activeSwipe.armed ? 'text-[#FF6719]' : 'text-stone-500'}`}
            >
              <span>Assign Folder</span>
              <FolderInput className="w-3.5 h-3.5" />
            </div>
          </div>
        )}

        <div
          onClick={() => {
            if (didRowSwipeRef.current) {
              didRowSwipeRef.current = false;
              return;
            }
            triggerHapticSelection();
            onSelectSource(feed);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            didRowSwipeRef.current = false;
            const now = performance.now();
            rowTouchStartRef.current = {
              feedId: feed.id,
              pointerId: e.pointerId,
              x: e.clientX,
              y: e.clientY,
              axisLock: 'undecided',
              armed: false,
              samples: [{ x: e.clientX, y: e.clientY, t: now }],
            };
          }}
          onPointerMove={(e) => {
            const session = rowTouchStartRef.current;
            if (!session || session.feedId !== feed.id || session.pointerId !== e.pointerId) return;
            if (e.pointerType !== 'touch' && e.buttons !== 1) return;

            const dx = e.clientX - session.x;
            const dy = e.clientY - session.y;
            const now = performance.now();
            session.samples.push({ x: e.clientX, y: e.clientY, t: now });
            if (session.samples.length > 8) session.samples.shift();

            const next = computeSwipeActionState(
              dx,
              dy,
              64,
              112,
              session.axisLock,
              session.armed
            );
            session.axisLock = next.axisLock;

            if (next.axisLock === 'horizontal') {
              didRowSwipeRef.current = true;
              try {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }
              } catch {
                // ignore
              }
              setSwipingFeedId(feed.id);
              setRowSwipeState(next);
            }

            if (next.armed && !session.armed) {
              session.armed = true;
              triggerHapticPull();
            } else if (!next.armed && session.armed) {
              session.armed = false;
              triggerHapticDisarm();
            }
          }}
          onPointerUp={(e) => {
            const session = rowTouchStartRef.current;
            rowTouchStartRef.current = null;
            if (session) {
              try {
                if (e.currentTarget.hasPointerCapture(session.pointerId)) {
                  e.currentTarget.releasePointerCapture(session.pointerId);
                }
              } catch {
                // ignore
              }
              if (swipingFeedId === feed.id && session.axisLock === 'horizontal') {
                session.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
                const { vx } = computeReleaseVelocity(session.samples);
                if (shouldCommitSwipeAction({ state: rowSwipeState, velocityX: vx })) {
                  triggerHapticComplete();
                  if (rowSwipeState.direction === 'right') {
                    handleSingleRefresh(null, feed);
                  } else if (rowSwipeState.direction === 'left') {
                    handleOpenMoveMenu(null, feed);
                  }
                }
              }
            }
            setSwipingFeedId(null);
            setRowSwipeState(INITIAL_ROW_SWIPE);
          }}
          onPointerCancel={(e) => {
            const session = rowTouchStartRef.current;
            rowTouchStartRef.current = null;
            if (session) {
              try {
                if (e.currentTarget.hasPointerCapture(session.pointerId)) {
                  e.currentTarget.releasePointerCapture(session.pointerId);
                }
              } catch {
                // ignore
              }
            }
            setSwipingFeedId(null);
            setRowSwipeState(INITIAL_ROW_SWIPE);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              triggerHapticSelection();
              onSelectSource(feed);
            }
          }}
          style={{
            touchAction: 'pan-y',
            transform:
              activeSwipe && activeSwipe.offsetX !== 0
                ? `translate3d(${activeSwipe.offsetX}px, 0, 0)`
                : undefined,
            transition:
              activeSwipe && activeSwipe.offsetX !== 0
                ? 'none'
                : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className={`relative px-3.5 py-3 flex items-center justify-between gap-2.5 cursor-pointer select-none transition-colors ${
            isSelected
              ? 'bg-[#FF6719]/8 dark:bg-[#FF6719]/12'
              : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <SourceAvatar name={feed.title} url={feed.url} size="sm" />
            <div className="min-w-0 flex-1">
              <span className="font-serif font-semibold text-sm text-stone-900 dark:text-stone-100 truncate block">
                {feed.title}
              </span>
              <span className="text-[11px] text-stone-400 dark:text-stone-500 truncate block">
                {feed.category ? `${feed.category} · ` : ''}
                {feed.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {unread > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-stone-200/70 dark:bg-white/[0.08] text-[11px] font-mono tabular-nums text-stone-600 dark:text-stone-300 mr-0.5">
                {unread}
              </span>
            )}

            <button
              type="button"
              onClick={(e) => handleOpenMoveMenu(e, feed)}
              title="Assign folder"
              aria-label={`Assign ${feed.title} to folder`}
              className="p-1.5 rounded-lg text-stone-400 hover:text-[#FF6719] transition-colors"
            >
              <FolderInput className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={(e) => handleSingleRefresh(e, feed)}
              disabled={isThisRefreshing || isOffline}
              title="Sync source"
              aria-label={`Sync ${feed.title}`}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isThisRefreshing ? 'animate-spin text-[#FF6719]' : ''}`}
              />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticSelection();
                onDeleteFeed(feed.id);
              }}
              title="Remove source"
              aria-label={`Remove ${feed.title}`}
              className="p-1.5 rounded-lg text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {isSelected ? (
              <Check className="w-4 h-4 text-[#FF6719] shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-stone-300 dark:text-stone-600 shrink-0" />
            )}
          </div>
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

      {/* Minimalist Top Header + Always-Visible Omnibar */}
      <header className="shrink-0 px-4 pt-[max(env(safe-area-inset-top,0px),0.75rem)] pb-2.5 z-20 space-y-2.5">
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="liquid-glass-pill h-11 px-4 rounded-full flex items-center gap-2.5">
            <h1 className="font-serif text-lg font-bold tracking-tight text-stone-900 dark:text-white">
              Sources
            </h1>
            <span className="text-xs text-stone-500 dark:text-stone-300 font-mono tabular-nums">
              {feeds.length}
            </span>
          </div>

          <div className="liquid-glass-pill h-11 px-2 rounded-full flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                onRefreshAll();
              }}
              disabled={isRefreshing || isOffline || feeds.length === 0}
              aria-label="Sync all sources"
              title="Sync all sources"
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
                onOpenFeedModal();
              }}
              aria-label="OPML & Folder Manager"
              title="OPML Import / Export"
              className="px-2.5 h-8 rounded-full text-[11px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              OPML
            </button>
          </div>
        </div>

        {/* Always-Visible Top Omnibar (Accepts any domain, website URL, or RSS link in 1 tap) */}
        <form
          onSubmit={handleOmnibarSubmit}
          className="liquid-glass-pill rounded-2xl p-1.5 pl-3.5 flex items-center gap-2 border border-stone-200/70 dark:border-white/[0.1]"
        >
          <Globe className="w-4 h-4 text-[#FF6719] shrink-0 pointer-events-none" />
          <input
            type="text"
            value={omnibarInput}
            onChange={(e) => setOmnibarInput(e.target.value)}
            placeholder="Add website or RSS link..."
            aria-label="Add website or RSS link"
            className="w-full bg-transparent text-xs text-stone-900 dark:text-white placeholder-stone-500 dark:placeholder-stone-400 focus:outline-none py-1.5"
          />
          <button
            type="submit"
            disabled={!omnibarInput.trim() || isLoadingDirectUrl}
            className="px-3.5 py-1.5 rounded-xl bg-[#FF6719] hover:bg-[#e85a12] text-white text-xs font-semibold flex items-center gap-1 shrink-0 disabled:opacity-40 active:scale-95 transition-all"
          >
            {isLoadingDirectUrl ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>{isLoadingDirectUrl ? 'Adding…' : 'Add'}</span>
          </button>
        </form>

        {/* Streamlined Folder Pills (All Sources, Folder Pills, + Folder) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              setActiveFolderPill(null);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              activeFolderPill === null
                ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900 shadow-xs'
                : 'liquid-glass-pill text-stone-600 dark:text-stone-300'
            }`}
          >
            All Sources ({feeds.length})
          </button>

          {allFolders.map((folder) => {
            const isActive = activeFolderPill === folder || selectedFolder === folder;
            return (
              <button
                key={folder}
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  if (activeFolderPill === folder) {
                    onSelectFolder(folder);
                  } else {
                    setActiveFolderPill(folder);
                  }
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  isActive
                    ? 'bg-[#FF6719] text-white shadow-xs'
                    : 'liquid-glass-pill text-stone-600 dark:text-stone-300'
                }`}
              >
                <Folder className="w-3 h-3" />
                <span>{folder}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              setIsNewFolderOpen((v) => !v);
            }}
            className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap liquid-glass-pill text-[#FF6719] flex items-center gap-1 shrink-0 active:scale-95 transition-transform"
          >
            <FolderPlus className="w-3 h-3" />
            <span>+ Folder</span>
          </button>
        </div>
      </header>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 py-1.5 pb-28 space-y-4 no-scrollbar">
        {/* Inline Create Folder Form */}
        {isNewFolderOpen && (
          <form
            onSubmit={handleCreateFolderSubmit}
            className="p-3 rounded-2xl liquid-glass border border-[#FF6719]/30 space-y-2 animate-in fade-in duration-150"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name (e.g. Daily, Tech, Markets)..."
                className="flex-1 px-3 py-2 rounded-xl text-xs bg-white/80 dark:bg-black/40 border border-stone-200/80 dark:border-white/[0.08] text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#FF6719]"
              />
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="px-3.5 py-2 bg-[#FF6719] text-white rounded-xl text-xs font-semibold disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                aria-label="Cancel folder"
                className="p-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* Active Folder Open-in-Feed Banner */}
        {activeFolderPill && (
          <div className="flex items-center justify-between px-3.5 py-2 rounded-2xl bg-[#FF6719]/10 border border-[#FF6719]/25">
            <span className="text-xs font-semibold text-stone-800 dark:text-stone-100">
              Folder: {activeFolderPill} ({filteredFeeds.length})
            </span>
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                onSelectFolder(activeFolderPill);
              }}
              className="text-xs font-bold text-[#FF6719] flex items-center gap-1"
            >
              <span>Read Folder Feed</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Minimalist iOS Grouped Source List */}
        {feeds.length > 0 && (
          <section className="space-y-2">
            {feeds.length > 5 && (
              <div className="px-3 py-1.5 rounded-xl bg-stone-200/50 dark:bg-white/[0.04] flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter your added sources..."
                  className="w-full bg-transparent text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none"
                />
              </div>
            )}

            <div className="rounded-2xl liquid-glass overflow-hidden divide-y divide-stone-200/40 dark:divide-white/[0.06]">
              {filteredFeeds.map((feed) => renderSourceRow(feed))}
              {filteredFeeds.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-stone-400">
                  No sources match this filter.
                </div>
              )}
            </div>
          </section>
        )}

        {/* Collapsible Quick-Add Newspapers & Portals Directory (12 1-Tap Presets) */}
        <section className="rounded-2xl liquid-glass overflow-hidden border border-stone-200/60 dark:border-white/[0.08]">
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              setIsDirectoryExpanded((v) => !v);
            }}
            className="w-full px-4 py-3 flex items-center justify-between text-left bg-stone-100/60 dark:bg-white/[0.03] hover:bg-stone-200/50 dark:hover:bg-white/[0.05] transition-colors"
          >
            <div>
              <h2 className="font-sans text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-100">
                Quick-Add Newspapers & Portals
              </h2>
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                1-tap subscribe to curated Bangladesh & world outlets
              </span>
            </div>
            {isDirectoryExpanded ? (
              <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
            )}
          </button>

          {isDirectoryExpanded && (
            <div className="divide-y divide-stone-200/40 dark:divide-white/[0.06]">
              {QUICK_ADD_PRESETS.map((preset) => {
                const added = isPresetAdded(preset);
                const isAdding = addingPresetDomain === preset.domain;

                return (
                  <div
                    key={preset.domain}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <SourceAvatar name={preset.title} url={preset.siteUrl} size="sm" />
                      <div className="min-w-0">
                        <div className="font-serif text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {preset.title}
                        </div>
                        <div className="text-[11px] text-stone-400 dark:text-stone-500 truncate">
                          {preset.domain}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={added || isAdding}
                      onClick={() => handleQuickAddPreset(preset)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center gap-1 transition-all active:scale-95 ${
                        added
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 cursor-default'
                          : 'bg-[#FF6719]/15 hover:bg-[#FF6719] text-[#FF6719] hover:text-white'
                      }`}
                    >
                      {isAdding ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : added ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>Added</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          <span>Add</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Cloud Backup & Sync Card (Google Sign-In via Firebase) */}
        <section className="rounded-2xl liquid-glass overflow-hidden border border-stone-200/60 dark:border-white/[0.08] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Reader avatar'}
                  className="w-9 h-9 rounded-full object-cover border border-white/30 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-[#FF6719]/15 text-[#FF6719] flex items-center justify-center shrink-0">
                  <Cloud className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs font-bold text-stone-900 dark:text-stone-100 truncate">
                  {user ? user.displayName || 'Chinta Cloud Reader' : 'Cloud Sync & Backup'}
                </div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                  {user
                    ? cloudSyncStatus === 'syncing'
                      ? 'Syncing sources & bookmarks…'
                      : cloudSyncStatus === 'synced'
                        ? 'Synced with Firebase Cloud'
                        : user.email || 'Signed in with Google'
                    : 'Sync sources, bookmarks, and reading speed across devices'}
                </div>
              </div>
            </div>

            {user ? (
              <div className="flex items-center gap-1.5 shrink-0">
                {onSyncNow && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      void onSyncNow();
                    }}
                    disabled={cloudSyncStatus === 'syncing'}
                    aria-label="Sync Cloud Now"
                    className="px-3 py-1.5 rounded-full text-xs font-semibold liquid-glass-pill text-stone-800 dark:text-stone-100 flex items-center gap-1 active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {cloudSyncStatus === 'syncing' ? (
                      <Loader2 className="w-3 h-3 animate-spin text-[#FF6719]" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    )}
                    <span>Sync</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    void signOutUser();
                  }}
                  aria-label="Sign out of Google"
                  className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!authReady || isSigningIn || isOffline}
                onClick={() => {
                  triggerHapticSelection();
                  void signInWithGoogle();
                }}
                data-testid="firebase-google-signin-btn"
                className="px-3.5 py-2 rounded-full text-xs font-semibold bg-[#FF6719] text-white shadow-md shadow-[#FF6719]/25 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform disabled:opacity-50"
              >
                {isSigningIn ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Cloud className="w-3.5 h-3.5" />
                )}
                <span>Sign in with Google</span>
              </button>
            )}
          </div>

          {cloudError && (
            <p className="text-[11px] text-rose-500 dark:text-rose-400 leading-snug">
              {cloudError}
            </p>
          )}
        </section>
      </div>

      {/* Liquid Glass Modal to Assign a Source to a Folder */}
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
                  Assign Folder
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
                <span>No Folder (All Sources)</span>
                {!movingFeed.category?.trim() && <Check className="w-3.5 h-3.5 text-[#FF6719]" />}
              </button>

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
