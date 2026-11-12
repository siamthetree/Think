import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Copy, Download, Check, Quote, Instagram, Share2 } from 'lucide-react';
import type { FeedItem } from '../types';
import { generateQuickTldrBullets } from '../utils/feedIntelligence';
import {
  SPOTIFY_BACKDROP_THEMES,
  renderStoryCardCanvas,
  shareSpotifyStyleStory,
  type StoryBackdropThemeId,
  type StoryCardMode,
} from '../utils/storyCardRenderer';
import { triggerHapticSelection, triggerHapticComplete } from '../utils/haptics';
import { computeSheetDragState, classifyHorizontalSwipe } from '../utils/touchGestures';

interface QuoteShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  article: FeedItem;
  initialQuoteText?: string;
}

export const QuoteShareModal: React.FC<QuoteShareModalProps> = ({
  isOpen,
  onClose,
  article,
  initialQuoteText,
}) => {
  const candidateQuotes = useMemo(() => {
    const bullets = generateQuickTldrBullets(article);
    const list: string[] = [];
    if (initialQuoteText && initialQuoteText.trim().length > 15) {
      list.push(initialQuoteText.trim());
    }
    for (const b of bullets) {
      if (!list.includes(b)) list.push(b);
    }
    if (article.title && !list.includes(article.title)) {
      list.push(article.title);
    }
    return list.slice(0, 4);
  }, [article, initialQuoteText]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [storyMode, setStoryMode] = useState<StoryCardMode>('lyrics');
  const [themeId, setThemeId] = useState<StoryBackdropThemeId>('emerald');
  const [copied, setCopied] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const activeQuote =
    candidateQuotes[Math.min(selectedIdx, candidateQuotes.length - 1)] || article.title;

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
    }),
    [storyMode, themeId, article, activeQuote]
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    renderStoryCardCanvas(payload).then((canvas) => {
      if (cancelled) return;
      try {
        setPreviewUrl(canvas.toDataURL('image/png'));
      } catch {
        setPreviewUrl(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, payload]);

  if (!isOpen) return null;

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
    if (horiz === 'next-item' && candidateQuotes.length > 1) {
      triggerHapticSelection();
      setSelectedIdx((i) => (i + 1) % candidateQuotes.length);
      setDragOffsetY(0);
      return;
    }
    if (horiz === 'prev-item' && candidateQuotes.length > 1) {
      triggerHapticSelection();
      setSelectedIdx((i) => (i > 0 ? i - 1 : candidateQuotes.length - 1));
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share 9:16 Spotify-Style Story Card"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 pb-6 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
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
        className="w-full max-w-md max-h-[88vh] flex flex-col rounded-3xl reader-liquid-card p-5 text-stone-100 shadow-2xl border border-white/20 animate-in zoom-in-95 duration-150 select-none overflow-y-auto no-scrollbar"
      >
        <div className="w-10 h-1 bg-white/25 rounded-full mx-auto mb-3 cursor-grab active:cursor-grabbing shrink-0" />

        <div className="flex items-center justify-between pb-3 mb-3.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Quote className="w-4 h-4 text-[#1DB954]" />
            <span className="text-xs font-semibold text-stone-200">
              Spotify-Style Story Card (9:16)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quote card modal"
            className="min-w-[34px] min-h-[34px] rounded-full flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Toggle: Lyrics Highlight vs Song Share */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/40 border border-white/10 rounded-2xl mb-3">
          {(
            [
              { id: 'lyrics', label: 'Lyrics Highlight' },
              { id: 'song', label: 'Song Share' },
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
                  ? 'bg-[#1DB954] text-black'
                  : 'text-stone-300 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Live 9:16 Story Preview */}
        <div className="flex justify-center mb-3.5">
          <div className="w-44 aspect-[9/16] rounded-2xl overflow-hidden border border-white/20 bg-black/40 shadow-xl flex items-center justify-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="9:16 Story Card Preview"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-5 h-5 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </div>

        {/* Passage Selector (for Lyrics mode) */}
        {storyMode === 'lyrics' && candidateQuotes.length > 1 && (
          <div className="mb-3">
            <span className="text-[11px] font-medium text-stone-400 block mb-1.5">
              Select Passage ({selectedIdx + 1} of {candidateQuotes.length})
            </span>
            <div className="flex items-center gap-1.5">
              {candidateQuotes.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setSelectedIdx(idx);
                  }}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                    selectedIdx === idx
                      ? 'bg-[#1DB954] text-black'
                      : 'bg-white/5 text-stone-400 hover:text-white'
                  }`}
                >
                  #{idx + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5 Spotify Backdrop Themes */}
        <div className="mb-4">
          <span className="text-[11px] font-medium text-stone-400 block mb-1.5">
            Spotify Backdrop Theme
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {SPOTIFY_BACKDROP_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setThemeId(t.id);
                }}
                className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                  themeId === t.id
                    ? 'border-[#1DB954] bg-white/10'
                    : 'border-white/10 bg-black/30 opacity-75 hover:opacity-100'
                }`}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${t.topColor}, ${t.midColor})`,
                  }}
                >
                  {themeId === t.id && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className="text-[9px] text-stone-300 truncate w-full text-center">
                  {t.name.split(' ')[1] || t.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        {shareFeedback && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-[#1DB954]/15 border border-[#1DB954]/40 text-[11px] text-emerald-300 text-center font-medium">
            {shareFeedback}
          </div>
        )}

        {/* Export / Share Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleStoryShare('instagram')}
            className="py-2.5 px-3 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            style={{
              background: 'linear-gradient(135deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%)',
            }}
          >
            <Instagram className="w-3.5 h-3.5" />
            <span>Instagram Story</span>
          </button>

          <button
            type="button"
            onClick={() => handleStoryShare('facebook')}
            className="py-2.5 px-3 rounded-xl text-xs font-bold bg-[#1877F2] hover:bg-[#166FE5] text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Facebook Story</span>
          </button>

          <button
            type="button"
            onClick={handleCopyText}
            className="py-2 px-3 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Quote Copied' : 'Copy Text'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleStoryShare('download')}
            className="py-2 px-3 rounded-xl text-xs font-semibold bg-[#1DB954] hover:bg-[#19a64c] text-black flex items-center justify-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Save 9:16 PNG</span>
          </button>
        </div>
      </div>
    </div>
  );
};
