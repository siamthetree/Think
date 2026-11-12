import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  getStoryBackdropTheme,
  renderStoryStickerCanvas,
  type StoryCardPayload,
} from '../utils/storyCardRenderer';
import {
  DEFAULT_STORY_CARD_TRANSFORM,
  clampStoryCardTransform,
  computeTwoFingerTransform,
  isStoryTransformModified,
  type StoryCardTransform,
  type TouchPoint2D,
} from '../utils/mediaShare';
import { isDoubleTapGesture } from '../utils/touchGestures';
import { triggerHapticSelection, triggerHapticComplete } from '../utils/haptics';

interface InteractiveStoryPreviewProps {
  payload: StoryCardPayload;
  transform: StoryCardTransform;
  onChangeTransform: (next: StoryCardTransform) => void;
  compact?: boolean;
}

export const InteractiveStoryPreview: React.FC<InteractiveStoryPreviewProps> = ({
  payload,
  transform,
  onChangeTransform,
  compact = false,
}) => {
  const [stickerUrl, setStickerUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pinchRef = useRef<{
    p1: TouchPoint2D;
    p2: TouchPoint2D;
    base: StoryCardTransform;
  } | null>(null);

  const panRef = useRef<{
    startX: number;
    startY: number;
    base: StoryCardTransform;
    moved: boolean;
  } | null>(null);

  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });

  // Render transparent foreground card sticker whenever content/mode/theme changes
  // (Background gradient updates instantaneously without re-rendering when dragging/pinching)
  useEffect(() => {
    let cancelled = false;
    renderStoryStickerCanvas({
      mode: payload.mode,
      themeId: payload.themeId,
      headline: payload.headline,
      publisher: payload.publisher,
      author: payload.author,
      readTimeMin: payload.readTimeMin,
      imageUrl: payload.imageUrl,
      quoteText: payload.quoteText,
      attributionUrl: payload.attributionUrl,
      stats: payload.stats,
    }).then((canvas) => {
      if (cancelled) return;
      try {
        setStickerUrl(canvas.toDataURL('image/png'));
      } catch {
        setStickerUrl(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    payload.mode,
    payload.themeId,
    payload.headline,
    payload.publisher,
    payload.author,
    payload.readTimeMin,
    payload.imageUrl,
    payload.quoteText,
    payload.attributionUrl,
    payload.stats,
  ]);

  const theme = getStoryBackdropTheme(payload.themeId);
  const modified = isStoryTransformModified(transform);
  const pillLabel =
    payload.mode === 'song'
      ? 'READING NOW'
      : payload.mode === 'lyrics'
        ? 'KEY PASSAGE'
        : 'READING RECAP';

  const getSize = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      width: rect?.width || 176,
      height: rect?.height || 313,
    };
  };

  const handleReset = () => {
    triggerHapticComplete();
    onChangeTransform(DEFAULT_STORY_CARD_TRANSFORM);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 2) {
      panRef.current = null;
      pinchRef.current = {
        p1: { x: e.touches[0].clientX, y: e.touches[0].clientY },
        p2: { x: e.touches[1].clientX, y: e.touches[1].clientY },
        base: transform,
      };
      triggerHapticSelection();
      return;
    }

    if (e.touches.length === 1) {
      pinchRef.current = null;
      const t = e.touches[0];
      panRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        base: transform,
        moved: false,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    const { width, height } = getSize();

    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const next = computeTwoFingerTransform({
        startP1: pinchRef.current.p1,
        startP2: pinchRef.current.p2,
        currP1: { x: e.touches[0].clientX, y: e.touches[0].clientY },
        currP2: { x: e.touches[1].clientX, y: e.touches[1].clientY },
        baseTransform: pinchRef.current.base,
        containerWidth: width,
        containerHeight: height,
      });
      onChangeTransform(next);
      return;
    }

    if (e.touches.length === 1 && panRef.current) {
      const t = e.touches[0];
      const dx = t.clientX - panRef.current.startX;
      const dy = t.clientY - panRef.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        panRef.current.moved = true;
      }
      onChangeTransform(
        clampStoryCardTransform({
          ...panRef.current.base,
          offsetX: panRef.current.base.offsetX + dx / width,
          offsetY: panRef.current.base.offsetY + dy / height,
        })
      );
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.touches.length === 1 && pinchRef.current) {
      // Transition cleanly from 2-finger pinch to 1-finger pan without jump
      pinchRef.current = null;
      panRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        base: transform,
        moved: true,
      };
      return;
    }

    if (e.touches.length === 0) {
      pinchRef.current = null;
      const wasTap = panRef.current && !panRef.current.moved;
      panRef.current = null;
      if (wasTap && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const now = Date.now();
        if (
          isDoubleTapGesture({
            lastTapTime: lastTapRef.current.time,
            currentTime: now,
            lastX: lastTapRef.current.x,
            lastY: lastTapRef.current.y,
            currentX: touch.clientX,
            currentY: touch.clientY,
          })
        ) {
          lastTapRef.current = { time: 0, x: 0, y: 0 };
          handleReset();
          return;
        }
        lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
      }
    }
  };

  // Mouse / single-pointer drag support (stops propagation from dismissing parent modal)
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      base: transform,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.pointerType === 'touch' || !panRef.current) return;
    const { width, height } = getSize();
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    if (Math.hypot(dx, dy) > 3) panRef.current.moved = true;
    onChangeTransform(
      clampStoryCardTransform({
        ...panRef.current.base,
        offsetX: panRef.current.base.offsetX + dx / width,
        offsetY: panRef.current.base.offsetY + dy / height,
      })
    );
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.pointerType === 'touch') return;
    const wasClick = panRef.current && !panRef.current.moved;
    panRef.current = null;
    if (wasClick) {
      const now = Date.now();
      if (
        isDoubleTapGesture({
          lastTapTime: lastTapRef.current.time,
          currentTime: now,
          lastX: lastTapRef.current.x,
          lastY: lastTapRef.current.y,
          currentX: e.clientX,
          currentY: e.clientY,
        })
      ) {
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        handleReset();
        return;
      }
      lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
    }
  };

  // Trackpad pinch-to-scale (ctrl+wheel) without touching the background gradient
  const handleWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = 1 - e.deltaY * 0.008;
    onChangeTransform(
      clampStoryCardTransform({
        ...transform,
        scale: transform.scale * factor,
      })
    );
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        style={{
          touchAction: 'none',
          background: `linear-gradient(150deg, ${theme.topColor} 0%, ${theme.midColor} 40%, ${theme.bottomColor} 100%)`,
        }}
        className={`relative ${
          compact ? 'w-36' : 'w-44'
        } aspect-[9/16] rounded-2xl overflow-hidden border border-white/15 shadow-2xl select-none cursor-grab active:cursor-grabbing transition-[width] duration-200`}
      >
        {/* Fixed Static Radial Highlight + Top Pill (never moves when adjusting the card) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 78% 14%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 55%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[6%] left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-white/15 text-[6px] font-bold tracking-wider text-white/95 whitespace-nowrap"
        >
          {pillLabel}
        </div>

        {/* Independent Foreground Card Sticker (Pinch, Rotate & Drag without changing Background Color) */}
        {stickerUrl ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              transform: `translate3d(${transform.offsetX * 100}%, ${transform.offsetY * 100}%, 0)`,
            }}
          >
            <img
              src={stickerUrl}
              alt="Story Card Preview"
              draggable={false}
              style={{
                top: '51.82%',
                left: '50%',
                width: '92.6%',
                transform: `translate(-50%, -50%) rotate(${transform.rotationDeg}deg) scale(${transform.scale})`,
                transformOrigin: 'center center',
              }}
              className="absolute h-auto object-contain select-none"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-[#FF6719] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 min-h-[20px]">
        <span className="text-[10px] text-stone-400 whitespace-nowrap">
          Pinch or drag card · Background stays fixed
        </span>
        {modified && (
          <button
            type="button"
            onClick={handleReset}
            aria-label="Reset card position"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-[10px] font-medium text-stone-200 transition-colors"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>
        )}
      </div>
    </div>
  );
};
