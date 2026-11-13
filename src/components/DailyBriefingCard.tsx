import React, { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Sparkles, BookOpen } from 'lucide-react';
import type { FeedItem } from '../types';
import type { DailyBriefingEdition } from '../utils/feedIntelligence';
import { formatRelativeTime } from '../utils/feedParser';
import { SourceAvatar } from './SourceAvatar';
import { triggerHapticSelection } from '../utils/haptics';
import {
  resolveGestureAxisLock,
  computeReleaseVelocity,
  classifyHorizontalSwipe,
  rubberBand,
  type GestureAxisLock,
  type VelocitySample,
} from '../utils/touchGestures';

interface DailyBriefingCardProps {
  briefing: DailyBriefingEdition;
  onSelectStory: (article: FeedItem) => void;
  onQuickPeek: (article: FeedItem) => void;
}

export const DailyBriefingCard: React.FC<DailyBriefingCardProps> = ({
  briefing,
  onSelectStory,
  onQuickPeek,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffsetX, setDragOffsetX] = useState(0);

  const touchSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    axisLock: GestureAxisLock;
    samples: VelocitySample[];
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  if (!briefing.stories || briefing.stories.length === 0) return null;

  const totalCount = briefing.stories.length;
  const safeIndex = Math.min(activeIndex, totalCount - 1);
  const currentStory = briefing.stories[safeIndex];
  const readCount = briefing.stories.filter((s) => s.isRead).length;
  const progressPct = totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0;

  // SVG Ring geometry (radius 11, circumference ~69.1)
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (progressPct / 100) * circumference;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    suppressNextClickRef.current = false;
    const now = performance.now();
    touchSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: now,
      axisLock: 'undecided',
      samples: [{ x: e.clientX, y: e.clientY, t: now }],
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = touchSessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    if (e.pointerType !== 'touch' && e.buttons !== 1) return;

    const dx = e.clientX - session.startX;
    const dy = e.clientY - session.startY;
    const now = performance.now();

    session.samples.push({ x: e.clientX, y: e.clientY, t: now });
    if (session.samples.length > 8) session.samples.shift();

    session.axisLock = resolveGestureAxisLock(session.axisLock, dx, dy);

    if (session.axisLock === 'horizontal') {
      suppressNextClickRef.current = true;
      try {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      setDragOffsetX(Math.round(rubberBand(dx, 92, 0.58)));
    }
  };

  const finishPointerGesture = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const session = touchSessionRef.current;
    touchSessionRef.current = null;
    setDragOffsetX(0);

    if (!session) return;
    try {
      if (e.currentTarget.hasPointerCapture(session.pointerId)) {
        e.currentTarget.releasePointerCapture(session.pointerId);
      }
    } catch {
      // ignore
    }

    if (cancelled || session.axisLock !== 'horizontal') return;

    const now = performance.now();
    session.samples.push({ x: e.clientX, y: e.clientY, t: now });
    const { vx } = computeReleaseVelocity(session.samples);

    const intent = classifyHorizontalSwipe({
      startX: session.startX,
      startY: session.startY,
      endX: e.clientX,
      endY: e.clientY,
      durationMs: now - session.startTime,
      velocityX: vx,
      edgeThreshold: 0,
      minSwipeDistance: 44,
    });

    if (intent === 'next-item') {
      triggerHapticSelection();
      setActiveIndex((i) => (i + 1) % totalCount);
    } else if (intent === 'prev-item') {
      triggerHapticSelection();
      setActiveIndex((i) => (i > 0 ? i - 1 : totalCount - 1));
    }
  };

  return (
    <section
      aria-label={briefing.editionTitle}
      className="mx-4 mt-2 mb-3 rounded-3xl liquid-glass border border-stone-200/80 dark:border-white/[0.12] overflow-hidden transition-all duration-200 select-none"
    >
      {/* Briefing Top Bar (Tap to expand/collapse) */}
      <div
        onClick={() => {
          triggerHapticSelection();
          setIsExpanded((v) => !v);
        }}
        className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Circular Progress Ring */}
          <div
            className="relative w-8 h-8 flex items-center justify-center shrink-0"
            title={`${readCount} of ${totalCount} briefing stories read`}
          >
            <svg className="w-8 h-8 -rotate-90" viewBox="0 0 28 28">
              <circle
                cx="14"
                cy="14"
                r={radius}
                fill="none"
                strokeWidth="2.5"
                className="stroke-stone-200 dark:stroke-white/10"
              />
              <circle
                cx="14"
                cy="14"
                r={radius}
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="stroke-[#FF6719] transition-all duration-300"
              />
            </svg>
            <span className="absolute text-[10px] font-mono font-bold tabular-nums text-stone-800 dark:text-stone-200">
              {readCount}/{totalCount}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
              <span className="font-semibold text-[#FF6719]">Essential Edition</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{briefing.totalReadMinutes}m total read</span>
            </div>
            <h2 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 truncate">
              {briefing.editionTitle}
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            triggerHapticSelection();
            setIsExpanded((v) => !v);
          }}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse daily briefing' : 'Expand daily briefing'}
          className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-white/10 transition-colors"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Collapsible Interactive 5-Story Carousel (Supports Horizontal Touch Swipe) */}
      {isExpanded && currentStory && (
        <div className="px-4 pb-3.5 pt-1 border-t border-stone-200/50 dark:border-white/[0.07]">
          {/* Active Story Card Content */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => finishPointerGesture(e, false)}
            onPointerCancel={(e) => finishPointerGesture(e, true)}
            onClick={() => {
              if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false;
                return;
              }
              triggerHapticSelection();
              onSelectStory(currentStory);
            }}
            style={{
              touchAction: 'pan-y',
              transform: dragOffsetX !== 0 ? `translate3d(${dragOffsetX}px, 0, 0)` : undefined,
              transition:
                dragOffsetX !== 0 ? 'none' : 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            className="cursor-pointer group py-2"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5 text-xs text-stone-500 dark:text-stone-400">
              <div className="flex items-center gap-2 min-w-0">
                <SourceAvatar name={currentStory.feedTitle} url={currentStory.feedUrl} size="sm" />
                <span className="font-semibold text-stone-800 dark:text-stone-200 truncate">
                  {currentStory.feedTitle}
                </span>
                <span aria-hidden="true">·</span>
                <span className="whitespace-nowrap">{formatRelativeTime(currentStory.timestamp)}</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-stone-400 dark:text-stone-500 shrink-0">
                {safeIndex + 1} of {totalCount}
              </span>
            </div>

            <h3
              className={`font-serif text-[17px] font-bold leading-snug group-hover:text-[#FF6719] transition-colors mb-1 ${
                currentStory.isRead
                  ? 'text-stone-500 dark:text-stone-400'
                  : 'text-stone-950 dark:text-stone-50'
              }`}
              style={{ textWrap: 'balance' }}
            >
              {currentStory.title}
            </h3>

            {currentStory.summary && (
              <p className="text-xs text-stone-600 dark:text-stone-300 line-clamp-2 leading-relaxed">
                {currentStory.summary}
              </p>
            )}
          </div>

          {/* Bottom Controls: Step Indicators + Actions */}
          <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-stone-200/40 dark:border-white/[0.06]">
            {/* Stepper Controls */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setActiveIndex((i) => (i > 0 ? i - 1 : totalCount - 1));
                }}
                aria-label="Previous briefing story"
                className="min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-white/10 transition-colors active:scale-90"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 px-1">
                {briefing.stories.map((story, idx) => (
                  <button
                    key={story.id}
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      setActiveIndex(idx);
                    }}
                    aria-label={`Briefing story ${idx + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === safeIndex
                        ? 'w-5 bg-[#FF6719]'
                        : story.isRead
                          ? 'w-1.5 bg-emerald-500/60'
                          : 'w-1.5 bg-stone-300 dark:bg-white/20'
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setActiveIndex((i) => (i + 1) % totalCount);
                }}
                aria-label="Next briefing story"
                className="min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-white/10 transition-colors active:scale-90"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Quick TL;DR & Read Story Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onQuickPeek(currentStory);
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/10 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#FF6719]" />
                <span>TL;DR</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onSelectStory(currentStory);
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 dark:bg-white text-white dark:text-stone-900 hover:opacity-90 flex items-center gap-1.5 transition-opacity whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Read</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
