import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  X,
  Copy,
  Download,
  Check,
  Quote,
  Instagram,
  Share2,
  AlignLeft,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { FeedItem } from '../types';
import { generateQuickTldrBullets } from '../utils/feedIntelligence';
import {
  extractSelectableArticleLines,
  composeSelectedQuote,
  sanitizeTextSelection,
} from '../utils/articleLines';
import {
  SPOTIFY_BACKDROP_THEMES,
  shareSpotifyStyleStory,
  type StoryBackdropThemeId,
  type StoryCardMode,
} from '../utils/storyCardRenderer';
import {
  DEFAULT_STORY_CARD_TRANSFORM,
  type StoryCardTransform,
} from '../utils/mediaShare';
import { InteractiveStoryPreview } from './InteractiveStoryPreview';
import { triggerHapticSelection, triggerHapticComplete } from '../utils/haptics';
import { computeSheetDragState, classifyHorizontalSwipe } from '../utils/touchGestures';

interface QuoteShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  article: FeedItem;
  initialQuoteText?: string;
  articleText?: string;
}

export const QuoteShareModal: React.FC<QuoteShareModalProps> = ({
  isOpen,
  onClose,
  article,
  initialQuoteText,
  articleText,
}) => {
  const articleLines = useMemo(() => {
    const extracted = extractSelectableArticleLines({
      articleText,
      contentHtml: article.contentHtml,
      contentClean: article.contentClean,
      summary: article.summary,
      title: article.title,
      maxLines: 60,
    });
    if (extracted.length > 0) return extracted;
    const tldr = generateQuickTldrBullets(article);
    return tldr.length > 0 ? tldr : [article.title];
  }, [article, articleText]);

  const [selectedLineIndices, setSelectedLineIndices] = useState<number[]>([0]);
  const [customHighlightedText, setCustomHighlightedText] = useState<string | null>(null);
  const [showLinePicker, setShowLinePicker] = useState<boolean>(true);
  const [storyMode, setStoryMode] = useState<StoryCardMode>('lyrics');
  const [themeId, setThemeId] = useState<StoryBackdropThemeId>('sunset');
  const [copied, setCopied] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [cardTransform, setCardTransform] = useState<StoryCardTransform>(
    DEFAULT_STORY_CARD_TRANSFORM
  );
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lineListRef = useRef<HTMLDivElement>(null);

  // Sync line picker & highlighted selection whenever modal opens for a story/highlight
  useEffect(() => {
    if (!isOpen) {
      setCardTransform(DEFAULT_STORY_CARD_TRANSFORM);
      return;
    }

    const sanitizedInitial = sanitizeTextSelection(initialQuoteText || '');
    if (sanitizedInitial) {
      const normalizedInit = sanitizedInitial.toLowerCase();
      const matchedIdx = articleLines.findIndex(
        (line) =>
          line.toLowerCase() === normalizedInit ||
          (normalizedInit.length >= 20 && line.toLowerCase().includes(normalizedInit))
      );

      if (matchedIdx !== -1 && articleLines[matchedIdx].toLowerCase() === normalizedInit) {
        setSelectedLineIndices([matchedIdx]);
        setCustomHighlightedText(null);
      } else {
        setSelectedLineIndices(matchedIdx !== -1 ? [matchedIdx] : [0]);
        setCustomHighlightedText(sanitizedInitial);
      }
      setStoryMode('lyrics');
      setShowLinePicker(false);
    } else {
      setSelectedLineIndices([0]);
      setCustomHighlightedText(null);
      setStoryMode('lyrics');
      setShowLinePicker(articleLines.length > 1);
    }
  }, [isOpen, initialQuoteText, article.id, articleLines]);

  const activeQuote = useMemo(() => {
    if (customHighlightedText) return customHighlightedText;
    return composeSelectedQuote(articleLines, selectedLineIndices, article.title);
  }, [customHighlightedText, articleLines, selectedLineIndices, article.title]);

  const payload = useMemo(
    () => ({
      mode: storyMode,
      themeId,
      headline: article.title,
      publisher: article.feedTitle,
      author: article.author,
      readTimeMin: article.readTimeMin || 3,
      imageUrl: article.imageUrl,
      quoteText: activeQuote,
      attributionUrl: article.link,
      transform: cardTransform,
    }),
    [storyMode, themeId, article, activeQuote, cardTransform]
  );

  if (!isOpen) return null;

  const handleTapArticleLine = (idx: number) => {
    triggerHapticSelection();
    setCustomHighlightedText(null);
    setSelectedLineIndices((prev) => {
      if (prev.includes(idx)) {
        if (prev.length === 1) return prev;
        return prev.filter((i) => i !== idx);
      }
      const min = Math.min(...prev);
      const max = Math.max(...prev);
      // Spotify Lyrics-style selection: tapping an adjacent line extends up to 3 lines;
      // tapping elsewhere focuses cleanly on that tapped line.
      if (prev.length < 3 && (idx === min - 1 || idx === max + 1)) {
        return [...prev, idx].sort((a, b) => a - b);
      }
      return [idx];
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    if (e.pointerType !== 'touch' && e.buttons !== 1) return;
    const dy = e.clientY - dragStartRef.current.y;
    const dx = e.clientX - dragStartRef.current.x;
    if (Math.abs(dy) > Math.abs(dx)) {
      const state = computeSheetDragState(dy, 0, 84);
      setDragOffsetY(state.offsetY);
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const start = dragStartRef.current;
    dragStartRef.current = null;

    const dy = e.clientY - start.y;
    const dt = Math.max(1, Date.now() - start.time);
    const velocityY = dy / dt;

    const horiz = classifyHorizontalSwipe({
      startX: start.x,
      startY: start.y,
      endX: e.clientX,
      endY: e.clientY,
      durationMs: dt,
      edgeThreshold: 0,
      minSwipeDistance: 45,
    });
    if (horiz === 'next-item' && articleLines.length > 1) {
      triggerHapticSelection();
      setCustomHighlightedText(null);
      setSelectedLineIndices((prev) => [(Math.max(...prev) + 1) % articleLines.length]);
      setDragOffsetY(0);
      return;
    }
    if (horiz === 'prev-item' && articleLines.length > 1) {
      triggerHapticSelection();
      setCustomHighlightedText(null);
      setSelectedLineIndices((prev) => {
        const first = Math.min(...prev);
        return [first > 0 ? first - 1 : articleLines.length - 1];
      });
      setDragOffsetY(0);
      return;
    }

    const state = computeSheetDragState(dy, velocityY, 84);
    setDragOffsetY(0);
    if (state.shouldDismiss) {
      triggerHapticSelection();
      onClose();
    }
  };

  const handleCopyText = async () => {
    triggerHapticSelection();
    const formatted = `“${activeQuote}”\n— ${article.feedTitle}: ${article.title}\nRead on Chinta (চিন্তা — Think)`;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(formatted);
        setCopied(true);
        triggerHapticComplete();
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // ignore
      }
    }
  };

  const handleStoryShare = async (platform: 'instagram' | 'facebook' | 'download') => {
    triggerHapticSelection();
    const res = await shareSpotifyStyleStory(platform, payload);
    if (res.ok) triggerHapticComplete();
    setShareFeedback(res.message);
    setTimeout(() => {
      setShareFeedback((cur) => (cur === res.message ? null : cur));
    }, 3000);
  };

  const isLinePickerExpanded = storyMode === 'lyrics' && showLinePicker;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share Story Card"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 pb-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
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
        className="w-full max-w-md max-h-[88vh] flex flex-col rounded-3xl reader-liquid-card p-4 sm:p-5 text-stone-100 shadow-2xl border border-white/15 animate-in zoom-in-95 duration-150 select-none overflow-y-auto no-scrollbar"
      >
        <div className="w-10 h-1 bg-white/25 rounded-full mx-auto mb-2.5 cursor-grab active:cursor-grabbing shrink-0" />

        <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Quote className="w-4 h-4 text-[#FF6719]" />
            <span className="font-serif text-sm font-bold text-white">
              Share to Story
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share card modal"
            className="min-w-[32px] min-h-[32px] rounded-full flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Toggle: Quote vs Article */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-black/35 border border-white/10 rounded-full mb-3">
          {(
            [
              { id: 'lyrics', label: 'Quote' },
              { id: 'song', label: 'Article' },
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

        {/* Live Interactive 9:16 Story Preview */}
        <div className="mb-3">
          <InteractiveStoryPreview
            payload={payload}
            transform={cardTransform}
            onChangeTransform={setCardTransform}
            compact={isLinePickerExpanded}
          />
        </div>

        {/* Spotify-Lyrics-Style Line Picker (for Quote mode) */}
        {storyMode === 'lyrics' && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setShowLinePicker((v) => !v);
              }}
              aria-expanded={showLinePicker}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-[11px] font-medium text-stone-200 transition-colors"
            >
              <span className="flex items-center gap-1.5 truncate">
                <AlignLeft className="w-3.5 h-3.5 text-[#FF6719] shrink-0" />
                <span className="truncate">
                  {customHighlightedText
                    ? 'Highlighted text active · Tap to pick lines'
                    : `Select lines (${selectedLineIndices.length}/3 of ${articleLines.length})`}
                </span>
              </span>
              {showLinePicker ? (
                <ChevronUp className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              )}
            </button>

            {showLinePicker && (
              <div
                ref={lineListRef}
                role="listbox"
                aria-label="Select article lines to share"
                aria-multiselectable="true"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                style={{ touchAction: 'pan-y' }}
                className="mt-2 max-h-32 overflow-y-auto overscroll-contain space-y-1.5 rounded-2xl bg-black/35 border border-white/10 p-2 no-scrollbar"
              >
                {articleLines.map((line, idx) => {
                  const isSelected = !customHighlightedText && selectedLineIndices.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleTapArticleLine(idx)}
                      className={`w-full text-left px-2.5 py-2 rounded-xl text-[12px] leading-snug transition-all flex items-start gap-2 ${
                        isSelected
                          ? 'bg-[#FF6719]/25 border border-[#FF6719]/60 text-white font-semibold'
                          : 'bg-white/[0.04] hover:bg-white/10 border border-transparent text-stone-300'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full text-[9px] font-mono flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-[#FF6719] text-white'
                            : 'bg-white/10 text-stone-400'
                        }`}
                      >
                        {isSelected ? <Check className="w-2.5 h-2.5" /> : idx + 1}
                      </span>
                      <span className="line-clamp-3">{line}</span>
                    </button>
                  );
                })}
                <div className="pt-0.5 text-center text-[10px] text-stone-400">
                  Tap any line · Tap next line to combine up to 3
                </div>
              </div>
            )}
          </div>
        )}

        {/* Minimal Backdrop Dots */}
        <div className="flex items-center justify-center gap-3 mb-3.5">
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
          <div className="mb-3 px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-[11px] text-stone-200 text-center">
            {shareFeedback}
          </div>
        )}

        {/* Export / Share Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleStoryShare('instagram')}
            className="py-2.5 px-3 rounded-full text-xs font-semibold text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%)',
            }}
          >
            <Instagram className="w-3.5 h-3.5" />
            <span>Instagram</span>
          </button>

          <button
            type="button"
            onClick={() => handleStoryShare('facebook')}
            className="py-2.5 px-3 rounded-full text-xs font-semibold bg-[#1877F2] hover:bg-[#166FE5] text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Facebook</span>
          </button>

          <button
            type="button"
            onClick={handleCopyText}
            className="py-2 px-3 rounded-full text-xs font-semibold bg-white/10 hover:bg-white/15 text-white flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy Text'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleStoryShare('download')}
            aria-label="Save story photo to gallery"
            className="py-2 px-3 rounded-full text-xs font-semibold bg-white/15 hover:bg-white/25 text-white flex items-center justify-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Save Photo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
