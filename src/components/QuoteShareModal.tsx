import React, { useState, useMemo, useRef } from 'react';
import { X, Copy, Download, Check, Quote } from 'lucide-react';
import type { FeedItem } from '../types';
import { generateQuickTldrBullets } from '../utils/feedIntelligence';
import { triggerHapticSelection, triggerHapticComplete } from '../utils/haptics';
import { computeSheetDragState, classifyHorizontalSwipe } from '../utils/touchGestures';

interface QuoteShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  article: FeedItem;
  initialQuoteText?: string;
}

type QuoteCardStyle = 'charcoal' | 'ivory' | 'emerald';

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
  const [cardStyle, setCardStyle] = useState<QuoteCardStyle>('charcoal');
  const [copied, setCopied] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  if (!isOpen) return null;

  const activeQuote = candidateQuotes[Math.min(selectedIdx, candidateQuotes.length - 1)] || article.title;

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

    // Check horizontal swipe on quote card to cycle passages
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

  const handleDownloadCardPng = () => {
    triggerHapticSelection();
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background palette
    const palette =
      cardStyle === 'ivory'
        ? { bg: '#F7F4EE', text: '#18181B', muted: '#71717A', accent: '#FF6719' }
        : cardStyle === 'emerald'
          ? { bg: '#071F18', text: '#F4F4F5', muted: '#A1A1AA', accent: '#10B981' }
          : { bg: '#121316', text: '#F4F4F5', muted: '#A1A1AA', accent: '#FF6719' };

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle border frame
    ctx.strokeStyle = cardStyle === 'ivory' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3;
    ctx.strokeRect(56, 56, canvas.width - 112, canvas.height - 112);

    // Source Kicker
    ctx.fillStyle = palette.accent;
    ctx.font = 'bold 28px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.fillText(article.feedTitle.toUpperCase(), 110, 160);

    // Wrap Quote Text
    ctx.fillStyle = palette.text;
    ctx.font = 'bold 46px "Lora", Georgia, serif';
    const words = `“${activeQuote}”`.split(' ');
    let line = '';
    let y = 270;
    const maxWidth = 860;
    const lineHeight = 68;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        ctx.fillText(line.trim(), 110, y);
        line = words[i] + ' ';
        y += lineHeight;
        if (y > 760) break;
      } else {
        line = testLine;
      }
    }
    if (line.trim() && y <= 800) {
      ctx.fillText(line.trim(), 110, y);
    }

    // Article Headline & Brand Signature at bottom
    ctx.fillStyle = palette.muted;
    ctx.font = '500 26px "Plus Jakarta Sans", -apple-system, sans-serif';
    const clippedTitle =
      article.title.length > 65 ? `${article.title.slice(0, 62)}…` : article.title;
    ctx.fillText(clippedTitle, 110, 890);

    ctx.fillStyle = palette.text;
    ctx.font = 'bold 28px "Lora", Georgia, serif';
    ctx.fillText('চিন্তা — Think · Distraction-Free Reader', 110, 955);

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `chinta-quote-${article.id.slice(0, 8)}.png`;
    a.click();
    triggerHapticComplete();
  };

  const previewClasses =
    cardStyle === 'ivory'
      ? 'bg-[#F7F4EE] text-stone-900 border-stone-300'
      : cardStyle === 'emerald'
        ? 'bg-[#071F18] text-stone-100 border-emerald-500/25'
        : 'bg-[#121316] text-stone-100 border-white/15';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share Editorial Quote Card"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-8 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
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

        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Quote className="w-4 h-4 text-[#FF6719]" />
            <span className="text-xs font-semibold text-stone-200">
              Editorial Quote Card
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quote card modal"
            className="min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Quote Card Preview (Swipe horizontally to cycle passages) */}
        <div
          className={`p-5 rounded-2xl border shadow-xl mb-4 transition-colors duration-200 ${previewClasses}`}
        >
          <div className="text-[11px] font-sans font-bold tracking-wider uppercase text-[#FF6719] mb-2">
            {article.feedTitle}
          </div>
          <blockquote className="font-serif text-[17px] font-bold leading-relaxed mb-4">
            “{activeQuote}”
          </blockquote>
          <div className="pt-3 border-t border-current/10 flex items-center justify-between text-[11px] opacity-75">
            <span className="truncate max-w-[210px]">{article.title}</span>
            <span className="font-serif font-semibold shrink-0">চিন্তা — Think</span>
          </div>
        </div>

        {/* Passage Selector */}
        {candidateQuotes.length > 1 && (
          <div className="mb-4">
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
                      ? 'bg-[#FF6719] text-white'
                      : 'bg-white/5 text-stone-400 hover:text-white'
                  }`}
                >
                  #{idx + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Style Selector */}
        <div className="mb-5">
          <span className="text-[11px] font-medium text-stone-400 block mb-1.5">Card Finish</span>
          <div className="grid grid-cols-3 gap-2 p-1 bg-black/40 border border-white/10 rounded-2xl">
            {(
              [
                { id: 'charcoal', label: 'Charcoal' },
                { id: 'ivory', label: 'Warm Paper' },
                { id: 'emerald', label: 'Emerald' },
              ] as const
            ).map((style) => (
              <button
                key={style.id}
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setCardStyle(style.id);
                }}
                className={`py-1.5 rounded-xl text-xs font-medium transition-all ${
                  cardStyle === style.id
                    ? 'liquid-glass-dock text-white ring-1 ring-white/25'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        {/* Export / Copy Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleCopyText}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Quote Copied' : 'Copy Quote'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCardPng}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-[#FF6719] hover:bg-[#e85a12] text-white flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Save Card Image</span>
          </button>
        </div>
      </div>
    </div>
  );
};
