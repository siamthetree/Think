import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  Clock,
  BookOpen,
  Search,
} from 'lucide-react';
import type { Feed, FeedItem } from '../types';
import { findPerspectivesAcrossSources } from '../utils/feedIntelligence';
import { formatRelativeTime } from '../utils/feedParser';
import { SourceAvatar } from './SourceAvatar';
import { PerspectiveLogo } from './PerspectiveLogo';
import { extractArticleWithFallback } from '../utils/apiClient';
import { blocksToHtml, isJavaScriptWarningText } from '../utils/sanitize';
import { hasFullBody } from '../utils/storage';
import {
  triggerHapticSelection,
  triggerHapticPull,
  triggerHapticDisarm,
  triggerHapticComplete,
} from '../utils/haptics';
import {
  computeSheetDragState,
  computeReleaseVelocity,
  type VelocitySample,
} from '../utils/touchGestures';
import {
  estimateArticleReadTime,
  type ReadingSpeedProfile,
} from '../utils/readingSpeed';

interface PerspectiveModalProps {
  targetArticle: FeedItem | null;
  allArticles: FeedItem[];
  feeds: Feed[];
  readingSpeedProfile?: ReadingSpeedProfile;
  isScanningSources?: boolean;
  onScanAllSources?: (article: FeedItem) => void;
  onClose: () => void;
  onSelectArticle: (article: FeedItem) => void;
  onCacheExtractedArticle?: (
    articleId: string,
    extracted: {
      title?: string;
      author?: string;
      leadImage?: string;
      readTimeMin?: number;
      contentClean?: string;
      contentHtml?: string;
    }
  ) => void;
}

