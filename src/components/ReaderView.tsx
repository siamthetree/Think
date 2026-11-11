import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Type,
  Bookmark,
  Share2,
  Tag as TagIcon,
  CheckCircle2,
  Eye,
  EyeOff,
  X,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ArrowUp,
  Check,
  Compass,
} from 'lucide-react';
import type { FeedItem, Tag, ReaderPreferences, ReaderTheme, ReaderFont, ReaderLineHeight } from '../types';
import { formatRelativeTime } from '../utils/feedParser';
import { sanitizeArticleHtml, blocksToHtml } from '../utils/sanitize';
import { extractArticleWithFallback, summarizeArticleWithFallback, type ArticleSummaryResult } from '../utils/apiClient';
import { triggerHapticSelection, triggerHapticComplete } from '../utils/haptics';

interface ReaderViewProps {
  article: FeedItem;
  tags: Tag[];
  preferences: ReaderPreferences;
  onUpdatePreferences: (prefs: ReaderPreferences) => void;
  onBack: () => void;
  onToggleBookmark: (id: string) => void;
  onToggleRead: (id: string) => void;
  onOpenTagManager: (article: FeedItem) => void;
  onToggleOfflineCache: (article: FeedItem) => void;
  onNextArticle?: () => void;
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

export const ReaderView: React.FC<ReaderViewProps> = ({
  article,
  tags,
  preferences,
  onUpdatePreferences,
  onBack,
  onToggleBookmark,
  onToggleRead,
  onOpenTagManager,
  onToggleOfflineCache,
  onNextArticle,
  onCacheExtractedArticle,
}) => {
  const [showTypographyMenu, setShowTypographyMenu] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [focusMode, setFocusMode] = useState(preferences.distractionFree);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [extractedBlocks, setExtractedBlocks] = useState<
    { type: string; text?: string; src?: string; caption?: string }[] | null
  >(null);
  const [extractedMeta, setExtractedMeta] = useState<{
    title?: string;
    author?: string;
    leadImage?: string;
    readTimeMin?: number;
  }>({});
  const [isLoadingExtraction, setIsLoadingExtraction] = useState(false);
  const [summaryData, setSummaryData] = useState<ArticleSummaryResult | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 2200);
  };

  const handleGenerateSummary = async () => {
    triggerHapticSelection();
    if (summaryData) {
      setShowSummary(!showSummary);
      return;
    }

    setIsLoadingSummary(true);
    setShowSummary(true);
    try {
      const fullText =
        extractedBlocks?.map((b) => b.text || '').join(' ') ||
        article.contentClean ||
        article.summary;
      const res = await summarizeArticleWithFallback({
        title: extractedMeta.title || article.title,
        text: fullText,
      });
      setSummaryData(res);
      triggerHapticComplete();
    } catch {
      // fallback handled inside summarizeArticleWithFallback
    } finally {
      setIsLoadingSummary(false);
    }
  };

  // Handle scroll progress
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const scrollable = scrollHeight - clientHeight;
    if (scrollable <= 0) {
      setScrollProgress(0);
      return;
    }
    const progress = Math.min(100, Math.max(0, (scrollTop / scrollable) * 100));
    setScrollProgress(progress);
  };

  const scrollToTop = () => {
    triggerHapticSelection();
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleShare = async () => {
    triggerHapticSelection();
    const shareData = {
      title: extractedMeta.title || article.title,
      text: `${extractedMeta.title || article.title} – ${article.feedTitle}`,
      url: article.link || window.location.href,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Fallback to clipboard
      }
    }

    if (navigator.clipboard && article.link) {
      try {
        await navigator.clipboard.writeText(article.link);
        showToast('Link copied to clipboard');
        return;
      } catch {
        // ignore
      }
    }
    showToast('Story link ready');
  };

  // Reset per-article state when the story changes (Next Story reuses this component)
  useEffect(() => {
    setSummaryData(null);
    setShowSummary(false);
    setIsLoadingSummary(false);
    setExtractedBlocks(null);
    setScrollProgress(0);
    containerRef.current?.scrollTo({ top: 0 });
  }, [article.id]);

  // Automatically mark article as read upon viewing
  useEffect(() => {
    if (!article.isRead) {
      onToggleRead(article.id);
    }
  }, [article.id]);

  // Fetch rich article extractor from URL for clean distraction-free reading
  useEffect(() => {
    let cancelled = false;
    setExtractedMeta({});
    setExtractedBlocks(null);
    const contentText = (article.contentClean || '').trim();
    const contentParagraphs = contentText
      .split(/\n{2,}|(?<=[.!?])\s{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const hasFullContent = contentText.length >= 800 && contentParagraphs.length >= 3;
    if (!hasFullContent && article.link && article.link.startsWith('http')) {
      setIsLoadingExtraction(true);
      extractArticleWithFallback(article.link)
        .then((data) => {
          if (cancelled) return;
          if (data.success && data.blocks && data.blocks.length > 0) {
            setExtractedBlocks(data.blocks);
            setExtractedMeta({
              title: data.title,
              author: data.author,
              leadImage: data.leadImage,
              readTimeMin: data.readTimeMin,
            });
            if (onCacheExtractedArticle) {
              const htmlFromBlocks = blocksToHtml(data.blocks);
              const cleanFromBlocks = data.blocks
                .map((b: any) => b.text || '')
                .filter(Boolean)
                .join('\n\n');
              onCacheExtractedArticle(article.id, {
                title: data.title,
                author: data.author,
                leadImage: data.leadImage,
                readTimeMin: data.readTimeMin,
                contentHtml: htmlFromBlocks,
                contentClean: cleanFromBlocks,
              });
            }
          }
        })
        .catch((err) => {
          console.warn('Extraction fallback to RSS content:', err);
        })
        .finally(() => {
          if (!cancelled) setIsLoadingExtraction(false);
        });
    } else {
      setIsLoadingExtraction(false);
    }
    return () => {
      cancelled = true;
    };
  }, [article.link]);

  // Theme styles mapping (Warm Charcoal vs Pure Black OLED)
  const getThemeClasses = (theme: ReaderTheme) => {
    switch (theme) {
      case 'oled':
        return 'bg-[#090A0C] text-[#F3F4F6] selection:bg-neutral-800';
      case 'slate':
      default:
        return 'bg-[#121418] text-[#E2E8F0] selection:bg-[#252A34]';
    }
  };

  // Font family styles mapping
  const getFontFamilyStyle = (font: ReaderFont) => {
    switch (font) {
      case 'sans':
        return { fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" };
      case 'mono':
        return { fontFamily: "'Space Mono', monospace, Courier" };
      case 'serif':
      default:
        return { fontFamily: "'Lora', Georgia, serif" };
    }
  };

  // Line height styles mapping
  const getLineHeightClass = (lh: ReaderLineHeight) => {
    switch (lh) {
      case 'normal':
        return 'leading-normal';
      case 'loose':
        return 'leading-loose';
      case 'relaxed':
      default:
        return 'leading-relaxed';
    }
  };

  const articleTags = tags.filter((t) => article.tags.includes(t.id));

  return (
    <div
      className={`flex-1 flex flex-col h-full overflow-hidden relative reader-push-enter ${getThemeClasses(
        preferences.theme
      )}`}
      style={{ transition: 'background-color 220ms ease, color 220ms ease' }}
    >
      {/* Ultra-slim Apple Glowing Reading Progress Bar */}
      <div
        className="w-full absolute top-0 left-0 right-0 z-40 overflow-hidden pointer-events-none"
        style={{ height: 2.5, background: 'rgba(255,255,255,0.06)' }}
        role="progressbar"
        aria-valuenow={Math.round(scrollProgress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full transition-all duration-75 ease-out"
          style={{
            width: `${scrollProgress}%`,
            background: 'linear-gradient(90deg, #FF6719 0%, #FFA043 55%, #10B981 100%)',
            boxShadow: '0 0 10px rgba(255, 103, 25, 0.75)',
          }}
        />
      </div>

      {/* Progressive Top Atmospheric Blur Mask */}
      <div
        className="top-progressive-blur pointer-events-none absolute inset-x-0 top-0 h-24 z-20"
        aria-hidden="true"
      />

      {/* Floating Apple Liquid Glass Top Navigation Bar */}
      <header
        className={`absolute top-0 inset-x-0 z-30 pt-[max(env(safe-area-inset-top,0px),0.6rem)] px-3 pointer-events-none transition-all duration-300 ${
          focusMode ? '-translate-y-16 opacity-0' : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="flex items-center justify-between gap-2 max-w-2xl mx-auto pointer-events-auto">
          {/* Back Pill with Liquid Glass */}
          <button
            onClick={() => {
              triggerHapticSelection();
              onBack();
            }}
            aria-label="Back to Newsfeed"
            className="liquid-glass-dock px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-medium text-stone-200 hover:text-white transition-all active:scale-95 shadow-lg group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span className="text-[12px] font-sans font-medium tracking-tight">Feed</span>
          </button>

          {/* Center Publication Pill & Progress Indicator */}
          <div className="liquid-glass-dock px-3.5 py-1.5 rounded-full flex items-center gap-2 max-w-[190px] shadow-lg min-w-0">
            <span className="text-[11px] font-serif font-medium tracking-wide truncate text-stone-300">
              {article.feedTitle}
            </span>
            {scrollProgress > 2 && (
              <span className="text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded-full border border-emerald-500/25 shrink-0">
                {Math.round(scrollProgress)}%
              </span>
            )}
          </div>

          {/* Right Liquid Glass Action Cluster */}
          <div className="liquid-glass-dock p-1 rounded-full flex items-center gap-0.5 shadow-lg">
            {/* AI Editorial Summary Toggle */}
            <button
              onClick={handleGenerateSummary}
              aria-label={showSummary ? 'Hide article summary' : 'AI Editorial summary'}
              title="Editorial AI summary & takeaways"
              className={`p-1.5 rounded-full transition-all active:scale-90 ${
                showSummary
                  ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/50'
                  : 'text-stone-300 hover:text-emerald-400 hover:bg-white/5'
              }`}
            >
              <Sparkles
                className={`w-3.5 h-3.5 ${
                  isLoadingSummary ? 'animate-spin text-emerald-400' : 'text-emerald-400'
                }`}
              />
            </button>

            {/* Typography Customizer (Aa) */}
            <button
              onClick={() => {
                triggerHapticSelection();
                setShowTypographyMenu(!showTypographyMenu);
              }}
              aria-label="Appearance and typography settings"
              className={`p-1.5 rounded-full transition-all active:scale-90 ${
                showTypographyMenu
                  ? 'bg-white/20 text-white ring-1 ring-white/30'
                  : 'text-stone-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
            </button>

            {/* Bookmark Toggle */}
            <button
              onClick={() => {
                triggerHapticSelection();
                onToggleBookmark(article.id);
                showToast(article.isBookmarked ? 'Removed from bookmarks' : 'Bookmarked story');
              }}
              aria-label={article.isBookmarked ? 'Remove bookmark' : 'Bookmark story'}
              className="p-1.5 rounded-full text-stone-300 hover:text-amber-400 hover:bg-white/5 transition-all active:scale-90"
            >
              <Bookmark
                className={`w-3.5 h-3.5 transition-colors ${
                  article.isBookmarked ? 'fill-amber-400 text-amber-400 scale-105' : ''
                }`}
              />
            </button>

            {/* Share */}
            <button
              onClick={handleShare}
              aria-label="Share story"
              className="p-1.5 rounded-full text-stone-300 hover:text-white hover:bg-white/5 transition-all active:scale-90"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="liquid-glass-dock px-3.5 py-1.5 rounded-full text-xs font-medium text-stone-100 flex items-center gap-1.5 shadow-2xl border border-white/20">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Apple Liquid Glass Typography & Appearance Sheet */}
      {showTypographyMenu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setShowTypographyMenu(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="reader-liquid-card rounded-3xl p-5 w-full max-w-sm text-stone-100 shadow-2xl border border-white/20 animate-in zoom-in-95 duration-150"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-300">
                  Reader Appearance
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-stone-400">
                  iOS 26
                </span>
              </div>
              <button
                onClick={() => {
                  triggerHapticSelection();
                  setShowTypographyMenu(false);
                }}
                aria-label="Close appearance menu"
                className="p-1 rounded-full text-stone-400 hover:text-stone-100 hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dark Reading Theme Selector */}
            <div className="mb-4">
              <span className="text-[11px] font-medium text-stone-400 block mb-2">Dark Atmosphere</span>
              <div className="grid grid-cols-2 gap-2 p-1 bg-black/40 border border-white/10 rounded-2xl">
                {[
                  {
                    id: 'slate',
                    name: 'Charcoal',
                    preview: 'bg-[#181B20]',
                    desc: 'Warm paper dark',
                  },
                  {
                    id: 'oled',
                    name: 'OLED Black',
                    preview: 'bg-[#090A0C]',
                    desc: 'Pure midnight',
                  },
                ].map((t) => {
                  const isActive = preferences.theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        triggerHapticSelection();
                        onUpdatePreferences({ ...preferences, theme: t.id as ReaderTheme });
                      }}
                      className={`p-2 rounded-xl flex items-center gap-2 transition-all text-left ${
                        isActive
                          ? 'liquid-glass-active-bubble ring-1 ring-emerald-500/80 shadow-md'
                          : 'opacity-65 hover:opacity-100'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full border border-white/20 shrink-0 ${t.preview} ${
                          isActive ? 'ring-2 ring-emerald-400' : ''
                        }`}
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-medium block truncate text-stone-200">
                          {t.name}
                        </span>
                        <span className="text-[9px] text-stone-400 block truncate">{t.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Font Selector */}
            <div className="mb-4">
              <span className="text-[11px] font-medium text-stone-400 block mb-2">Editorial Font</span>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/40 border border-white/10 rounded-2xl">
                {[
                  { id: 'serif', label: 'Serif', sample: 'Lora', style: { fontFamily: "'Lora', serif" } },
                  {
                    id: 'sans',
                    label: 'Sans',
                    sample: 'SF Pro',
                    style: { fontFamily: "'Plus Jakarta Sans', sans-serif" },
                  },
                  {
                    id: 'mono',
                    label: 'Mono',
                    sample: 'Space',
                    style: { fontFamily: "'Space Mono', monospace" },
                  },
                ].map((f) => {
                  const isActive = preferences.font === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => {
                        triggerHapticSelection();
                        onUpdatePreferences({ ...preferences, font: f.id as ReaderFont });
                      }}
                      style={f.style}
                      className={`py-2 px-1 rounded-xl text-center transition-all ${
                        isActive
                          ? 'liquid-glass-dock text-white font-semibold ring-1 ring-white/25 shadow-sm'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      <span className="text-xs block leading-tight">{f.label}</span>
                      <span className="text-[9px] opacity-60 block">{f.sample}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Font Size Steppers */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5 text-[11px] font-medium text-stone-400">
                <span>Text Scale</span>
                <span className="font-mono text-emerald-400">{preferences.fontSize} px</span>
              </div>
              <div className="flex items-center gap-2 p-1 bg-black/40 border border-white/10 rounded-2xl">
                <button
                  onClick={() => {
                    triggerHapticSelection();
                    onUpdatePreferences({
                      ...preferences,
                      fontSize: Math.max(14, preferences.fontSize - 1),
                    });
                  }}
                  aria-label="Decrease font size"
                  className="flex-1 py-1.5 rounded-xl text-xs font-semibold text-stone-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  A-
                </button>
                <div className="w-px h-5 bg-white/10" />
                <button
                  onClick={() => {
                    triggerHapticSelection();
                    onUpdatePreferences({
                      ...preferences,
                      fontSize: Math.min(26, preferences.fontSize + 1),
                    });
                  }}
                  aria-label="Increase font size"
                  className="flex-1 py-1.5 rounded-xl text-sm font-semibold text-stone-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  A+
                </button>
              </div>
            </div>

            {/* Line Spacing */}
            <div className="mb-4">
              <span className="text-[11px] font-medium text-stone-400 block mb-1.5">Line Spacing</span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-black/40 border border-white/10 rounded-2xl">
                {(['normal', 'relaxed', 'loose'] as ReaderLineHeight[]).map((lh) => {
                  const isActive = preferences.lineHeight === lh;
                  return (
                    <button
                      key={lh}
                      onClick={() => {
                        triggerHapticSelection();
                        onUpdatePreferences({ ...preferences, lineHeight: lh });
                      }}
                      className={`py-1.5 text-xs capitalize rounded-xl transition-all ${
                        isActive
                          ? 'liquid-glass-dock text-white font-medium ring-1 ring-white/20'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      {lh}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Distraction-Free Toggle in Sheet */}
            <button
              onClick={() => {
                triggerHapticSelection();
                const next = !focusMode;
                setFocusMode(next);
                onUpdatePreferences({ ...preferences, distractionFree: next });
              }}
              className="w-full py-2.5 px-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-between text-xs transition-colors"
            >
              <div className="flex items-center gap-2">
                {focusMode ? (
                  <EyeOff className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Eye className="w-4 h-4 text-stone-400" />
                )}
                <span>Full Focus Immersion</span>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  focusMode
                    ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                    : 'bg-white/10 text-stone-400'
                }`}
              >
                {focusMode ? 'Active' : 'Off'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Main Scrollable Article Reading Canvas */}
      <main
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-5 pt-20 pb-32 md:px-8 selection:text-current relative no-scrollbar"
      >
        <article className="max-w-[660px] mx-auto">
          {/* Publication Kicker & Reading Time */}
          <div className="flex items-center justify-between text-[11px] tracking-widest font-sans uppercase text-stone-400/80 mb-3.5">
            <span className="font-semibold text-emerald-400/90">{article.feedTitle}</span>
            <span className="font-mono text-stone-400">
              {extractedMeta.readTimeMin || article.readTimeMin} min read
            </span>
          </div>

          {/* Article Title */}
          <h1
            style={{
              ...getFontFamilyStyle(preferences.font),
              fontSize: `${Math.round(preferences.fontSize * 1.58)}px`,
              lineHeight: 1.22,
              textWrap: 'balance',
            }}
            className="font-bold tracking-tight text-stone-100 mb-4"
          >
            {extractedMeta.title || article.title}
          </h1>

          {/* Byline & Date */}
          <div className="flex items-center flex-wrap gap-2 text-xs text-stone-400/90 pb-5 mb-6 border-b border-white/10">
            {(extractedMeta.author || article.author) && (
              <>
                <span className="font-medium text-stone-200">
                  By {extractedMeta.author || article.author}
                </span>
                <span aria-hidden="true" className="opacity-40">
                  ·
                </span>
              </>
            )}
            <span>
              {new Date(article.pubDate).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
            <span>{formatRelativeTime(article.timestamp)}</span>
            {article.isOfflineCached && (
              <>
                <span aria-hidden="true" className="opacity-40">
                  ·
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Offline Ready</span>
                </span>
              </>
            )}
          </div>

          {/* AI Editorial Summary Prompt Pill (if summary not open yet) */}
          {!showSummary && (
            <div className="mb-7">
              <button
                onClick={handleGenerateSummary}
                className="w-full py-2.5 px-4 rounded-2xl liquid-glass-dock hover:bg-emerald-950/30 border border-emerald-500/25 text-emerald-300 text-xs font-medium flex items-center justify-between transition-all active:scale-[0.99] shadow-md group"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-emerald-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <span className="font-sans font-medium text-stone-200">
                    AI Editorial Summary & Key Takeaways
                  </span>
                </div>
                <span className="text-[11px] text-emerald-400 font-sans group-hover:translate-x-0.5 transition-transform">
                  Generate →
                </span>
              </button>
            </div>
          )}

          {/* Precise Editorial Summary Card (Liquid Glass with emerald highlights) */}
          {showSummary && (
            <aside className="mb-8 reader-liquid-card rounded-3xl p-4 sm:p-5 border border-emerald-500/35 shadow-2xl text-stone-200 animate-in fade-in slide-in-from-top-3 duration-200">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-xs">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-sm text-stone-100 leading-tight">
                      Editorial Executive Summary
                    </h3>
                    <p className="text-[10px] text-stone-400 font-sans">
                      {summaryData?.provider === 'gemini'
                        ? 'Synthesized via Gemini Intelligence'
                        : 'Distilled by Editorial News Intelligence'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    triggerHapticSelection();
                    setShowSummary(false);
                  }}
                  aria-label="Hide summary"
                  className="p-1 rounded-full text-stone-400 hover:text-stone-100 hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {isLoadingSummary ? (
                <div className="py-7 flex flex-col items-center justify-center space-y-2.5 text-xs text-stone-400 font-sans">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[11px]">Synthesizing article insights and takeaways...</span>
                </div>
              ) : summaryData ? (
                <div className="space-y-3.5 text-xs font-sans leading-relaxed">
                  {/* Executive Overview Container */}
                  <div className="p-3.5 rounded-2xl bg-black/45 border border-white/10">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400 block mb-1">
                      Overview
                    </span>
                    <p className="text-stone-200 font-serif text-[13.5px] leading-relaxed">
                      {summaryData.executiveSummary}
                    </p>
                  </div>

                  {/* Bulleted Key Takeaways */}
                  {summaryData.keyTakeaways && summaryData.keyTakeaways.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-stone-400 block mb-1.5">
                        Key Points
                      </span>
                      <ul className="space-y-1.5 pl-1">
                        {summaryData.keyTakeaways.map((point, i) => (
                          <li key={i} className="flex items-start gap-2 text-stone-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                            <span className="text-[12.5px]">{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Context Note */}
                  {summaryData.context && (
                    <div className="pt-2 border-t border-white/10 text-[11px] text-stone-400 italic">
                      {summaryData.context}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-stone-400">Failed to generate summary. Please try again.</p>
              )}
            </aside>
          )}

          {/* Lead / Hero Image with Liquid Glass Border */}
          {(extractedMeta.leadImage || article.imageUrl) && (
            <figure className="mb-8 rounded-2xl overflow-hidden shadow-2xl border border-white/15 bg-black/30">
              <img
                src={extractedMeta.leadImage || article.imageUrl}
                alt={extractedMeta.title || article.title}
                referrerPolicy="no-referrer"
                loading="eager"
                className="w-full h-auto max-h-[380px] object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </figure>
          )}

          {/* Article Text Content (Clean Editorial Reading Layout) */}
          <div
            style={{
              ...getFontFamilyStyle(preferences.font),
              fontSize: `${preferences.fontSize}px`,
            }}
            className={`${getLineHeightClass(preferences.lineHeight)} space-y-6 text-stone-200`}
          >
            {/* If rich extracted blocks are available, render them */}
            {extractedBlocks && extractedBlocks.length > 0 ? (
              extractedBlocks.map((block, idx) => {
                if (block.type === 'h2' || block.type === 'h3') {
                  return (
                    <h2
                      key={idx}
                      className="font-bold pt-4 text-xl tracking-tight text-stone-100 opacity-95"
                    >
                      {block.text}
                    </h2>
                  );
                }
                if (block.type === 'blockquote') {
                  return (
                    <blockquote
                      key={idx}
                      className="py-3 px-4.5 my-5 border-l-2 border-emerald-400/80 bg-white/5 rounded-r-2xl italic text-stone-200 text-lg shadow-xs"
                    >
                      "{block.text}"
                    </blockquote>
                  );
                }
                if (block.type === 'img' && block.src) {
                  return (
                    <figure
                      key={idx}
                      className="my-6 rounded-2xl overflow-hidden border border-white/10 shadow-lg"
                    >
                      <img
                        src={block.src}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-auto object-cover"
                      />
                      {block.caption && (
                        <figcaption className="p-2.5 text-xs text-stone-400 italic font-sans bg-black/40">
                          {block.caption}
                        </figcaption>
                      )}
                    </figure>
                  );
                }
                // Paragraph with drop cap on the first paragraph
                return (
                  <p
                    key={idx}
                    className={
                      idx === 0
                        ? 'first-letter:text-4xl first-letter:font-bold first-letter:float-left first-letter:mr-2.5 first-letter:mt-0.5 first-letter:text-amber-500 text-stone-200/95'
                        : 'text-stone-200/95'
                    }
                  >
                    {block.text}
                  </p>
                );
              })
            ) : article.contentHtml ? (
              /* Zero-delay render of sanitized article HTML */
              <div
                className="article-prose prose-stone max-w-none space-y-5 text-stone-200/95"
                dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.contentHtml) }}
              />
            ) : article.contentClean ? (
              /* Clean content paragraphs */
              <div className="space-y-4">
                {article.contentClean
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, idx) => (
                    <p
                      key={idx}
                      className={
                        idx === 0
                          ? 'first-letter:text-4xl first-letter:font-bold first-letter:float-left first-letter:mr-2.5 first-letter:mt-0.5 first-letter:text-amber-500 text-stone-200/95'
                          : 'text-stone-200/95'
                      }
                    >
                      {p}
                    </p>
                  ))}
              </div>
            ) : (
              /* Fallback to story summary */
              <p className="text-stone-200/95 leading-relaxed text-base">{article.summary}</p>
            )}

            {/* Silent non-blocking background enrichment indicator */}
            {isLoadingExtraction && (
              <div className="pt-2 pb-1 flex items-center gap-2 text-[11px] text-stone-400/60 font-sans">
                <div className="w-2.5 h-2.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin shrink-0" />
                <span>Checking portal for full article text...</span>
              </div>
            )}
          </div>

          {/* Assigned Tags Section */}
          <div className="mt-12 pt-6 border-t border-white/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-stone-400 font-sans">
                Story Tags
              </span>
              <button
                onClick={() => {
                  triggerHapticSelection();
                  onOpenTagManager(article);
                }}
                aria-label="Edit story tags"
                className="text-xs text-stone-300 hover:text-white underline transition-opacity"
              >
                + Edit Tags
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {articleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border border-white/15 bg-white/5 text-stone-200"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span>{tag.name}</span>
                </span>
              ))}

              {articleTags.length === 0 && (
                <span className="text-xs text-stone-500 italic">
                  No tags assigned. Tap "Edit Tags" to organize your newsfeed.
                </span>
              )}
            </div>
          </div>

          {/* Original Source Attribution Card */}
          <div className="mt-8 p-4 rounded-2xl reader-liquid-card border border-white/15 text-xs text-stone-300">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="font-semibold text-stone-100 block truncate">
                  Original Publication
                </span>
                <span className="text-stone-400 truncate block text-[11px]">
                  Reading mode archive from {article.feedTitle}
                </span>
              </div>
              {article.link && article.link.startsWith('http') && (
                <a
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full liquid-glass-pill text-stone-100 text-xs font-medium hover:text-white transition-all active:scale-95 shadow-md"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-stone-300" />
                  <span>Open web</span>
                </a>
              )}
            </div>
          </div>

          {/* Article End Padding */}
          <div className="h-16" />
        </article>
      </main>

      {/* Floating Bottom Liquid Glass Action Bar (Apple iOS 26 Capsule) */}
      <footer
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto transition-all duration-300 ${
          focusMode ? 'translate-y-20 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="liquid-glass-dock px-3 py-1.5 rounded-full flex items-center gap-3 shadow-2xl border border-white/20">
          {/* Back button */}
          <button
            onClick={() => {
              triggerHapticSelection();
              onBack();
            }}
            className="flex items-center gap-1 text-xs font-medium text-stone-300 hover:text-white transition-colors active:scale-95 px-2 py-1 rounded-full"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Feed</span>
          </button>

          <div className="w-px h-3.5 bg-white/20" />

          {/* Scroll to Top / Progress Indicator */}
          <button
            onClick={scrollToTop}
            title="Scroll to top"
            className="flex items-center gap-1 text-[11px] font-mono text-stone-300 hover:text-white transition-colors px-1.5 py-0.5 rounded-full active:scale-95"
          >
            <ArrowUp className="w-3 h-3 text-stone-400" />
            <span>{Math.round(scrollProgress)}%</span>
          </button>

          {/* Next Article (if provided) */}
          {onNextArticle && (
            <>
              <div className="w-px h-3.5 bg-white/20" />
              <button
                onClick={() => {
                  triggerHapticSelection();
                  onNextArticle();
                }}
                className="flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors active:scale-95 px-2 py-1 rounded-full"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </footer>

      {/* Floating Focus Mode Mini Orb (Visible when focus mode is active to restore controls) */}
      {focusMode && (
        <button
          onClick={() => {
            triggerHapticSelection();
            setFocusMode(false);
          }}
          aria-label="Exit distraction-free reading"
          title="Exit distraction-free mode"
          className="absolute bottom-5 right-5 p-3 rounded-full liquid-glass-dock text-stone-200 shadow-2xl border border-white/25 hover:scale-105 active:scale-95 transition-all z-40 animate-in fade-in"
        >
          <Eye className="w-4 h-4 text-emerald-400" />
        </button>
      )}
    </div>
  );
};
