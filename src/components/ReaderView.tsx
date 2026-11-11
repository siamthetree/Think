import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Type,
  Bookmark,
  Share2,
  Tag as TagIcon,
  CheckCircle2,
  ArrowDownCircle,
  Eye,
  EyeOff,
  X,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import type { FeedItem, Tag, ReaderPreferences, ReaderTheme, ReaderFont, ReaderLineHeight } from '../types';
import { formatRelativeTime } from '../utils/feedParser';
import { sanitizeArticleHtml, blocksToHtml } from '../utils/sanitize';
import { extractArticleWithFallback, summarizeArticleWithFallback, type ArticleSummaryResult } from '../utils/apiClient';

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

  const handleGenerateSummary = async () => {
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
    // RSS feeds frequently put a long teaser in contentClean. Treat content as
    // complete only when it has enough body text and multiple paragraphs.
    const hasFullContent =
      contentText.length >= 800 && contentParagraphs.length >= 3;
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

  // Theme styles mapping (All dark and comfortable for reading)
  const getThemeClasses = (theme: ReaderTheme) => {
    switch (theme) {
      case 'oled':
        return 'bg-[#090A0C] text-[#E5E7EB] selection:bg-stone-800';
      case 'slate':
      default:
        return 'bg-[#14161B] text-[#E2E8F0] selection:bg-[#2A303C]';
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
        return { fontFamily: "'Lora', 'Source Serif 4', Georgia, serif" };
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
    <div className={`flex-1 flex flex-col h-full overflow-hidden relative reader-push-enter ${getThemeClasses(preferences.theme)}`}
         style={{ transition: 'background-color 200ms ease, color 200ms ease' }}>
      {/* Reading Progress Bar — 2px, glowing, GPU-composited */}
      <div
        className="w-full shrink-0 relative overflow-hidden z-30"
        style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}
        role="progressbar"
        aria-valuenow={Math.round(scrollProgress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Article reading progress"
      >
        <div
          className="reader-progress-bar absolute inset-y-0 left-0"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* Top iOS Navigation Toolbar (Can be hidden in Focus Mode) */}
      {!focusMode && (
        <header className="shrink-0 pt-[max(env(safe-area-inset-top,0px),0.5rem)] pb-2 min-h-12 flex items-center justify-between px-3 border-b border-stone-200/20 dark:border-stone-800/60 backdrop-blur-xl z-20">
          <button
            onClick={onBack}
            aria-label="Back to Newsfeed"
            className="flex items-center gap-1 text-sm font-medium hover:opacity-75 transition-opacity px-2 py-1.5 -ml-1 rounded-md"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-medium">Newsfeed</span>
          </button>

          {/* Center: Publication name & Progress pill */}
          <div className="flex items-center gap-1.5 min-w-0 max-w-[180px]">
            <span className="text-xs font-serif font-medium tracking-wide truncate opacity-75">
              {article.feedTitle}
            </span>
            {scrollProgress > 2 && (
              <span className="text-[10px] font-mono text-emerald-400/90 shrink-0">
                · {Math.round(scrollProgress)}%
              </span>
            )}
          </div>

          {/* Right Action Icons */}
          <div className="flex items-center gap-1">
            {/* AI Editorial Summary button */}
            <button
              onClick={handleGenerateSummary}
              aria-label={showSummary ? 'Hide article summary' : 'Summarize newspaper article'}
              title="Generate precise editorial summary & key takeaways"
              className={`p-1.5 rounded-md transition-colors flex items-center gap-1 text-xs font-medium ${
                showSummary
                  ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/80 shadow-xs'
                  : 'hover:bg-white/10 text-stone-300'
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${isLoadingSummary ? 'animate-spin text-emerald-400' : 'text-emerald-400'}`} />
              <span className="hidden sm:inline">Summary</span>
            </button>

            {/* Tag manager button */}
            <button
              onClick={() => onOpenTagManager(article)}
              aria-label="Manage tags"
              title="Add or remove tags"
              className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors relative"
            >
              <TagIcon className="w-4 h-4" />
              {articleTags.length > 0 && (
                <span
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: articleTags[0]?.color || '#2563EB' }}
                />
              )}
            </button>

            {/* Offline cache button */}
            <button
              onClick={() => onToggleOfflineCache(article)}
              aria-label={article.isOfflineCached ? 'Cached for offline' : 'Download for offline'}
              title={article.isOfflineCached ? 'Available Offline' : 'Cache Offline'}
              className={`p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
                article.isOfflineCached ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-60'
              }`}
            >
              <ArrowDownCircle className="w-4 h-4" />
            </button>

            {/* Bookmark button */}
            <button
              onClick={() => onToggleBookmark(article.id)}
              aria-label={article.isBookmarked ? 'Remove bookmark' : 'Bookmark'}
              className={`p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
                article.isBookmarked ? 'text-amber-600 dark:text-amber-400' : 'opacity-60'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${article.isBookmarked ? 'fill-current' : ''}`} />
            </button>

            {/* Reader Typography Customizer (Aa) */}
            <button
              onClick={() => setShowTypographyMenu(!showTypographyMenu)}
              aria-label="Reader appearance settings"
              className={`p-1.5 rounded-md transition-colors ${
                showTypographyMenu ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <Type className="w-4 h-4" />
            </button>
          </div>
        </header>
      )}

      {/* Typography & Appearance Popover Sheet */}
      {showTypographyMenu && (
        <div className="absolute top-12 right-2 left-2 md:left-auto md:w-80 p-4 bg-white dark:bg-stone-900 rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 z-50 text-stone-900 dark:text-stone-100 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-stone-200 dark:border-stone-800 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Reader Appearance
            </span>
            <button
              onClick={() => setShowTypographyMenu(false)}
              aria-label="Close appearance settings"
              className="p-1 rounded-md text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Theme Palette Buttons: Eye-comfortable dark reading themes */}
          <div className="mb-4">
            <span className="text-[11px] font-medium text-stone-400 block mb-1.5">Dark Reading Theme</span>
            <div className="grid grid-cols-2 gap-2 p-1.5 bg-stone-900/90 border border-stone-800 rounded-xl">
              {[
                { id: 'slate', name: 'Warm Charcoal (Slate)', bg: 'bg-[#181B20]', text: 'text-[#E2E8F0]', border: 'border-stone-700' },
                { id: 'oled', name: 'Pure Black (OLED)', bg: 'bg-[#090A0C]', text: 'text-[#D1D5DB]', border: 'border-stone-800' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => onUpdatePreferences({ ...preferences, theme: t.id as ReaderTheme })}
                  className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-2 transition-all ${t.bg} ${t.border} border ${
                    preferences.theme === t.id ? 'ring-2 ring-emerald-500 ring-offset-1 ring-offset-stone-900 font-semibold' : 'opacity-70 hover:opacity-100'
                  }`}
                  title={t.name}
                  aria-label={`Theme ${t.name}`}
                >
                  <span className={`text-xs ${t.text}`}>
                    {t.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Font Selection */}
          <div className="mb-4">
            <span className="text-[11px] font-medium text-stone-500 block mb-1.5">Font Style</span>
            <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-xl">
              {[
                { id: 'serif', label: 'Serif (Lora)', style: { fontFamily: "'Lora', serif" } },
                { id: 'sans', label: 'Sans (SF)', style: { fontFamily: "'Plus Jakarta Sans', sans-serif" } },
                { id: 'mono', label: 'Mono', style: { fontFamily: "'Space Mono', monospace" } },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => onUpdatePreferences({ ...preferences, font: f.id as ReaderFont })}
                  style={f.style}
                  className={`py-1.5 px-2 rounded-lg text-xs transition-all ${
                    preferences.font === f.id
                      ? 'bg-white dark:bg-stone-700 font-semibold shadow-xs text-stone-900 dark:text-white'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size Adjuster */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5 text-[11px] font-medium text-stone-500">
              <span>Text Size</span>
              <span>{preferences.fontSize}px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  onUpdatePreferences({
                    ...preferences,
                    fontSize: Math.max(14, preferences.fontSize - 1),
                  })
                }
                aria-label="Decrease font size"
                className="flex-1 py-1.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-300 transition-colors"
              >
                A-
              </button>
              <button
                onClick={() =>
                  onUpdatePreferences({
                    ...preferences,
                    fontSize: Math.min(26, preferences.fontSize + 1),
                  })
                }
                aria-label="Increase font size"
                className="flex-1 py-1.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-lg text-sm font-semibold text-stone-700 dark:text-stone-300 transition-colors"
              >
                A+
              </button>
            </div>
          </div>

          {/* Line Spacing */}
          <div>
            <span className="text-[11px] font-medium text-stone-500 block mb-1.5">Line Spacing</span>
            <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-xl">
              {(['normal', 'relaxed', 'loose'] as ReaderLineHeight[]).map((lh) => (
                <button
                  key={lh}
                  onClick={() => onUpdatePreferences({ ...preferences, lineHeight: lh })}
                  className={`py-1 text-xs capitalize rounded-lg transition-all ${
                    preferences.lineHeight === lh
                      ? 'bg-white dark:bg-stone-700 font-medium shadow-xs text-stone-900 dark:text-white'
                      : 'text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {lh}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Scrollable Article Body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-5 py-6 md:px-8 selection:text-current relative no-scrollbar"
      >
        <div className="max-w-prose mx-auto">
          {/* Newspaper / Publication kicker */}
          <div className="flex items-center justify-between text-xs tracking-widest font-sans uppercase opacity-60 mb-3">
            <span>{article.feedTitle}</span>
            <span>{extractedMeta.readTimeMin || article.readTimeMin} min read</span>
          </div>

          {/* Article Title */}
          <h1
            style={{
              ...getFontFamilyStyle(preferences.font),
              fontSize: `${preferences.fontSize * 1.55}px`,
              lineHeight: 1.25,
              textWrap: 'balance',
            }}
            className="font-bold tracking-tight mb-4"
          >
            {extractedMeta.title || article.title}
          </h1>

          {/* Byline & Date */}
          <div className="flex items-center flex-wrap gap-2 text-xs opacity-70 pb-5 mb-6 border-b border-current/10">
            {(extractedMeta.author || article.author) && (
              <>
                <span className="font-medium">By {extractedMeta.author || article.author}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>
              {new Date(article.pubDate).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatRelativeTime(article.timestamp)}</span>
          </div>

          {/* Quick AI Summary Trigger Button (if summary not open yet) */}
          {!showSummary && (
            <div className="mb-6">
              <button
                onClick={handleGenerateSummary}
                className="w-full py-2.5 px-3.5 rounded-xl bg-emerald-950/40 hover:bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs font-medium flex items-center justify-between transition-colors shadow-xs group"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span>Precise Editorial Summary & Key Takeaways</span>
                </div>
                <span className="text-[11px] opacity-75 group-hover:opacity-100 font-sans">
                  Generate Summary →
                </span>
              </button>
            </div>
          )}

          {/* Precise Editorial Summary Card (AI / Gemini 3.8 Flash) */}
          {showSummary && (
            <aside className="mb-8 p-4 md:p-5 rounded-2xl bg-stone-900/95 border border-emerald-500/30 shadow-lg text-stone-200 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-stone-800">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-sm text-stone-100">
                      Editorial Executive Summary
                    </h3>
                    <p className="text-[10px] text-stone-400 font-sans">
                      {summaryData?.provider === 'gemini'
                        ? 'Analyzed precisely by Gemini News Intelligence'
                        : 'Distilled by Editorial News Intelligence'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setShowSummary(false)}
                  aria-label="Hide summary"
                  className="p-1 rounded-md text-stone-400 hover:text-stone-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {isLoadingSummary ? (
                <div className="py-6 flex flex-col items-center justify-center space-y-2 text-xs text-stone-400 font-sans">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span>Synthesizing article facts and key takeaways...</span>
                </div>
              ) : summaryData ? (
                <div className="space-y-3.5 text-xs font-sans leading-relaxed">
                  {/* Executive Overview */}
                  <div className="p-3 rounded-xl bg-stone-950/60 border border-stone-800/80">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400 block mb-1">
                      Overview
                    </span>
                    <p className="text-stone-200 font-serif text-[13px] leading-relaxed">
                      {summaryData.executiveSummary}
                    </p>
                  </div>

                  {/* Bulleted Key Takeaways */}
                  {summaryData.keyTakeaways && summaryData.keyTakeaways.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-stone-400 block mb-1.5">
                        Key Points & Takeaways
                      </span>
                      <ul className="space-y-1.5 pl-1">
                        {summaryData.keyTakeaways.map((point, i) => (
                          <li key={i} className="flex items-start gap-2 text-stone-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Context note */}
                  {summaryData.context && (
                    <div className="pt-2 border-t border-stone-800/60 text-[11px] text-stone-400 italic">
                      {summaryData.context}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-stone-400">Failed to generate summary. Please try again.</p>
              )}
            </aside>
          )}

          {/* Lead / Hero Image */}
          {(extractedMeta.leadImage || article.imageUrl) && (
            <figure className="mb-8 rounded-xl overflow-hidden shadow-xs border border-current/10">
              <img
                src={extractedMeta.leadImage || article.imageUrl}
                alt={extractedMeta.title || article.title}
                referrerPolicy="no-referrer"
                className="w-full h-auto max-h-[360px] object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </figure>
          )}

          {/* Article Text Content (Instantly Visible & Read Ready) */}
          <div
            style={{
              ...getFontFamilyStyle(preferences.font),
              fontSize: `${preferences.fontSize}px`,
            }}
            className={`${getLineHeightClass(preferences.lineHeight)} space-y-5`}
          >
            {/* If rich extracted blocks are available, render them */}
            {extractedBlocks && extractedBlocks.length > 0 ? (
              extractedBlocks.map((block, idx) => {
                if (block.type === 'h2' || block.type === 'h3') {
                  return (
                    <h2
                      key={idx}
                      className="font-bold pt-4 text-xl tracking-tight opacity-95"
                    >
                      {block.text}
                    </h2>
                  );
                }
                if (block.type === 'blockquote') {
                  return (
                    <blockquote
                      key={idx}
                      className="py-3 px-4 my-4 border-l-2 border-current/40 italic opacity-90 text-lg"
                    >
                      "{block.text}"
                    </blockquote>
                  );
                }
                if (block.type === 'img' && block.src) {
                  return (
                    <figure key={idx} className="my-5 rounded-lg overflow-hidden border border-current/10">
                      <img
                        src={block.src}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-auto object-cover"
                      />
                      {block.caption && (
                        <figcaption className="p-2 text-xs opacity-60 italic font-sans">
                          {block.caption}
                        </figcaption>
                      )}
                    </figure>
                  );
                }
                // Paragraph with drop cap on first paragraph
                return (
                  <p
                    key={idx}
                    className={idx === 0 ? 'first-letter:text-4xl first-letter:font-bold first-letter:float-left first-letter:mr-2.5 first-letter:mt-1 opacity-90' : 'opacity-90'}
                  >
                    {block.text}
                  </p>
                );
              })
            ) : article.contentHtml ? (
              /* Instant zero-delay render of full article HTML */
              <div
                className="article-prose prose-stone max-w-none space-y-5"
                dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.contentHtml) }}
              />
            ) : article.contentClean ? (
              /* Instant fallback to clean content paragraphs */
              <div className="space-y-4">
                {article.contentClean
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, idx) => (
                    <p
                      key={idx}
                      className={idx === 0 ? 'first-letter:text-4xl first-letter:font-bold first-letter:float-left first-letter:mr-2.5 first-letter:mt-1 opacity-90' : 'opacity-90'}
                    >
                      {p}
                    </p>
                  ))}
              </div>
            ) : (
              /* Instant fallback to story summary */
              <p className="opacity-90 leading-relaxed text-base">{article.summary}</p>
            )}

            {/* Silent non-blocking background enrichment indicator */}
            {isLoadingExtraction && (
              <div className="pt-2 pb-1 flex items-center gap-2 text-[11px] opacity-40 font-sans">
                <div className="w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
                <span>Checking portal for extra updates...</span>
              </div>
            )}
          </div>

          {/* Article Tags & Categorization Footer */}
          <div className="mt-12 pt-6 border-t border-current/15">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider font-semibold opacity-60 font-sans">
                Assigned Tags
              </span>
              <button
                onClick={() => onOpenTagManager(article)}
                aria-label="Edit article tags"
                className="text-xs opacity-80 hover:opacity-100 underline transition-opacity"
              >
                + Edit Tags
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {articleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-current/20 bg-current/5"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span>{tag.name}</span>
                </span>
              ))}

              {articleTags.length === 0 && (
                <span className="text-xs opacity-50 italic">
                  No tags assigned yet. Tap "Edit Tags" to categorize this story.
                </span>
              )}
            </div>
          </div>

          {/* Original source attribution; articles remain inside the app */}
          <div className="mt-8 p-4 rounded-xl border border-current/15 bg-current/5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="font-medium block">Original newspaper story</span>
                <span className="opacity-60 truncate block">
                  Reading mode copy from {article.feedTitle}.
                </span>
              </div>
              {article.link && article.link.startsWith('http') && (
                <a
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-current/20 font-medium hover:bg-current/10 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open original</span>
                </a>
              )}
            </div>
          </div>

          {/* Bottom Navigation: Next Article */}
          <div className="mt-8 mb-12 flex items-center justify-between">
            <button
              onClick={onBack}
              className="text-xs font-medium opacity-70 hover:opacity-100 flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Feed</span>
            </button>

            {onNextArticle && (
              <button
                onClick={onNextArticle}
                className="text-xs font-medium opacity-80 hover:opacity-100 px-3 py-1.5 rounded-lg border border-current/20 hover:bg-current/10 transition-colors"
              >
                Next Story →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Floating Distraction-Free Toggle Button at bottom right */}
      <button
        onClick={() => setFocusMode(!focusMode)}
        aria-label={focusMode ? 'Exit Distraction-Free Mode' : 'Enter Distraction-Free Focus Mode'}
        title={focusMode ? 'Show Controls' : 'Distraction-Free Focus Mode'}
        className="absolute bottom-5 right-5 p-2.5 rounded-full bg-stone-900/80 dark:bg-stone-100/80 text-stone-100 dark:text-stone-900 shadow-lg backdrop-blur-md hover:scale-105 active:scale-95 transition-all z-30 opacity-60 hover:opacity-100"
      >
        {focusMode ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>
    </div>
  );
};
