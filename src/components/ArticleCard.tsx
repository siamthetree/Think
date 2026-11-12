import React, { useState, useRef } from 'react';
import {
  Bookmark,
  Share2,
  Heart,
  Repeat2,
  Sparkles,
  CheckCircle2,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { FeedItem } from '../types';
import { formatRelativeTime } from '../utils/feedParser';
import { SourceAvatar } from './SourceAvatar';
import {
  triggerHapticSelection,
  triggerHapticPull,
  triggerHapticDisarm,
  triggerHapticComplete,
} from '../utils/haptics';
import { isPlaceholderSummary } from '../utils/storage';
import {
  computeSwipeActionState,
  computeReleaseVelocity,
  shouldCommitSwipeAction,
  isDoubleTapGesture,
  type SwipeActionState,
  type GestureAxisLock,
  type VelocitySample,
} from '../utils/touchGestures';

interface ArticleCardProps {
  article: FeedItem;
  perspectives?: FeedItem[];
  viewMode?: 'magazine' | 'compact';
  onSelect: (article: FeedItem) => void;
  onToggleBookmark: (id: string, e?: React.MouseEvent) => void;
  onToggleRead: (id: string, e?: React.MouseEvent) => void;
  onOpenTagManager?: (article: FeedItem, e: React.MouseEvent) => void;
  onQuickPeek?: (article: FeedItem) => void;
}

const INITIAL_SWIPE_STATE: SwipeActionState = {
  offsetX: 0,
  direction: 'none',
  progress: 0,
  armed: false,
  axisLock: 'undecided',
};

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  perspectives = [],
  viewMode = 'magazine',
  onSelect,
  onToggleBookmark,
  onToggleRead,
  onQuickPeek,
}) => {
  const readTime = article.readTimeMin || 3;

  // Stable pseudo-random engagement counts based on article ID hash
  const pseudoCount = (seed: string, min: number, max: number) => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return min + (Math.abs(hash) % (max - min + 1));
  };

  const initialLikes = pseudoCount(article.id + '_like', 4, 68);
  const initialRestacks = pseudoCount(article.id + '_re', 1, 19);

  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(initialLikes);
  const [isRestacked, setIsRestacked] = useState(false);
  const [restacksCount, setRestacksCount] = useState(initialRestacks);
  const [isCopied, setIsCopied] = useState(false);
  const [likePopping, setLikePopping] = useState(false);
  const [doubleTapHeartBurst, setDoubleTapHeartBurst] = useState(false);
  const [cardPressed, setCardPressed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [showPerspectives, setShowPerspectives] = useState(false);

  // Horizontal Swipe-Action State (Right swipe = Save/Bookmark, Left swipe = Mark Read/Unread)
  const [swipeState, setSwipeState] = useState<SwipeActionState>(INITIAL_SWIPE_STATE);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    axisLock: GestureAxisLock;
    armed: boolean;
    samples: VelocitySample[];
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const lastCoverTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });

  const extractedSummary =
    article.summary && !isPlaceholderSummary(article.summary) ? article.summary.trim() : '';
  const extractedImage = article.imageUrl;

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    setCardPressed(true);
    suppressNextClickRef.current = false;

    const now = performance.now();
    touchSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      axisLock: 'undecided',
      armed: false,
      samples: [{ x: e.clientX, y: e.clientY, t: now }],
    };

    if (onQuickPeek) {
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        setCardPressed(false);
        suppressNextClickRef.current = true;
        touchSessionRef.current = null;
        triggerHapticSelection();
        onQuickPeek(article);
      }, 500);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const session = touchSessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    const dx = e.clientX - session.startX;
    const dy = e.clientY - session.startY;

    // Cancel long-press and pressed scale if finger moves > 8px in any direction
    if (Math.hypot(dx, dy) > 8) {
      clearLongPress();
      setCardPressed(false);
    }

    if (e.pointerType !== 'touch' && e.buttons !== 1) return;

    const now = performance.now();
    session.samples.push({ x: e.clientX, y: e.clientY, t: now });
    if (session.samples.length > 8) {
      session.samples.shift();
    }

    const nextSwipe = computeSwipeActionState(
      dx,
      dy,
      68,
      126,
      session.axisLock,
      session.armed
    );

    session.axisLock = nextSwipe.axisLock;

    // Once locked into horizontal swipe, capture pointer so movement stays 100% locked to this card
    if (nextSwipe.axisLock === 'horizontal') {
      suppressNextClickRef.current = true;
      try {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      } catch {
        // ignore if unsupported in synthetic events
      }
    }

    // Hysteresis Haptic Detents: crisp pull haptic on arm, light tick on disarm
    if (nextSwipe.armed && !session.armed) {
      session.armed = true;
      triggerHapticPull();
    } else if (!nextSwipe.armed && session.armed) {
      session.armed = false;
      triggerHapticDisarm();
    }

    if (nextSwipe.offsetX !== swipeState.offsetX || nextSwipe.armed !== swipeState.armed) {
      setSwipeState(nextSwipe);
    }
  };

  const finishPointerGesture = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    setCardPressed(false);
    clearLongPress();

    const session = touchSessionRef.current;
    touchSessionRef.current = null;

    if (session) {
      try {
        if (e.currentTarget.hasPointerCapture(session.pointerId)) {
          e.currentTarget.releasePointerCapture(session.pointerId);
        }
      } catch {
        // ignore
      }

      if (!cancelled && session.axisLock === 'horizontal') {
        session.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        const { vx } = computeReleaseVelocity(session.samples);
        const shouldCommit = shouldCommitSwipeAction({
          state: swipeState,
          velocityX: vx,
        });

        if (shouldCommit) {
          triggerHapticComplete();
          if (swipeState.direction === 'right') {
            onToggleBookmark(article.id);
          } else if (swipeState.direction === 'left') {
            onToggleRead(article.id);
          }
        }
      }
    }

    if (swipeState.offsetX !== 0 || swipeState.axisLock !== 'undecided') {
      setSwipeState(INITIAL_SWIPE_STATE);
    }
  };

  // Zero-latency single-tap on headline/card body opens the article immediately!
  const handleCardClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onSelect(article);
  };

  // Cover Image supports Double-Tap Heart Burst (while single tap still opens the article)
  const handleCoverClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    const now = Date.now();
    const isDouble = isDoubleTapGesture({
      lastTapTime: lastCoverTapRef.current.time,
      currentTime: now,
      lastX: lastCoverTapRef.current.x,
      lastY: lastCoverTapRef.current.y,
      currentX: e.clientX,
      currentY: e.clientY,
    });

    if (isDouble) {
      if (coverTapTimerRef.current) {
        clearTimeout(coverTapTimerRef.current);
        coverTapTimerRef.current = null;
      }
      lastCoverTapRef.current = { time: 0, x: 0, y: 0 };
      triggerHapticComplete();
      setLikePopping(true);
      setDoubleTapHeartBurst(true);
      setTimeout(() => setLikePopping(false), 450);
      setTimeout(() => setDoubleTapHeartBurst(false), 680);
      if (!isLiked) {
        setIsLiked(true);
        setLikesCount((c) => c + 1);
      }
      return;
    }

    lastCoverTapRef.current = { time: now, x: e.clientX, y: e.clientY };
    if (coverTapTimerRef.current) clearTimeout(coverTapTimerRef.current);
    coverTapTimerRef.current = setTimeout(() => {
      coverTapTimerRef.current = null;
      onSelect(article);
    }, 200);
  };

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticSelection();
    setLikePopping(true);
    setTimeout(() => setLikePopping(false), 400);
    setIsLiked((prev) => {
      const next = !prev;
      setLikesCount((c) => (next ? c + 1 : c - 1));
      return next;
    });
  };

  const handleRestack = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticSelection();
    setIsRestacked((prev) => {
      const next = !prev;
      setRestacksCount((c) => (next ? c + 1 : c - 1));
      return next;
    });
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticSelection();
    if (navigator.share) {
      try {
        await navigator.share({
          title: article.title,
          text: article.summary,
          url: article.link,
        });
        return;
      } catch {
        // Fall back to copy
      }
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(article.link);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Swipe Action Background Layer (revealed when swiping right or left)
  const renderSwipeActionTray = () => {
    if (swipeState.offsetX === 0) return null;
    const isRight = swipeState.direction === 'right';
    const iconScale = Math.min(1.15, 0.8 + swipeState.progress * 0.35);

    return (
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-between px-5 pointer-events-none select-none transition-colors duration-150 ${
          isRight
            ? swipeState.armed
              ? 'bg-[#FF6719]/25 dark:bg-[#FF6719]/30'
              : 'bg-stone-200/70 dark:bg-white/[0.06]'
            : swipeState.armed
              ? 'bg-emerald-500/25 dark:bg-emerald-500/30'
              : 'bg-stone-200/70 dark:bg-white/[0.06]'
        }`}
      >
        {/* Left Tray (Swipe Right -> Bookmark / Save) */}
        <div
          style={{
            transform: `scale(${isRight ? iconScale : 0.85})`,
            opacity: isRight ? Math.max(0.35, swipeState.progress) : 0,
          }}
          className={`flex items-center gap-2 text-xs font-semibold transition-transform duration-100 ${
            swipeState.armed ? 'text-[#FF6719]' : 'text-stone-600 dark:text-stone-300'
          }`}
        >
          <Bookmark className={`w-4 h-4 ${article.isBookmarked || swipeState.armed ? 'fill-current' : ''}`} />
          <span>{article.isBookmarked ? 'Remove Saved' : 'Save Story'}</span>
        </div>

        {/* Right Tray (Swipe Left -> Mark Read / Unread) */}
        <div
          style={{
            transform: `scale(${!isRight ? iconScale : 0.85})`,
            opacity: !isRight ? Math.max(0.35, swipeState.progress) : 0,
          }}
          className={`flex items-center gap-2 text-xs font-semibold transition-transform duration-100 ml-auto ${
            swipeState.armed
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-stone-600 dark:text-stone-300'
          }`}
        >
          <span>{article.isRead ? 'Mark Unread' : 'Mark Read'}</span>
          <CheckCircle2 className="w-4 h-4" />
        </div>
      </div>
    );
  };

  // Compact Scanner View
  if (viewMode === 'compact') {
    return (
      <div className="relative overflow-hidden border-b border-stone-200/60 dark:border-white/[0.08]">
        {renderSwipeActionTray()}
        <article
          onClick={handleCardClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => finishPointerGesture(e, false)}
          onPointerCancel={(e) => finishPointerGesture(e, true)}
          style={{
            transform:
              swipeState.offsetX !== 0
                ? `translate3d(${swipeState.offsetX}px, 0, 0)`
                : undefined,
            transition:
              swipeState.offsetX !== 0
                ? 'none'
                : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
            touchAction: 'pan-y',
          }}
          className={`relative bg-stone-50 dark:bg-[#090A0C] group cursor-pointer px-4 sm:px-5 py-3 hover:bg-stone-100/50 dark:hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-3 select-none ${
            article.isRead ? 'opacity-70' : ''
          }`}
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <SourceAvatar name={article.feedTitle} url={article.feedUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mb-0.5">
                <span className="font-semibold text-stone-700 dark:text-stone-300 truncate max-w-[140px]">
                  {article.feedTitle}
                </span>
                <span aria-hidden="true">·</span>
                <span className="whitespace-nowrap">{formatRelativeTime(article.timestamp)}</span>
                {perspectives.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#FF6719] font-medium whitespace-nowrap">
                      +{perspectives.length} sources
                    </span>
                  </>
                )}
              </div>
              <h2
                className={`text-sm truncate font-serif ${
                  article.isRead
                    ? 'text-stone-500 dark:text-stone-400 font-normal'
                    : 'text-stone-900 dark:text-stone-100 font-bold group-hover:text-[#FF6719] transition-colors'
                }`}
              >
                {article.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {onQuickPeek && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onQuickPeek(article);
                }}
                aria-label={`Quick peek ${article.title}`}
                title="3-Bullet TL;DR"
                className="p-2 rounded-full text-stone-400 hover:text-[#FF6719] transition-colors active:scale-90"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                triggerHapticSelection();
                onToggleBookmark(article.id, e);
              }}
              aria-label={article.isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
              title={article.isBookmarked ? 'Saved' : 'Save'}
              className={`p-2 rounded-full transition-colors active:scale-90 ${
                article.isBookmarked
                  ? 'text-[#FF6719]'
                  : 'text-stone-400 hover:text-[#FF6719] dark:text-stone-500 dark:hover:text-stone-300'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${article.isBookmarked ? 'fill-current' : ''}`} />
            </button>
          </div>
        </article>
      </div>
    );
  }

  const coverUrl = article.imageUrl || extractedImage;
  const hasCover = Boolean(coverUrl && !imageFailed);
  const displaySummary =
    article.summary && !isPlaceholderSummary(article.summary)
      ? article.summary
      : extractedSummary;

  return (
    <div className="relative overflow-hidden border-b border-stone-200/70 dark:border-white/[0.08]">
      {renderSwipeActionTray()}
      <article
        onClick={handleCardClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishPointerGesture(e, false)}
        onPointerCancel={(e) => finishPointerGesture(e, true)}
        className={`article-card relative bg-stone-50 dark:bg-[#090A0C] group cursor-pointer px-4 sm:px-5 pt-4 pb-3.5 select-none ${
          article.isRead ? 'feed-row-read opacity-85' : ''
        }`}
        style={{
          touchAction: 'pan-y',
          transform:
            swipeState.offsetX !== 0
              ? `translate3d(${swipeState.offsetX}px, 0, 0)`
              : cardPressed
                ? 'scale(0.985)'
                : undefined,
          transition:
            swipeState.offsetX !== 0
              ? 'none'
              : cardPressed
                ? 'transform 90ms cubic-bezier(0.4,0,1,1)'
                : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Double-Tap Heart Burst Overlay */}
        {doubleTapHeartBurst && (
          <div
            aria-hidden="true"
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none animate-in zoom-in-75 fade-in duration-150"
          >
            <div className="w-16 h-16 rounded-full liquid-glass-pill flex items-center justify-center shadow-2xl">
              <Heart className="w-8 h-8 fill-[#FF4B4B] text-[#FF4B4B] like-pop" />
            </div>
          </div>
        )}

        {/* 1. Publisher Header Row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <SourceAvatar name={article.feedTitle} url={article.feedUrl} size="sm" />
            <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 truncate">
              <span className="font-semibold text-stone-800 dark:text-stone-200 truncate max-w-[160px] sm:max-w-xs">
                {article.feedTitle}
              </span>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
              <span className="whitespace-nowrap">{formatRelativeTime(article.timestamp)}</span>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
              <span className="whitespace-nowrap flex items-center gap-1 tabular-nums">
                <Clock className="w-3 h-3 text-stone-400" />
                {readTime}m read
              </span>
            </div>
          </div>

          {/* Right: Read / Unread toggle */}
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => onToggleRead(article.id, e)}
              aria-label={article.isRead ? 'Mark story as unread' : 'Mark story as read'}
              title={article.isRead ? 'Mark as unread' : 'Unread story (tap to mark read)'}
              className={`p-1 rounded-full transition-colors ${
                article.isRead
                  ? 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-200'
                  : 'text-[#FF6719] hover:opacity-80'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 2. Headline: High-Contrast Editorial Serif */}
        <h2
          className={`font-serif text-[19px] sm:text-[21px] font-bold leading-[1.3] text-stone-950 dark:text-stone-50 group-hover:text-[#FF6719] transition-colors mb-1.5 ${
            article.isRead ? 'text-stone-600 dark:text-stone-400 font-semibold' : ''
          }`}
          style={{ textWrap: 'balance' }}
        >
          {article.title}
        </h2>

        {/* 3. Subtitle / Excerpt: Clean Editorial Prose */}
        {displaySummary && (
          <p
            className={`font-sans text-[14px] leading-relaxed line-clamp-2 sm:line-clamp-3 mb-3 ${
              article.isRead
                ? 'text-stone-500 dark:text-stone-400'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            {displaySummary}
          </p>
        )}

        {/* 4. Large Featured Cover Image (16:9 Aspect Ratio — Double-tap to Like, Single-tap to Read) */}
        {hasCover && (
          <div
            onClick={handleCoverClick}
            className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-900 border border-stone-200/60 dark:border-white/[0.08] mb-3 shadow-xs"
          >
            <img
              src={coverUrl}
              alt={article.title}
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
              onError={() => setImageFailed(true)}
            />
          </div>
        )}

        {/* 4b. Multi-Source Developing Story Perspectives Cluster (when related coverage exists) */}
        {perspectives.length > 0 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mb-3 rounded-2xl bg-stone-100/80 dark:bg-white/[0.04] border border-stone-200/70 dark:border-white/[0.08] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setShowPerspectives((v) => !v);
              }}
              aria-expanded={showPerspectives}
              className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-200/50 dark:hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="w-3.5 h-3.5 text-[#FF6719] shrink-0" />
                <span className="font-semibold text-stone-900 dark:text-stone-100">
                  Developing Story
                </span>
                <span aria-hidden="true" className="text-stone-400">·</span>
                <span className="text-stone-500 dark:text-stone-400 truncate tabular-nums">
                  +{perspectives.length} {perspectives.length === 1 ? 'perspective' : 'perspectives'} from other sources
                </span>
              </div>
              {showPerspectives ? (
                <ChevronUp className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              )}
            </button>

            {showPerspectives && (
              <div className="divide-y divide-stone-200/60 dark:divide-white/[0.06] border-t border-stone-200/60 dark:border-white/[0.06]">
                {perspectives.map((pItem) => (
                  <div
                    key={pItem.id}
                    onClick={() => {
                      triggerHapticSelection();
                      onSelect(pItem);
                    }}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-stone-200/40 dark:hover:bg-white/[0.05] cursor-pointer transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400 mb-0.5">
                        <SourceAvatar name={pItem.feedTitle} url={pItem.feedUrl} size="sm" />
                        <span className="font-semibold text-stone-800 dark:text-stone-200 truncate">
                          {pItem.feedTitle}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeTime(pItem.timestamp)}</span>
                      </div>
                      <h4 className="font-serif text-xs font-semibold text-stone-900 dark:text-stone-100 line-clamp-1">
                        {pItem.title}
                      </h4>
                    </div>
                    <span className="text-[11px] font-semibold text-[#FF6719] shrink-0">
                      Read →
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 5. Minimal Social & Utility Action Ribbon (Like, Restack, TL;DR Quick Peek, Share & Bookmark) */}
        <div
          className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 pt-1 border-t border-stone-100 dark:border-white/[0.05]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left: Like, Restack, Quick TL;DR Peek */}
          <div className="flex items-center gap-4 sm:gap-5">
            <button
              type="button"
              onClick={handleLike}
              aria-label="Like story"
              className={`flex items-center gap-1.5 py-1 px-1 -ml-1 rounded-lg transition-all tabular-nums ${
                isLiked
                  ? 'text-[#FF4B4B] font-semibold'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
            >
              <Heart
                className={`w-4 h-4 transition-transform active:scale-125 duration-150 ${
                  isLiked ? 'fill-[#FF4B4B] text-[#FF4B4B]' : 'stroke-[1.75]'
                } ${likePopping ? 'like-pop' : ''}`}
              />
              <span className="text-[12px]">{likesCount}</span>
            </button>

            <button
              type="button"
              onClick={handleRestack}
              aria-label="Restack story"
              className={`flex items-center gap-1.5 py-1 px-1 rounded-lg transition-all tabular-nums ${
                isRestacked
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
            >
              <Repeat2
                className={`w-4 h-4 transition-transform active:rotate-180 duration-200 ${
                  isRestacked ? 'text-emerald-600 dark:text-emerald-400 stroke-[2.2]' : 'stroke-[1.75]'
                }`}
              />
              <span className="text-[12px]">{restacksCount}</span>
            </button>

            {onQuickPeek && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onQuickPeek(article);
                }}
                aria-label={`Quick peek TL;DR for ${article.title}`}
                title="Instant 3-Bullet TL;DR"
                className="flex items-center gap-1 py-1 px-1.5 rounded-lg text-stone-500 dark:text-stone-400 hover:text-[#FF6719] dark:hover:text-[#FF6719] transition-colors whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#FF6719]" />
                <span className="text-[12px] font-medium">TL;DR</span>
              </button>
            )}
          </div>

          {/* Right: Share & Bookmark */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleShare}
              aria-label="Share story link"
              title="Share story"
              className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/[0.06] transition-colors relative min-w-[32px] min-h-[32px] flex items-center justify-center active:scale-90"
            >
              <Share2 className="w-4 h-4 stroke-[1.75]" />
              {isCopied && (
                <span className="absolute -top-7 right-0 px-2 py-0.5 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 rounded-md text-[10px] font-medium shadow-md whitespace-nowrap animate-in fade-in duration-100">
                  Copied!
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={(e) => {
                triggerHapticSelection();
                onToggleBookmark(article.id, e);
              }}
              aria-label={article.isBookmarked ? 'Remove from Saved' : 'Save story'}
              title={article.isBookmarked ? 'Saved to Bookmarks' : 'Save to Bookmarks'}
              className={`p-1.5 rounded-full transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center active:scale-90 ${
                article.isBookmarked
                  ? 'text-[#FF6719]'
                  : 'text-stone-400 hover:text-[#FF6719] dark:text-stone-400 dark:hover:text-white'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${article.isBookmarked ? 'fill-current' : 'stroke-[1.75]'}`} />
            </button>
          </div>
        </div>
      </article>
    </div>
  );
};
