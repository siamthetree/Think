import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  BarChart3,
  Share2,
  Download,
  BookOpen,
  Instagram,
  Check,
} from 'lucide-react';
import type {
  ReadingHabitState,
  SpotifyReadingStats,
  ReadHistoryEntry,
} from '../utils/feedIntelligence';
import {
  SPOTIFY_BACKDROP_THEMES,
  renderStoryCardCanvas,
  shareSpotifyStyleStory,
  type StoryBackdropThemeId,
  type StoryCardMode,
  type StoryCardPayload,
} from '../utils/storyCardRenderer';
import { triggerHapticSelection, triggerHapticComplete } from '../utils/haptics';
import { computeSheetDragState } from '../utils/touchGestures';

interface ReadingHabitSheetProps {
  isOpen: boolean;
  onClose: () => void;
  habit: ReadingHabitState;
  stats: SpotifyReadingStats;
  onChangeDailyGoal: (goal: number) => void;
}

export const ReadingHabitSheet: React.FC<ReadingHabitSheetProps> = ({
  isOpen,
  onClose,
  habit,
  stats,
  onChangeDailyGoal,
}) => {
  const [activeTab, setActiveTab] = useState<'stats' | 'studio'>('stats');
  const [storyMode, setStoryMode] = useState<StoryCardMode>('wrapped');
  const [themeId, setThemeId] = useState<StoryBackdropThemeId>('sunset');
  const [selectedStoryIdx, setSelectedStoryIdx] = useState(0);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartRef = useRef<{ y: number; time: number } | null>(null);

  const selectedStory: ReadHistoryEntry | undefined =
    stats.recentStories[Math.min(selectedStoryIdx, Math.max(0, stats.recentStories.length - 1))];

  const storyPayload = useMemo<StoryCardPayload>(() => {
    return {
      mode: storyMode,
      themeId,
      headline: selectedStory?.title || 'Distraction-Free Reading on Chinta',
      publisher: selectedStory?.feedTitle || 'Chinta Newsreader',
      readTimeMin: selectedStory?.readTimeMin || Math.max(3, stats.totalMinutesRead),
      imageUrl: selectedStory?.imageUrl,
      quoteText: selectedStory?.title || 'Read with clarity, free from noise.',
      stats,
    };
  }, [storyMode, themeId, selectedStory, stats]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'studio') return;
    let cancelled = false;
    renderStoryCardCanvas(storyPayload).then((canvas) => {
      if (cancelled) return;
      try {
        setPreviewDataUrl(canvas.toDataURL('image/png'));
      } catch {
        setPreviewDataUrl(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, storyPayload]);

  if (!isOpen) return null;

  const goal = Math.max(1, habit.dailyGoal || 3);
  const goalPct = Math.min(100, Math.round((stats.todayStoriesRead / goal) * 100));

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragStartRef.current = { y: e.clientY, time: Date.now() };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    if (e.pointerType !== 'touch' && e.buttons !== 1) return;
    const dy = e.clientY - dragStartRef.current.y;
    const state = computeSheetDragState(dy, 0, 88);
    setDragOffsetY(state.offsetY);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dy = e.clientY - dragStartRef.current.y;
    const dt = Math.max(1, Date.now() - dragStartRef.current.time);
    const velocityY = dy / dt;
    dragStartRef.current = null;

    const state = computeSheetDragState(dy, velocityY, 88);
    setDragOffsetY(0);
    if (state.shouldDismiss) {
      triggerHapticSelection();
      onClose();
    }
  };

  const handleShareStory = async (platform: 'instagram' | 'facebook' | 'download') => {
    triggerHapticSelection();
    setIsExporting(true);
    try {
      const result = await shareSpotifyStyleStory(platform, storyPayload);
      if (result.ok) triggerHapticComplete();
      setShareFeedback(result.message);
      setTimeout(() => {
        setShareFeedback((cur) => (cur === result.message ? null : cur));
      }, 3000);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reading Stats and Story Card"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 pb-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: dragOffsetY !== 0 ? `translate3d(0, ${dragOffsetY}px, 0)` : undefined,
          transition:
            dragOffsetY !== 0 ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="w-full max-w-md max-h-[86vh] flex flex-col rounded-3xl reader-liquid-card text-stone-100 shadow-2xl border border-white/15 overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Drag Handle */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          style={{ touchAction: 'none' }}
          className="pt-3 pb-1 flex justify-center cursor-grab active:cursor-grabbing shrink-0"
        >
          <div className="w-10 h-1 bg-white/25 rounded-full" />
        </div>

        {/* Minimal Header + 2-Tab Switcher */}
        <div className="px-5 pt-2 pb-3 border-b border-white/10 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#FF6719]" />
              <h2 className="font-serif text-base font-bold text-white">
                Reading
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                onClose();
              }}
              aria-label="Close reading stats"
              className="min-w-[32px] min-h-[32px] rounded-full flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-black/35 border border-white/10 rounded-full">
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setActiveTab('stats');
              }}
              className={`py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'stats'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              Stats
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setActiveTab('studio');
              }}
              className={`py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === 'studio'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              Share Story
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 no-scrollbar">
          {activeTab === 'stats' ? (
            <>
              {/* Clean At-a-Glance Metric Summary */}
              <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-serif text-3xl font-bold tabular-nums text-white leading-none">
                      {stats.totalMinutesRead}m
                    </div>
                    <div className="text-xs text-stone-400 mt-1 tabular-nums">
                      {stats.totalStoriesRead} {stats.totalStoriesRead === 1 ? 'story' : 'stories'} read · {stats.streakDays}d streak
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      setStoryMode('wrapped');
                      setActiveTab('studio');
                    }}
                    className="px-3 py-1.5 rounded-full bg-[#FF6719] text-white text-[11px] font-semibold flex items-center gap-1.5 active:scale-95 transition-transform shrink-0"
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Share</span>
                  </button>
                </div>

                {/* Subtle Today Goal Progress */}
                <div className="space-y-1.5 pt-2 border-t border-white/10">
                  <div className="flex items-center justify-between text-[11px] text-stone-300 tabular-nums">
                    <span>Today</span>
                    <span>
                      {stats.todayStoriesRead}/{goal} stories · {stats.todayMinutesRead}m
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#FF6719] transition-all duration-300"
                      style={{ width: `${goalPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Top Sources (Minimal List) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                  <span>Top Sources</span>
                  {stats.topGenres.length > 0 && (
                    <span className="normal-case font-normal text-stone-400 truncate max-w-[180px]">
                      {stats.topGenres
                        .slice(0, 3)
                        .map((g) => g.name)
                        .join(' · ')}
                    </span>
                  )}
                </div>

                {stats.topSources.length > 0 ? (
                  <div className="divide-y divide-white/[0.08] rounded-2xl bg-white/[0.03] border border-white/10 px-3.5">
                    {stats.topSources.slice(0, 4).map((src) => (
                      <div
                        key={src.feedId + src.title}
                        className="py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-[11px] text-stone-400 w-4 shrink-0">
                            {src.rank}.
                          </span>
                          <span className="font-medium text-stone-100 truncate">
                            {src.title}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-stone-400 shrink-0 tabular-nums">
                          {src.storyCount} reads
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">
                    Read a few stories to see your most-read sources.
                  </p>
                )}
              </div>

              {/* Recent Stories — 1-Tap to Create Story Card */}
              {stats.recentStories.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 block">
                    Share a Story
                  </span>
                  <div className="divide-y divide-white/[0.08] rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                    {stats.recentStories.slice(0, 3).map((entry, idx) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          triggerHapticSelection();
                          setSelectedStoryIdx(idx);
                          setStoryMode('song');
                          setActiveTab('studio');
                        }}
                        className="w-full px-3.5 py-2.5 hover:bg-white/[0.05] flex items-center justify-between gap-3 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <BookOpen className="w-3.5 h-3.5 text-[#FF6719] shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-white truncate">
                              {entry.title}
                            </div>
                            <div className="text-[10px] text-stone-400 truncate">
                              {entry.feedTitle}
                            </div>
                          </div>
                        </div>
                        <Share2 className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Minimal Daily Goal Selector */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-xs text-stone-400">Daily goal</span>
                <div className="flex items-center gap-1 p-1 bg-black/35 border border-white/10 rounded-full">
                  {[3, 5, 7].map((target) => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        onChangeDailyGoal(target);
                      }}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all tabular-nums ${
                        goal === target
                          ? 'bg-white text-stone-900'
                          : 'text-stone-400 hover:text-white'
                      }`}
                    >
                      {target}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* TAB 2: MINIMAL STORY SHARE STUDIO */
            <div className="space-y-3.5">
              {/* Simple Card Type Toggle */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-black/35 border border-white/10 rounded-full">
                {(
                  [
                    { id: 'wrapped', label: 'Recap' },
                    { id: 'song', label: 'Article' },
                    { id: 'lyrics', label: 'Quote' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      setStoryMode(m.id);
                    }}
                    className={`py-1.5 rounded-full text-xs font-semibold transition-all ${
                      storyMode === m.id
                        ? 'bg-white text-stone-900'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Story Picker (when multiple read stories exist) */}
              {(storyMode === 'song' || storyMode === 'lyrics') && stats.recentStories.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {stats.recentStories.slice(0, 5).map((entry, idx) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setSelectedStoryIdx(idx);
                      }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap border transition-colors ${
                        selectedStoryIdx === idx
                          ? 'bg-white/15 border-[#FF6719] text-white'
                          : 'bg-black/30 border-white/10 text-stone-400 hover:text-white'
                      }`}
                    >
                      {entry.feedTitle}
                    </button>
                  ))}
                </div>
              )}

              {/* Live 9:16 Card Preview */}
              <div className="flex justify-center">
                <div className="w-44 aspect-[9/16] rounded-2xl overflow-hidden border border-white/15 bg-black/40 shadow-2xl flex items-center justify-center">
                  {previewDataUrl ? (
                    <img
                      src={previewDataUrl}
                      alt="Story Card Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-5 h-5 border-2 border-[#FF6719] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
              </div>

              {/* Minimal Color Dots */}
              <div className="flex items-center justify-center gap-3">
                {SPOTIFY_BACKDROP_THEMES.map((t) => {
                  const active = themeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setThemeId(t.id);
                      }}
                      aria-label={t.name}
                      title={t.name}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform ${
                        active ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-stone-900' : 'opacity-75 hover:opacity-100'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${t.topColor}, ${t.midColor})`,
                      }}
                    >
                      {active && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  );
                })}
              </div>

              {shareFeedback && (
                <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-[11px] text-stone-200 text-center">
                  {shareFeedback}
                </div>
              )}

              {/* Share Buttons */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => handleShareStory('instagram')}
                  className="py-2.5 px-2 rounded-full text-[11px] font-semibold text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
                  style={{
                    background:
                      'linear-gradient(135deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%)',
                  }}
                >
                  <Instagram className="w-3.5 h-3.5 shrink-0" />
                  <span>Instagram</span>
                </button>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => handleShareStory('facebook')}
                  className="py-2.5 px-2 rounded-full text-[11px] font-semibold bg-[#1877F2] hover:bg-[#166FE5] text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
                >
                  <Share2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Facebook</span>
                </button>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => handleShareStory('download')}
                  aria-label="Save story photo to gallery"
                  className="py-2.5 px-2 rounded-full text-[11px] font-semibold bg-white/15 hover:bg-white/25 text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Save Photo</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
