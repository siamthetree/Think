import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  triggerHapticPull,
  triggerHapticDisarm,
  triggerHapticRelease,
  triggerHapticComplete,
  triggerHapticError,
} from '../utils/haptics';
import { resolveGestureAxisLock, type GestureAxisLock } from '../utils/touchGestures';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  isRefreshing: boolean;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  /** Set to true when the last refresh failed so the finish feedback is an error, not a success. */
  refreshFailed?: boolean;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

const THRESHOLD = 54; // Apple pull distance required to trigger refresh
const MAX_PULL = 92;  // Maximum elastic rubber-band distance

// Apple iOS Native 8-Spoke Activity Indicator
const IosActivityIndicator: React.FC<{
  isSpinning: boolean;
  rotationDeg: number;
  isTriggered: boolean;
}> = ({ isSpinning, rotationDeg, isTriggered }) => {
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <div
      className={`relative w-6 h-6 flex items-center justify-center transition-transform duration-150 ${
        isSpinning ? 'animate-spin' : ''
      }`}
      style={{
        transform: isSpinning ? undefined : `rotate(${rotationDeg}deg) scale(${isTriggered ? 1.08 : 1})`,
        animationDuration: '700ms',
        animationTimingFunction: 'linear',
      }}
      aria-hidden="true"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        {spokes.map((angle, i) => (
          <line
            key={angle}
            x1="12"
            y1="2.5"
            x2="12"
            y2="6"
            strokeWidth="2.2"
            strokeLinecap="round"
            className={isTriggered ? 'text-[#FF6719]' : 'text-stone-500 dark:text-stone-400'}
            style={{
              opacity: isSpinning ? (i + 1) / 8 : Math.max(0.2, (i + 1) / 8),
              transform: `rotate(${angle}deg)`,
              transformOrigin: '12px 12px',
            }}
          />
        ))}
      </svg>
    </div>
  );
};

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  isRefreshing,
  children,
  className = '',
  disabled = false,
  refreshFailed = false,
  onScroll,
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const axisLockRef = useRef<GestureAxisLock>('undecided');
  const isDraggingRef = useRef(false);
  const hasTriggeredHapticRef = useRef(false);
  const prevRefreshingRef = useRef(isRefreshing);

  // Monitor refresh completion to trigger Apple gentle completion vibration
  useEffect(() => {
    // When transition from refreshing -> finished
    if (prevRefreshingRef.current && !isRefreshing) {
      if (refreshFailed) triggerHapticError();
      else triggerHapticComplete();
      setPullDistance(0);
      setIsPulling(false);
      hasTriggeredHapticRef.current = false;
    }
    prevRefreshingRef.current = isRefreshing;
  }, [isRefreshing, refreshFailed]);

  // Touch Start handler
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (disabled || isRefreshing) return;
    const container = containerRef.current;
    if (!container) return;

    // Only allow pull-down if already scrolled to top
    if (container.scrollTop <= 1) {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      startXRef.current = clientX;
      startYRef.current = clientY;
      axisLockRef.current = 'undecided';
      isDraggingRef.current = true;
      hasTriggeredHapticRef.current = false;
    }
  };

  // Touch Move handler with Apple directional axis lock + rubber-banding
  const handleTouchMove = useCallback(
    (e: TouchEvent | MouseEvent) => {
      if (
        !isDraggingRef.current ||
        startYRef.current === null ||
        startXRef.current === null ||
        isRefreshing
      ) {
        return;
      }

      const container = containerRef.current;
      if (!container) return;

      // Ensure we are at top of scroll
      if (container.scrollTop > 1) {
        isDraggingRef.current = false;
        startXRef.current = null;
        startYRef.current = null;
        axisLockRef.current = 'undecided';
        setPullDistance(0);
        setIsPulling(false);
        hasTriggeredHapticRef.current = false;
        return;
      }

      const clientX =
        'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const clientY =
        'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const rawDx = clientX - startXRef.current;
      const rawDiff = clientY - startYRef.current;

      // Lock axis so horizontal swipes on DailyBriefingCard or ArticleCard never trigger PullToRefresh
      axisLockRef.current = resolveGestureAxisLock(axisLockRef.current, rawDx, rawDiff);
      if (axisLockRef.current === 'horizontal') {
        isDraggingRef.current = false;
        startXRef.current = null;
        startYRef.current = null;
        setPullDistance(0);
        setIsPulling(false);
        hasTriggeredHapticRef.current = false;
        return;
      }

      // Finger moving down from the top edge
      if (axisLockRef.current === 'vertical' && rawDiff > 6) {
        if (e.cancelable) {
          e.preventDefault();
        }
        setIsPulling(true);

        // Apple rubber-band elasticity curve
        const dampened = Math.min(MAX_PULL, Math.pow(rawDiff - 6, 0.8) * 1.6);
        setPullDistance(dampened);

        // Crisp Apple vibration at the exact moment threshold is reached
        if (dampened >= THRESHOLD) {
          if (!hasTriggeredHapticRef.current) {
            triggerHapticPull();
            hasTriggeredHapticRef.current = true;
          }
        } else {
          // Pulled back above the threshold: refresh is disarmed, so give a light tick
          if (hasTriggeredHapticRef.current && dampened < THRESHOLD - 8) {
            triggerHapticDisarm();
            hasTriggeredHapticRef.current = false;
          }
        }
      } else if (rawDiff < -10) {
        // User scrolling down into content
        isDraggingRef.current = false;
        startXRef.current = null;
        startYRef.current = null;
        axisLockRef.current = 'undecided';
        setPullDistance(0);
        setIsPulling(false);
        hasTriggeredHapticRef.current = false;
      } else {
        setPullDistance(0);
        setIsPulling(false);
      }
    },
    [isRefreshing]
  );

  // Touch End handler
  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    const wasPulling = pullDistance > 12;
    isDraggingRef.current = false;
    startXRef.current = null;
    startYRef.current = null;
    axisLockRef.current = 'undecided';
    setIsPulling(false);

    // Suppress accidental clicks on cards when ending drag
    if (wasPulling) {
      const suppressClick = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener('click', suppressClick, { capture: true, once: true });
      setTimeout(() => {
        window.removeEventListener('click', suppressClick, { capture: true });
      }, 300);
    }

    if (pullDistance >= THRESHOLD && !isRefreshing && !disabled) {
      // Hold at Apple compact refresh height (42px)
      setPullDistance(42);
      triggerHapticRelease();
      onRefresh();
    } else {
      // Snap back smoothly
      setPullDistance(0);
      hasTriggeredHapticRef.current = false;
    }
  }, [pullDistance, isRefreshing, disabled, onRefresh]);

  // Attach global touch listeners
  useEffect(() => {
    const handleGlobalMove = (e: TouchEvent | MouseEvent) => {
      if (isDraggingRef.current) {
        handleTouchMove(e);
      }
    };

    const handleGlobalEnd = () => {
      if (isDraggingRef.current) {
        handleTouchEnd();
      }
    };

    window.addEventListener('touchmove', handleGlobalMove, { passive: false });
    window.addEventListener('touchend', handleGlobalEnd);
    window.addEventListener('touchcancel', handleGlobalEnd);
    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalEnd);

    return () => {
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('touchend', handleGlobalEnd);
      window.removeEventListener('touchcancel', handleGlobalEnd);
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalEnd);
    };
  }, [handleTouchMove, handleTouchEnd]);

  const isTriggered = pullDistance >= THRESHOLD;
  const progressRatio = Math.min(1, pullDistance / THRESHOLD);
  const activeHeight = isRefreshing ? 42 : pullDistance;
  const rotationDeg = progressRatio * 270;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      onTouchStart={handleTouchStart}
      onMouseDown={handleTouchStart}
      data-testid="pull-to-refresh-container"
      className={`relative overflow-y-auto no-scrollbar ${className}`}
      style={{
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorY: 'contain',
      }}
    >
      {/* Apple-level minimal Activity Indicator (Zero text, pure visual & haptic) */}
      <div
        data-testid="pull-to-refresh-indicator"
        className="w-full flex items-center justify-center overflow-hidden pointer-events-none select-none"
        style={{
          height: `${activeHeight}px`,
          opacity: activeHeight > 6 ? Math.min(1, (activeHeight - 6) / 24) : 0,
          transition: isPulling ? 'none' : 'height 0.32s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease-out',
        }}
        aria-hidden="true"
      >
        <IosActivityIndicator
          isSpinning={isRefreshing}
          rotationDeg={rotationDeg}
          isTriggered={isTriggered}
        />
      </div>

      {/* Main Content */}
      <div
        style={{
          transform: isPulling && pullDistance > 0 ? 'translate3d(0, 0, 0)' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
};
