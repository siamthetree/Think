import React, { useMemo, useState, useRef } from 'react';
import { X, Sparkles, BookOpen, Bookmark, Clock } from 'lucide-react';
import type { FeedItem } from '../types';
import { generateQuickTldrBullets } from '../utils/feedIntelligence';
import { formatRelativeTime } from '../utils/feedParser';
import { SourceAvatar } from './SourceAvatar';
import { triggerHapticSelection } from '../utils/haptics';
import { computeSheetDragState } from '../utils/touchGestures';

interface QuickPeekModalProps {
  article: FeedItem | null;
  onClose: () => void;
  onReadFull: (article: FeedItem) => void;
  onToggleBookmark: (id: string) => void;
}

export const QuickPeekModal: React.FC<QuickPeekModalProps> = ({
  article,
  onClose,
  onReadFull,
  onToggleBookmark,
}) => {
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartRef = useRef<{ y: number; time: number } | null>(null);

  const bullets = useMemo(() => {
    if (!article) return [];
    return generateQuickTldrBullets(article);
  }, [article]);

  if (!article) return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragStartRef.current = { y: e.clientY, time: Date.now() };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    if (e.pointerType !== 'touch' && e.buttons !== 1) return;
    const dy = e.clientY - dragStartRef.current.y;
    const state = computeSheetDragState(dy, 0, 84);
    setDragOffsetY(state.offsetY);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dy = e.clientY - dragStartRef.current.y;
    const dt = Math.max(1, Date.now() - dragStartRef.current.time);
    const velocityY = dy / dt;
    dragStartRef.current = null;

    const state = computeSheetDragState(dy, velocityY, 84);
    setDragOffsetY(0);
    if (state.shouldDismiss) {
      triggerHapticSelection();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Story Quick Peek TL;DR"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-8 bg-black/55 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        style={{
          touchAction: 'none',
          transform: dragOffsetY !== 0 ? `translate3d(0, ${dragOffsetY}px, 0)` : undefined,
          transition:
            dragOffsetY !== 0 ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="w-full max-w-md rounded-3xl reader-liquid-card p-5 text-stone-100 shadow-2xl border border-white/20 animate-in zoom-in-95 duration-150 select-none"
      >
        {/* Drag Handle (Swipe down to dismiss) */}
        <div className="w-10 h-1 bg-white/25 rounded-full mx-auto mb-3 cursor-grab active:cursor-grabbing" />

        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 mb-3.5 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-[#FF6719] shrink-0" />
            <span className="text-xs font-semibold text-stone-200 truncate">
              3-Bullet Quick Peek
            </span>
            <span aria-hidden="true" className="text-stone-500">·</span>
            <span className="text-xs text-stone-400 flex items-center gap-1 whitespace-nowrap tabular-nums">
              <Clock className="w-3 h-3" />
              {article.readTimeMin || 3}m read
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onClose();
            }}
            aria-label="Close quick peek"
            className="min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source & Headline */}
        <div className="mb-4">
          <div className="flex items-center gap-2 text-xs text-stone-400 mb-1.5">
            <SourceAvatar name={article.feedTitle} url={article.feedUrl} size="sm" />
            <span className="font-semibold text-stone-200 truncate">{article.feedTitle}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRelativeTime(article.timestamp)}</span>
          </div>

          <h3
            className="font-serif text-lg font-bold text-white leading-snug"
            style={{ textWrap: 'balance' }}
          >
            {article.title}
          </h3>
        </div>

        {/* 3 Key Takeaway Bullets */}
        <div className="space-y-2.5 mb-5 py-3 px-3.5 rounded-2xl bg-black/30 border border-white/10">
          <div className="text-[11px] font-medium text-stone-400 mb-1">Key Takeaways</div>
          <ul className="space-y-2.5 text-[13.5px] leading-relaxed text-stone-200 font-sans">
            {bullets.map((bullet, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="font-mono text-xs font-bold text-[#FF6719] tabular-nums mt-0.5 shrink-0">
                  0{idx + 1}.
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onToggleBookmark(article.id);
            }}
            aria-label={article.isBookmarked ? 'Remove bookmark' : 'Save story for later'}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              article.isBookmarked
                ? 'border-[#FF6719]/50 bg-[#FF6719]/15 text-[#FF6719]'
                : 'border-white/15 bg-white/5 text-stone-200 hover:bg-white/10'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${article.isBookmarked ? 'fill-current' : ''}`} />
            <span>{article.isBookmarked ? 'Saved' : 'Save'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onClose();
              onReadFull(article);
            }}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-[#FF6719] hover:bg-[#e85a12] text-white flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Open Distraction-Free Reader</span>
          </button>
        </div>
      </div>
    </div>
  );
};
