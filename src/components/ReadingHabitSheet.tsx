import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  BarChart3,
  Sparkles,
  Share2,
  Download,
  BookOpen,
  Clock,
  Flame,
  Music2,
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
  const [themeId, setThemeId] = useState<StoryBackdropThemeId>('emerald');
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
      headline: selectedStory?.title || 'Focused Distraction-Free Reading on Chinta',
      publisher: selectedStory?.feedTitle || 'Chinta Newsreader',
      readTimeMin: selectedStory?.readTimeMin || Math.max(3, stats.totalMinutesRead),
      imageUrl: selectedStory?.imageUrl,
      quoteText: selectedStory?.title || 'Read with clarity, free from algorithmic noise.',
      stats,
    };
  }, [storyMode, themeId, selectedStory, stats]);

  // Render live 9:16 HTML5 Canvas preview whenever Story Studio options change
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
      }, 3200);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chinta Wrapped & Story Studio"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 pb-6 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: dragOffsetY !== 0 ? `translate3d(0, ${dragOffsetY}px, 0)` : undefined,
          transition:
            dragOffsetY !== 0 ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="w-full max-w-md max-h-[88vh] flex flex-col rounded-3xl reader-liquid-card text-stone-100 shadow-2xl border border-white/20 overflow-hidden animate-in zoom-in-95 duration-150"
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

        {/* Sheet Header */}
        <div className="px-5 pt-2 pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-[#1DB954]/20 text-[#1DB954] flex items-center justify-center">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-sans text-sm font-bold text-white leading-tight">
                  Chinta Wrapped
                </h2>
                <span className="text-[11px] text-stone-400">
                  Spotify-style reading stats & 9:16 Story studio
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                onClose();
              }}
              aria-label="Close Chinta Wrapped sheet"
              className="min-w-[34px] min-h-[34px] rounded-full flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 2-Tab Segmented Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-black/45 border border-white/10 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setActiveTab('stats');
              }}
              className={`py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'stats'
                  ? 'bg-[#1DB954] text-black shadow-sm'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Reading Stats</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setActiveTab('studio');
              }}
              className={`py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'studio'
                  ? 'bg-[#1DB954] text-black shadow-sm'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              <Instagram className="w-3.5 h-3.5" />
              <span>IG & FB Story Card</span>
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
          {activeTab === 'stats' ? (
            <>
              {/* Hero Spotify Wrapped Summary Card */}
              <div
                className="p-4 rounded-2xl border border-white/15 relative overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${stats.readerAura.gradientFrom}33 0%, ${stats.readerAura.gradientTo}CC 100%)`,
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1DB954]">
                    Total Focus Time
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      setStoryMode('wrapped');
                      setActiveTab('studio');
                    }}
                    className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-[11px] font-semibold text-white flex items-center gap-1 transition-colors"
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Share Wrapped</span>
                  </button>
                </div>

                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-sans text-4xl font-extrabold tabular-nums text-white">
                    {stats.totalMinutesRead}
                  </span>
                  <span className="text-sm font-semibold text-stone-200">minutes read</span>
                </div>

                <p className="text-xs text-stone-300 tabular-nums">
                  {stats.totalStoriesRead} {stats.totalStoriesRead === 1 ? 'story' : 'stories'} finished · ~
                  {stats.estimatedWordsRead.toLocaleString()} words absorbed
                </p>

                <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-white/15 text-center">
                  <div>
                    <div className="text-[10px] text-stone-300 flex items-center justify-center gap-1">
                      <Clock className="w-3 h-3 text-[#1DB954]" />
                      <span>Today</span>
                    </div>
                    <div className="font-mono text-sm font-bold text-white tabular-nums mt-0.5">
                      {stats.todayMinutesRead}m
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-stone-300 flex items-center justify-center gap-1">
                      <BookOpen className="w-3 h-3 text-[#FF6719]" />
                      <span>Goal</span>
                    </div>
                    <div className="font-mono text-sm font-bold text-white tabular-nums mt-0.5">
                      {stats.todayStoriesRead}/{goal}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-stone-300 flex items-center justify-center gap-1">
                      <Flame className="w-3 h-3 text-amber-400" />
                      <span>Streak</span>
                    </div>
                    <div className="font-mono text-sm font-bold text-white tabular-nums mt-0.5">
                      {stats.streakDays}d
                    </div>
                  </div>
                </div>
              </div>

              {/* Reader Aura Persona */}
              <div className="p-3.5 rounded-2xl bg-black/35 border border-white/10">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#1DB954] mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Your Reader Aura</span>
                </div>
                <h3 className="font-serif text-base font-bold text-white">
                  {stats.readerAura.title}
                </h3>
                <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
                  {stats.readerAura.subtitle}
                </p>
              </div>

              {/* Top Publishers #1-#5 */}
              <div className="p-3.5 rounded-2xl bg-black/30 border border-white/10 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-stone-300">
                    Top Publishers
                  </span>
                  <span className="text-[10px] text-stone-400">#1–#5</span>
                </div>

                {stats.topSources.length > 0 ? (
                  <div className="space-y-2">
                    {stats.topSources.map((src) => (
                      <div key={src.feedId + src.title} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-bold text-[#1DB954] w-5 shrink-0">
                              #{src.rank}
                            </span>
                            <span className="font-medium text-stone-100 truncate">
                              {src.title}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-stone-400 shrink-0 tabular-nums">
                            {src.storyCount} {src.storyCount === 1 ? 'story' : 'stories'} · {src.sharePercent}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#1DB954]"
                            style={{ width: `${Math.max(8, src.sharePercent)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">
                    Open a few articles to build your Top Publishers ranking.
                  </p>
                )}
              </div>

              {/* Top Reading Beats #1-#4 */}
              <div className="p-3.5 rounded-2xl bg-black/30 border border-white/10 space-y-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-stone-300 block">
                  Top Reading Beats
                </span>
                {stats.topGenres.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {stats.topGenres.map((genre) => (
                      <div
                        key={genre.tagId}
                        className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: genre.color }}
                          />
                          <span className="text-xs font-medium text-stone-100 truncate">
                            {genre.name}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-stone-400 shrink-0 tabular-nums">
                          {genre.sharePercent}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">
                    Your top topics will appear as you read across categories.
                  </p>
                )}
              </div>

              {/* Recently Read Stories (1-tap share as Spotify Song Card) */}
              {stats.recentStories.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-stone-300 block">
                    Share as Spotify Song Card
                  </span>
                  <div className="space-y-1.5">
                    {stats.recentStories.slice(0, 4).map((entry, idx) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          triggerHapticSelection();
                          setSelectedStoryIdx(idx);
                          setStoryMode('song');
                          setActiveTab('studio');
                        }}
                        className="w-full p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between gap-3 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-[#1DB954]/20 text-[#1DB954] flex items-center justify-center shrink-0">
                            <Music2 className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              {entry.title}
                            </div>
                            <div className="text-[10px] text-stone-400 truncate">
                              {entry.feedTitle} · {entry.readTimeMin}m read
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-[#1DB954] shrink-0">
                          Story →
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Daily Target Selector */}
              <div className="pt-1">
                <div className="flex items-center justify-between text-xs text-stone-400 mb-2">
                  <span>Daily Reading Goal</span>
                  <span className="font-mono tabular-nums text-stone-300">{goal} stories / day</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-1 bg-black/40 border border-white/10 rounded-2xl">
                  {[3, 5, 7].map((target) => {
                    const active = goal === target;
                    return (
                      <button
                        key={target}
                        type="button"
                        onClick={() => {
                          triggerHapticSelection();
                          onChangeDailyGoal(target);
                        }}
                        className={`py-2 rounded-xl text-xs font-semibold transition-all tabular-nums ${
                          active
                            ? 'liquid-glass-dock text-white ring-1 ring-white/25 shadow-sm'
                            : 'text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        {target} Stories
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            /* TAB 2: IG & FB STORY CARD STUDIO */
            <>
              {/* Story Card Mode Switcher */}
              <div>
                <span className="text-[11px] font-medium text-stone-400 block mb-1.5">
                  Card Style (9:16 Vertical)
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/40 border border-white/10 rounded-2xl">
                  {(
                    [
                      { id: 'wrapped', label: 'Wrapped' },
                      { id: 'song', label: 'Song Share' },
                      { id: 'lyrics', label: 'Lyrics Card' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        triggerHapticSelection();
                        setStoryMode(m.id);
                      }}
                      className={`py-1.5 rounded-xl text-xs font-semibold transition-all ${
                        storyMode === m.id
                          ? 'bg-[#1DB954] text-black shadow-xs'
                          : 'text-stone-300 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Story Picker when in Song or Lyrics mode */}
              {(storyMode === 'song' || storyMode === 'lyrics') && stats.recentStories.length > 1 && (
                <div>
                  <span className="text-[11px] font-medium text-stone-400 block mb-1.5">
                    Featured Story ({selectedStoryIdx + 1} of {stats.recentStories.length})
                  </span>
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
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
                            ? 'bg-white/15 border-[#1DB954] text-white'
                            : 'bg-black/30 border-white/10 text-stone-400 hover:text-white'
                        }`}
                      >
                        {entry.feedTitle}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 5 Spotify Backdrop Themes */}
              <div>
                <span className="text-[11px] font-medium text-stone-400 block mb-1.5">
                  Spotify Backdrop Theme
                </span>
                <div className="grid grid-cols-5 gap-1.5">
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
                        title={t.name}
                        className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                          active
                            ? 'border-[#1DB954] bg-white/10'
                            : 'border-white/10 bg-black/30 opacity-75 hover:opacity-100'
                        }`}
                      >
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center"
                          style={{
                            background: `linear-gradient(135deg, ${t.topColor}, ${t.midColor})`,
                          }}
                        >
                          {active && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <span className="text-[9px] text-stone-300 truncate w-full text-center">
                          {t.name.split(' ')[1] || t.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 9:16 Live Preview */}
              <div className="flex justify-center py-1">
                <div className="w-48 aspect-[9/16] rounded-2xl overflow-hidden border border-white/20 bg-black/50 shadow-2xl flex items-center justify-center">
                  {previewDataUrl ? (
                    <img
                      src={previewDataUrl}
                      alt="9:16 Story Card Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-5 h-5 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
              </div>

              {shareFeedback && (
                <div className="px-3 py-2 rounded-xl bg-[#1DB954]/15 border border-[#1DB954]/40 text-xs text-emerald-300 text-center font-medium">
                  {shareFeedback}
                </div>
              )}

              {/* Instagram Story, Facebook Story, Save 9:16 PNG */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => handleShareStory('instagram')}
                  className="py-2.5 px-2 rounded-xl text-[11px] font-bold text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
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
                  className="py-2.5 px-2 rounded-xl text-[11px] font-bold bg-[#1877F2] hover:bg-[#166FE5] text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
                >
                  <Share2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Facebook</span>
                </button>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => handleShareStory('download')}
                  className="py-2.5 px-2 rounded-xl text-[11px] font-bold bg-white/15 hover:bg-white/25 text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Save 9:16</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