export const PerspectiveModal: React.FC<PerspectiveModalProps> = ({
  targetArticle,
  allArticles,
  feeds,
  readingSpeedProfile,
  isScanningSources = false,
  onScanAllSources,
  onClose,
  onSelectArticle,
  onCacheExtractedArticle,
}) => {
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [extractingIds, setExtractingIds] = useState<Record<string, boolean>>({});
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [customKeywordFilter, setCustomKeywordFilter] = useState<string | null>(null);

  const dragSessionRef = useRef<{
    startY: number;
    armedFired: boolean;
    samples: VelocitySample[];
  } | null>(null);
  const preExtractedRef = useRef<Set<string>>(new Set());

  // Reset state when target article changes
  useEffect(() => {
    setCustomKeywordFilter(null);
    setOpeningId(null);
  }, [targetArticle?.id]);

  // Run cross-source Perspective search across all articles in the app
  const perspectiveResult = useMemo(() => {
    if (!targetArticle) return null;
    return findPerspectivesAcrossSources(targetArticle, allArticles);
  }, [targetArticle, allArticles]);

  const filteredMatches = useMemo(() => {
    if (!perspectiveResult) return [];
    if (!customKeywordFilter) return perspectiveResult.matches;
    const kw = customKeywordFilter.toLowerCase();
    return perspectiveResult.matches.filter(
      (m) =>
        m.sharedKeywords.includes(kw) ||
        m.article.title.toLowerCase().includes(kw) ||
        (m.article.summary || '').toLowerCase().includes(kw)
    );
  }, [perspectiveResult, customKeywordFilter]);

  // Automatically pre-extract full text for matched Perspective stories so tapping opens 100% loaded in ReaderView
  useEffect(() => {
    if (!targetArticle || !perspectiveResult) return;
    let cancelled = false;

    const itemsToPreload = [
      targetArticle,
      ...perspectiveResult.matches.slice(0, 8).map((m) => m.article),
    ].filter(
      (item) =>
        !hasFullBody(item) &&
        item.link &&
        item.link.startsWith('http') &&
        !preExtractedRef.current.has(item.id)
    );

    if (itemsToPreload.length === 0) return;

    const preloadAll = async () => {
      for (const item of itemsToPreload) {
        if (cancelled) break;
        preExtractedRef.current.add(item.id);
        setExtractingIds((prev) => ({ ...prev, [item.id]: true }));
        try {
          const data = await extractArticleWithFallback(item.link);
          if (!cancelled && data.success && data.blocks && data.blocks.length > 0) {
            const validBlocks = data.blocks.filter(
              (b) => !b.text || !isJavaScriptWarningText(b.text)
            );
            const contentClean = validBlocks
              .map((b) => b.text || '')
              .filter(Boolean)
              .join('\n\n');
            if (validBlocks.length > 0 && contentClean.length >= 120 && onCacheExtractedArticle) {
              onCacheExtractedArticle(item.id, {
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
          // fallback handled when opened
        } finally {
          if (!cancelled) {
            setExtractingIds((prev) => ({ ...prev, [item.id]: false }));
          }
        }
      }
    };

    preloadAll();
    return () => {
      cancelled = true;
    };
  }, [targetArticle?.id, perspectiveResult?.matches.length]);

  if (!targetArticle || !perspectiveResult) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const now = performance.now();
    dragSessionRef.current = {
      startY: e.touches[0].clientY,
      armedFired: false,
      samples: [{ x: e.touches[0].clientX, y: e.touches[0].clientY, t: now }],
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const session = dragSessionRef.current;
    if (!session || e.touches.length !== 1) return;
    const cy = e.touches[0].clientY;
    const dy = cy - session.startY;
    session.samples.push({ x: e.touches[0].clientX, y: cy, t: performance.now() });
    if (session.samples.length > 8) session.samples.shift();

    const { offsetY } = computeSheetDragState(dy, 0, 88);
    setDragOffsetY(offsetY);

    if (offsetY >= 88 && !session.armedFired) {
      session.armedFired = true;
      triggerHapticPull();
    } else if (offsetY < 74 && session.armedFired) {
      session.armedFired = false;
      triggerHapticDisarm();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    if (!session) {
      setDragOffsetY(0);
      return;
    }

    let dy = dragOffsetY;
    if (e.changedTouches.length === 1) {
      const endY = e.changedTouches[0].clientY;
      dy = endY - session.startY;
      session.samples.push({ x: e.changedTouches[0].clientX, y: endY, t: performance.now() });
    }
    const { vy } = computeReleaseVelocity(session.samples);
    const { shouldDismiss } = computeSheetDragState(dy, vy, 88);

    setDragOffsetY(0);
    if (shouldDismiss) {
      triggerHapticSelection();
      onClose();
    }
  };

  // Opens any tapped news item fully loaded in ReaderView
  const handleTapStory = async (item: FeedItem) => {
    triggerHapticComplete();
    // Always pick the latest version from allArticles in case pre-extraction just populated it
    const latestItem = allArticles.find((a) => a.id === item.id) || item;

    if (
      !hasFullBody(latestItem) &&
      latestItem.link &&
      latestItem.link.startsWith('http') &&
      !/news\.google\.com\/rss\/articles\//i.test(latestItem.link)
    ) {
      setOpeningId(latestItem.id);
      try {
        const data = await extractArticleWithFallback(latestItem.link);
        if (data.success && data.blocks && data.blocks.length > 0) {
          const validBlocks = data.blocks.filter(
            (b) => !b.text || !isJavaScriptWarningText(b.text)
          );
          const contentClean = validBlocks
            .map((b) => b.text || '')
            .filter(Boolean)
            .join('\n\n');
          if (validBlocks.length > 0 && contentClean.length >= 80) {
            const contentHtml = blocksToHtml(validBlocks);
            const enriched: FeedItem = {
              ...latestItem,
              title: data.title || latestItem.title,
              author: data.author || latestItem.author,
              imageUrl: data.leadImage || latestItem.imageUrl,
              readTimeMin: data.readTimeMin || latestItem.readTimeMin,
              contentClean,
              contentHtml,
              isOfflineCached: true,
              cachedAt: Date.now(),
            };
            if (onCacheExtractedArticle) {
              onCacheExtractedArticle(latestItem.id, {
                title: enriched.title,
                author: enriched.author,
                leadImage: enriched.imageUrl,
                readTimeMin: enriched.readTimeMin,
                contentClean: enriched.contentClean,
                contentHtml: enriched.contentHtml,
              });
            }
            setOpeningId(null);
            onClose();
            onSelectArticle(enriched);
            return;
          }
        }
      } catch {
        // Proceed with available content
      }
      setOpeningId(null);
    }

    onClose();
    onSelectArticle(latestItem);
  };

  const totalMatches = filteredMatches.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => {
        triggerHapticSelection();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: dragOffsetY !== 0 ? `translate3d(0, ${dragOffsetY}px, 0)` : undefined,
          transition:
            dragOffsetY !== 0 ? 'none' : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="w-full max-w-md max-h-[85vh] flex flex-col rounded-3xl liquid-glass bg-stone-50/95 dark:bg-[#14161A]/95 border border-stone-200/80 dark:border-white/15 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
      >
        {/* Top Grabber Handle (Drag down to dismiss) */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="pt-2.5 pb-1 flex justify-center cursor-grab active:cursor-grabbing shrink-0"
        >
          <div className="w-10 h-1 rounded-full bg-stone-300 dark:bg-white/20" />
        </div>

        {/* Sheet Header */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="px-4 pt-2 pb-3 border-b border-stone-200/70 dark:border-white/10 flex items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-2xl bg-[#FF6719]/15 text-[#FF6719] flex items-center justify-center shrink-0">
              <PerspectiveLogo className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 leading-tight">
                  Perspective
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#FF6719]/15 text-[#FF6719] tabular-nums">
                  {perspectiveResult.sourceCount} {perspectiveResult.sourceCount === 1 ? 'source' : 'sources'}
                </span>
              </div>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                All coverage of this story across {feeds.length} app sources
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onScanAllSources && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onScanAllSources(targetArticle);
                }}
                disabled={isScanningSources}
                title="Scan all app RSS sources for fresh coverage"
                className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold liquid-glass-pill text-stone-700 dark:text-stone-200 flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3 h-3 text-[#FF6719] ${isScanningSources ? 'animate-spin' : ''}`}
                />
                <span>{isScanningSources ? 'Syncing…' : 'Sync All'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                onClose();
              }}
              aria-label="Close Perspective sheet"
              className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Topic Keywords Filter Bar */}
        {perspectiveResult.queryKeywords.length > 0 && (
          <div className="px-4 py-2 bg-stone-100/70 dark:bg-white/[0.03] border-b border-stone-200/60 dark:border-white/[0.06] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            <Search className="w-3 h-3 text-stone-400 shrink-0 mr-0.5" />
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setCustomKeywordFilter(null);
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                customKeywordFilter === null
                  ? 'bg-[#FF6719] text-white font-semibold'
                  : 'bg-stone-200/70 dark:bg-white/[0.06] text-stone-600 dark:text-stone-300'
              }`}
            >
              All Matches ({perspectiveResult.matches.length + 1})
            </button>
            {perspectiveResult.queryKeywords.map((kw) => (
              <button
                key={kw}
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setCustomKeywordFilter((cur) => (cur === kw ? null : kw));
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                  customKeywordFilter === kw
                    ? 'bg-[#FF6719] text-white font-semibold'
                    : 'bg-stone-200/70 dark:bg-white/[0.06] text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                #{kw}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable Perspective Coverage List */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 no-scrollbar">
          {/* 1. Primary Selected Story */}
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
            Selected Story
          </div>
          <div
            onClick={() => handleTapStory(targetArticle)}
            className="p-3.5 rounded-2xl bg-[#FF6719]/[0.08] dark:bg-[#FF6719]/[0.12] border border-[#FF6719]/30 cursor-pointer hover:bg-[#FF6719]/[0.14] transition-all active:scale-[0.99]"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <SourceAvatar name={targetArticle.feedTitle} url={targetArticle.feedUrl} size="sm" />
                <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                  {targetArticle.feedTitle}
                </span>
                <span aria-hidden="true" className="text-stone-400">·</span>
                <span className="text-[11px] text-stone-500 dark:text-stone-400 whitespace-nowrap">
                  {formatRelativeTime(targetArticle.timestamp)}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FF6719] text-white shrink-0">
                Origin
              </span>
            </div>

            <h3 className="font-serif text-sm font-bold text-stone-950 dark:text-stone-50 leading-snug mb-1.5">
              {targetArticle.title}
            </h3>

            <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400 pt-1">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 tabular-nums">
                  <Clock className="w-3 h-3" />
                  {readingSpeedProfile
                    ? estimateArticleReadTime(targetArticle, readingSpeedProfile).minutes
                    : targetArticle.readTimeMin || 3}
                  m read
                </span>
                {hasFullBody(allArticles.find((a) => a.id === targetArticle.id) || targetArticle) ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3 h-3" />
                    Full text ready
                  </span>
                ) : extractingIds[targetArticle.id] ? (
                  <span className="text-[#FF6719] animate-pulse">Pre-loading full text…</span>
                ) : null}
              </div>
              <span className="font-semibold text-[#FF6719] flex items-center gap-1">
                {openingId === targetArticle.id ? (
                  <span>Opening full view…</span>
                ) : (
                  <>
                    <BookOpen className="w-3 h-3" />
                    <span>Read Full Story →</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* 2. All Matching Coverage Across App Sources */}
          <div className="pt-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Coverage Across App Sources ({totalMatches})
            </span>
          </div>

          {filteredMatches.length > 0 ? (
            <div className="space-y-2">
              {filteredMatches.map((match) => {
                const item = allArticles.find((a) => a.id === match.article.id) || match.article;
                const isReady = hasFullBody(item);
                const isExtracting = Boolean(extractingIds[item.id]);
                const isOpening = openingId === item.id;

                return (
                  <div
                    key={item.id}
                    onClick={() => handleTapStory(item)}
                    className="p-3.5 rounded-2xl bg-white/80 dark:bg-white/[0.04] border border-stone-200/80 dark:border-white/[0.08] hover:border-[#FF6719]/40 cursor-pointer transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <SourceAvatar name={item.feedTitle} url={item.feedUrl} size="sm" />
                        <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {item.feedTitle}
                        </span>
                        <span aria-hidden="true" className="text-stone-400">·</span>
                        <span className="text-[11px] text-stone-500 dark:text-stone-400 whitespace-nowrap">
                          {formatRelativeTime(item.timestamp)}
                        </span>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                          match.matchType === 'same-story'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-stone-200/80 dark:bg-white/10 text-stone-600 dark:text-stone-300'
                        }`}
                      >
                        {match.matchType === 'same-story' ? 'Same Story' : 'Related'}
                      </span>
                    </div>

                    <h4 className="font-serif text-sm font-bold text-stone-900 dark:text-stone-100 leading-snug mb-1">
                      {item.title}
                    </h4>

                    {item.summary && (
                      <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mb-2 leading-relaxed">
                        {item.summary}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400 pt-1 border-t border-stone-200/50 dark:border-white/[0.05]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex items-center gap-1 tabular-nums shrink-0">
                          <Clock className="w-3 h-3" />
                          {readingSpeedProfile
                            ? estimateArticleReadTime(item, readingSpeedProfile).minutes
                            : item.readTimeMin || 3}
                          m
                        </span>
                        {isReady ? (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium truncate">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            <span>Full text ready</span>
                          </span>
                        ) : isExtracting ? (
                          <span className="text-[#FF6719] animate-pulse truncate">
                            Loading full text…
                          </span>
                        ) : null}
                      </div>

                      <span className="font-semibold text-[#FF6719] shrink-0">
                        {isOpening ? 'Opening full view…' : 'Read in Reader →'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 px-4 rounded-2xl bg-stone-100/60 dark:bg-white/[0.03] border border-stone-200/60 dark:border-white/[0.06] text-center">
              <PerspectiveLogo className="w-6 h-6 text-[#FF6719] mx-auto mb-2 opacity-80" />
              <p className="font-serif text-sm font-semibold text-stone-800 dark:text-stone-200 mb-1">
                {isScanningSources
                  ? 'Scanning all app sources for matching coverage…'
                  : 'No other sources have published this exact story yet'}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
                Tap Sync All to query all {feeds.length} added RSS sources for new coverage of this topic.
              </p>
              {onScanAllSources && !isScanningSources && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    onScanAllSources(targetArticle);
                  }}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#FF6719] text-white shadow-sm active:scale-95 transition-transform"
                >
                  Sync All Sources Now
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
