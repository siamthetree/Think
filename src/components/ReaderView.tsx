import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Type,
  Bookmark,
  Share2,
  Tag as TagIcon,
  X,
  Sparkles,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Check,
  Quote,
  EyeOff,
  HardDriveDownload,
  Download,
  Shield,
  Image as ImageIcon,
} from 'lucide-react';
import type { FeedItem, Tag, ReaderPreferences, ReaderTheme, ReaderFont, ReaderLineHeight } from '../types';
import { sanitizeArticleHtml, blocksToHtml, isJavaScriptWarningText } from '../utils/sanitize';
import { extractArticleWithFallback, summarizeArticleWithFallback, type ArticleSummaryResult } from '../utils/apiClient';
import { isAllowedPublisherMediaUrl, stripTrackingParams } from '../utils/urlSecurity';
import { resolveImageThroughPrivacyRelay } from '../utils/nativeFetcher';
import {
  triggerHapticSelection,
  triggerHapticPull,
  triggerHapticDisarm,
  triggerHapticComplete,
} from '../utils/haptics';
import {
  rubberBand,
  resolveGestureAxisLock,
  computeReleaseVelocity,
  getTouchDistance,
  computePinchFontSize,
  classifyHorizontalSwipe,
  isDoubleTapGesture,
  type GestureAxisLock,
  type VelocitySample,
} from '../utils/touchGestures';
import { QuoteShareModal } from './QuoteShareModal';
import { PerspectiveLogo } from './PerspectiveLogo';
import { generateQuickTldrBullets } from '../utils/feedIntelligence';
import { savePhotoToGallery } from '../utils/storyCardRenderer';
import { sanitizeTextSelection } from '../utils/articleLines';
import {
  createDefaultReadingSpeedProfile,
  estimateArticleReadTime,
  type ReadingSpeedProfile,
} from '../utils/readingSpeed';

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
  onPrevArticle?: () => void;
  onNextArticle?: () => void;
  initialScrollTop?: number;
  onReadingProgressChange?: (article: FeedItem, progressPercent: number, scrollTop: number) => void;
  readingSpeedProfile?: ReadingSpeedProfile;
  onCompleteReadingSession?: (session: {
    article: FeedItem;
    text: string;
    contentHtml?: string;
    activeMs: number;
  }) => void;
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
  onOpenPerspective?: (article: FeedItem) => void;
}

/** Formats date into "NOV 7, 2026 AT 5:11 AM" */
function formatEditorialTimestamp(pubDate: string, fallbackTimestamp: number): string {
  const d = new Date(pubDate || fallbackTimestamp);
  if (Number.isNaN(d.getTime())) return '';
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart} AT ${timePart}`.toUpperCase();
}

/** Extracts a concise subtitle/deck if distinct from the main title */
function getEditorialSubtitle(summary?: string, title?: string): string | null {
  if (!summary || /tap to load full story|full story loads in the app's reading mode/i.test(summary)) {
    return null;
  }
  const clean = summary.replace(/\s+/g, ' ').trim();
  if (!clean || clean === title) return null;
  // Take first sentence or up to 120 chars for a clean newsletter-style standfirst
  const firstSentenceMatch = clean.match(/^[^.!?]+[.!?]/);
  const candidate = firstSentenceMatch ? firstSentenceMatch[0].trim() : clean;
  if (candidate.length > 140) {
    return `${candidate.slice(0, 135).trim()}…`;
  }
  return candidate;
}

interface ReaderThemeSpec {
  id: ReaderTheme;
  name: string;
  swatch: string;
  vars: Record<string, string>;
}

const READER_THEMES: ReaderThemeSpec[] = [
  {
    id: 'paper',
    name: 'Paper',
    swatch: 'bg-[#FBF9F5]',
    vars: {
      '--reader-bg': '#FBF9F5',
      '--reader-surface': 'rgba(28, 25, 23, 0.04)',
      '--reader-surface-strong': 'rgba(28, 25, 23, 0.08)',
      '--reader-text': '#292524',
      '--reader-heading': '#1C1917',
      '--reader-muted': '#78716C',
      '--reader-border': 'rgba(28, 25, 23, 0.12)',
      '--reader-quote-border': 'rgba(255, 103, 25, 0.55)',
      '--reader-quote-text': '#44403C',
      '--reader-link-underline': 'rgba(28, 25, 23, 0.35)',
    },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    swatch: 'bg-[#F4ECD8]',
    vars: {
      '--reader-bg': '#F4ECD8',
      '--reader-surface': 'rgba(56, 47, 45, 0.05)',
      '--reader-surface-strong': 'rgba(56, 47, 45, 0.10)',
      '--reader-text': '#433422',
      '--reader-heading': '#2B2118',
      '--reader-muted': '#7C6A58',
      '--reader-border': 'rgba(67, 52, 34, 0.15)',
      '--reader-quote-border': 'rgba(180, 83, 9, 0.5)',
      '--reader-quote-text': '#5B4636',
      '--reader-link-underline': 'rgba(67, 52, 34, 0.4)',
    },
  },
  {
    id: 'clean',
    name: 'Clean',
    swatch: 'bg-[#FFFFFF]',
    vars: {
      '--reader-bg': '#FFFFFF',
      '--reader-surface': 'rgba(17, 24, 39, 0.04)',
      '--reader-surface-strong': 'rgba(17, 24, 39, 0.08)',
      '--reader-text': '#1F2937',
      '--reader-heading': '#111827',
      '--reader-muted': '#6B7280',
      '--reader-border': 'rgba(17, 24, 39, 0.12)',
      '--reader-quote-border': 'rgba(255, 103, 25, 0.6)',
      '--reader-quote-text': '#374151',
      '--reader-link-underline': 'rgba(17, 24, 39, 0.35)',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    swatch: 'bg-[#181818]',
    vars: {
      '--reader-bg': '#181818',
      '--reader-surface': 'rgba(255, 255, 255, 0.04)',
      '--reader-surface-strong': 'rgba(255, 255, 255, 0.08)',
      '--reader-text': '#E6E6E6',
      '--reader-heading': '#EDEDED',
      '--reader-muted': '#9E9E9E',
      '--reader-border': '#2C2C2C',
      '--reader-quote-border': 'rgba(255, 255, 255, 0.28)',
      '--reader-quote-text': '#CFCFCF',
      '--reader-link-underline': 'rgba(255, 255, 255, 0.45)',
    },
  },
  {
    id: 'oled',
    name: 'OLED',
    swatch: 'bg-[#000000]',
    vars: {
      '--reader-bg': '#000000',
      '--reader-surface': 'rgba(255, 255, 255, 0.05)',
      '--reader-surface-strong': 'rgba(255, 255, 255, 0.10)',
      '--reader-text': '#D1D5DB',
      '--reader-heading': '#F9FAFB',
      '--reader-muted': '#9CA3AF',
      '--reader-border': 'rgba(255, 255, 255, 0.14)',
      '--reader-quote-border': 'rgba(255, 255, 255, 0.3)',
      '--reader-quote-text': '#D1D5DB',
      '--reader-link-underline': 'rgba(255, 255, 255, 0.45)',
    },
  },
];

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
  onPrevArticle,
  onNextArticle,
  initialScrollTop = 0,
  onReadingProgressChange,
  readingSpeedProfile,
  onCompleteReadingSession,
  onCacheExtractedArticle,
  onOpenPerspective,
}) => {
  const [showTypographyMenu, setShowTypographyMenu] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [selectedQuoteText, setSelectedQuoteText] = useState('');
  const [activeSelectionText, setActiveSelectionText] = useState('');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [edgeBackOffset, setEdgeBackOffset] = useState(0);
  const [storySwipeOffset, setStorySwipeOffset] = useState(0);
  const [loadedImageUrls, setLoadedImageUrls] = useState<Record<string, boolean>>({});
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

  const blockThirdPartyMedia = preferences.blockThirdPartyMedia ?? true;
  const strictTextOnlyMode = preferences.strictTextOnlyMode ?? false;
  const publisherOriginUrl =
    article.link && /^https?:\/\//i.test(article.link) ? article.link : article.feedUrl;

  const containerRef = useRef<HTMLDivElement>(null);
  const articleBodyRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const swipeStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    axisLock: GestureAxisLock;
    armedFired: boolean;
    pointerId?: number;
    samples: VelocitySample[];
  } | null>(null);
  const suppressCanvasClickRef = useRef(false);
  const pinchStartRef = useRef<{ distance: number; baseFontSize: number } | null>(null);
  const lastParagraphTapRef = useRef<{ time: number; x: number; y: number; text: string }>({
    time: 0,
    x: 0,
    y: 0,
    text: '',
  });

  const syncArticleSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setActiveSelectionText('');
      return;
    }
    const bodyEl = articleBodyRef.current;
    if (!bodyEl) {
      setActiveSelectionText('');
      return;
    }
    const anchorInside = sel.anchorNode ? bodyEl.contains(sel.anchorNode) : false;
    const focusInside = sel.focusNode ? bodyEl.contains(sel.focusNode) : false;
    if (!anchorInside && !focusInside) {
      setActiveSelectionText('');
      return;
    }
    setActiveSelectionText(sanitizeTextSelection(sel.toString()));
  }, []);

  const fullReadableText = useMemo(() => {
    if (extractedBlocks && extractedBlocks.length > 0) {
      return extractedBlocks
        .filter((b) => b.type !== 'img' && b.text)
        .map((b) => b.text as string)
        .join('\n\n');
    }
    return article.contentClean || article.summary || '';
  }, [extractedBlocks, article.contentClean, article.summary]);

  const adaptiveEstimate = useMemo(() => {
    return estimateArticleReadTime(
      {
        ...article,
        contentClean: fullReadableText || article.contentClean,
        contentHtml: extractedBlocks ? undefined : article.contentHtml,
      },
      readingSpeedProfile || createDefaultReadingSpeedProfile()
    );
  }, [article, extractedBlocks, fullReadableText, readingSpeedProfile]);

  // Active reading time & completion refs for adaptive (words, lines, language) pace learning
  const activeReadingMsRef = useRef(0);
  const lastTickAtRef = useRef(Date.now());
  const lastUserActivityRef = useRef(Date.now());
  const maxScrollProgressRef = useRef(0);
  const bodyReachedBottomRef = useRef(false);
  const lastReportedActiveMsRef = useRef(0);
  const latestTextRef = useRef(fullReadableText);
  latestTextRef.current = fullReadableText;
  const latestHtmlRef = useRef(extractedBlocks ? undefined : article.contentHtml);
  latestHtmlRef.current = extractedBlocks ? undefined : article.contentHtml;
  const latestArticleRef = useRef(article);
  latestArticleRef.current = article;
  const onCompleteReadingSessionRef = useRef(onCompleteReadingSession);
  onCompleteReadingSessionRef.current = onCompleteReadingSession;

  const markUserActive = useCallback(() => {
    lastUserActivityRef.current = Date.now();
  }, []);

  const accumulateElapsedReadingMs = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastTickAtRef.current;
    lastTickAtRef.current = now;
    if (
      document.visibilityState === 'visible' &&
      now - lastUserActivityRef.current <= 45000 &&
      elapsed > 0 &&
      elapsed <= 5000
    ) {
      activeReadingMsRef.current += elapsed;
    }
  }, []);

  const checkBodyCompletion = useCallback(() => {
    const container = containerRef.current;
    const body = articleBodyRef.current;
    if (!container || !body) return false;
    const bodyRect = body.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (bodyRect.height > 0 && bodyRect.bottom <= containerRect.bottom + 48) {
      bodyReachedBottomRef.current = true;
      return true;
    }
    return false;
  }, []);

  const flushReadingSession = useCallback(
    (forceCompleted = false) => {
      accumulateElapsedReadingMs();
      const cb = onCompleteReadingSessionRef.current;
      if (!cb) return;
      const activeMs = activeReadingMsRef.current;
      if (activeMs < 5000) return;

      const scrollable = containerRef.current
        ? containerRef.current.scrollHeight - containerRef.current.clientHeight
        : 0;
      const isShortNonScrollable = scrollable <= 80 && activeMs >= 6000;
      const reachedEnd = bodyReachedBottomRef.current || checkBodyCompletion();
      const hasFinished =
        forceCompleted || reachedEnd || maxScrollProgressRef.current >= 65 || isShortNonScrollable;
      if (!hasFinished) return;

      // Avoid redundant re-submits unless user stayed noticeably longer finishing the tail
      if (lastReportedActiveMsRef.current > 0 && activeMs - lastReportedActiveMsRef.current < 2000) {
        return;
      }

      lastReportedActiveMsRef.current = activeMs;
      const art = latestArticleRef.current;
      cb({
        article: art,
        text: latestTextRef.current || art.contentClean || art.summary || art.title,
        contentHtml: latestHtmlRef.current,
        activeMs,
      });
    },
    [accumulateElapsedReadingMs, checkBodyCompletion]
  );

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 2200);
  };

  const handleSaveArticlePhoto = async (photoUrl: string, e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticSelection();
    const res = await savePhotoToGallery(photoUrl, extractedMeta.title || article.title);
    if (res.ok) triggerHapticComplete();
    showToast(res.message);
  };

  const hasActiveTextSelection = () => {
    const sel = window.getSelection();
    return Boolean(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
  };

  const beginHorizontalGesture = (cx: number, cy: number, pointerId?: number) => {
    if (hasActiveTextSelection()) {
      swipeStartRef.current = null;
      return;
    }
    const now = performance.now();
    suppressCanvasClickRef.current = false;
    swipeStartRef.current = {
      x: cx,
      y: cy,
      time: now,
      axisLock: 'undecided',
      armedFired: false,
      pointerId,
      samples: [{ x: cx, y: cy, t: now }],
    };
  };

  const updateHorizontalGesture = (cx: number, cy: number, captureTarget?: HTMLElement, pointerId?: number) => {
    const start = swipeStartRef.current;
    if (!start) return;

    const dx = cx - start.x;
    const dy = cy - start.y;
    const now = performance.now();

    start.samples.push({ x: cx, y: cy, t: now });
    if (start.samples.length > 8) start.samples.shift();

    const prevLock = start.axisLock;
    start.axisLock = resolveGestureAxisLock(start.axisLock, dx, dy);
    if (start.axisLock !== 'horizontal') {
      return;
    }

    if (prevLock !== 'horizontal') {
      window.getSelection()?.removeAllRanges();
      if (captureTarget && pointerId !== undefined) {
        try {
          if (!captureTarget.hasPointerCapture(pointerId)) {
            captureTarget.setPointerCapture(pointerId);
          }
        } catch {
          // ignore if unsupported
        }
      }
    }

    suppressCanvasClickRef.current = true;

    // 1. Swipe Right from anywhere on screen -> interactive pop/back to feed
    if (dx > 0) {
      const clamped = Math.min(240, Math.round(dx * 0.9));
      setEdgeBackOffset(clamped);
      setStorySwipeOffset(0);
      if (clamped >= 68 && !start.armedFired) {
        start.armedFired = true;
        triggerHapticPull();
      } else if (clamped < 58 && start.armedFired) {
        start.armedFired = false;
        triggerHapticDisarm();
      }
      return;
    }

    // 2. Swipe Left -> Next Story preview (swipe to previous story intentionally removed)
    if (dx < -10 && onNextArticle) {
      setEdgeBackOffset(0);
      setStorySwipeOffset(Math.round(rubberBand(dx, 38, 0.5)));
    }
  };

  const endHorizontalGesture = (cx: number, cy: number, cancelled: boolean) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    setEdgeBackOffset(0);
    setStorySwipeOffset(0);

    if (cancelled || !start || start.axisLock !== 'horizontal') return;

    const now = performance.now();
    start.samples.push({ x: cx, y: cy, t: now });
    const { vx } = computeReleaseVelocity(start.samples);

    const intent = classifyHorizontalSwipe({
      startX: start.x,
      startY: start.y,
      endX: cx,
      endY: cy,
      durationMs: now - start.time,
      velocityX: vx,
      edgeThreshold: Number.POSITIVE_INFINITY,
      minSwipeDistance: 64,
    });

    if (intent === 'edge-back') {
      triggerHapticComplete();
      onBack();
      return;
    }

    if (intent === 'next-item' && onNextArticle) {
      triggerHapticSelection();
      onNextArticle();
      showToast('Next story');
    }
  };

  const handleTouchStartSwipe = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Two-finger pinch-to-zoom typography scale
      swipeStartRef.current = null;
      setEdgeBackOffset(0);
      setStorySwipeOffset(0);
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      pinchStartRef.current = {
        distance: dist,
        baseFontSize: preferences.fontSize,
      };
      return;
    }

    if (e.touches.length !== 1) return;
    pinchStartRef.current = null;
    beginHorizontalGesture(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleTouchMoveSwipe = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartRef.current) {
      const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
      const nextFontSize = computePinchFontSize(
        pinchStartRef.current.distance,
        currentDist,
        pinchStartRef.current.baseFontSize,
        14,
        26
      );
      if (nextFontSize !== preferences.fontSize) {
        triggerHapticSelection();
        onUpdatePreferences({ ...preferences, fontSize: nextFontSize });
        showToast(`Text Size: ${nextFontSize + 1}px`);
      }
      return;
    }

    if (e.touches.length !== 1) return;
    updateHorizontalGesture(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleTouchEndSwipe = (e: React.TouchEvent, cancelled = false) => {
    if (pinchStartRef.current) {
      pinchStartRef.current = null;
      return;
    }

    if (e.changedTouches.length !== 1) {
      swipeStartRef.current = null;
      setEdgeBackOffset(0);
      setStorySwipeOffset(0);
      return;
    }
    const endTouch = e.changedTouches[0];
    endHorizontalGesture(endTouch.clientX, endTouch.clientY, cancelled);
  };

  // Pointer fallback for mouse / trackpad horizontal swipe-back (ignores touch so touch events don't double-fire)
  const handlePointerDownSwipe = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    beginHorizontalGesture(e.clientX, e.clientY, e.pointerId);
  };

  const handlePointerMoveSwipe = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch' || e.buttons !== 1) return;
    if (!swipeStartRef.current || swipeStartRef.current.pointerId !== e.pointerId) return;
    updateHorizontalGesture(e.clientX, e.clientY, e.currentTarget, e.pointerId);
  };

  const handlePointerUpSwipe = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    if (e.pointerType === 'touch') return;
    if (!swipeStartRef.current || swipeStartRef.current.pointerId !== e.pointerId) return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    endHorizontalGesture(e.clientX, e.clientY, cancelled);
  };

  // Double-tap any paragraph in ReaderView to open Editorial Quote Card with that passage
  const handleBodyParagraphClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const paragraphEl = target.closest('p, blockquote');
    const text = paragraphEl?.textContent?.trim() || '';
    if (!text || text.length < 24) return;

    const now = Date.now();
    const isDouble = isDoubleTapGesture({
      lastTapTime: lastParagraphTapRef.current.time,
      currentTime: now,
      lastX: lastParagraphTapRef.current.x,
      lastY: lastParagraphTapRef.current.y,
      currentX: e.clientX,
      currentY: e.clientY,
    });

    if (isDouble) {
      e.stopPropagation();
      lastParagraphTapRef.current = { time: 0, x: 0, y: 0, text: '' };
      triggerHapticComplete();
      setSelectedQuoteText(text);
      setShowQuoteModal(true);
      return;
    }

    lastParagraphTapRef.current = { time: now, x: e.clientX, y: e.clientY, text };
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

  // Handle scroll progress & auto-hide floating dock on downward scroll
  const handleScroll = () => {
    markUserActive();
    accumulateElapsedReadingMs();
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const scrollable = scrollHeight - clientHeight;

    const delta = scrollTop - lastScrollTopRef.current;
    if (scrollTop < 40) {
      setControlsVisible(true);
    } else if (delta > 8) {
      setControlsVisible(false);
      setShowTypographyMenu(false);
    } else if (delta < -8) {
      setControlsVisible(true);
    }
    lastScrollTopRef.current = scrollTop;

    const reachedEnd = checkBodyCompletion();

    if (scrollable <= 0) {
      setScrollProgress(0);
      return;
    }
    const progress = Math.min(100, Math.max(0, Math.round((scrollTop / scrollable) * 100)));
    if (progress > maxScrollProgressRef.current) {
      maxScrollProgressRef.current = progress;
    }
    setScrollProgress(progress);
    if (progress >= 92 || reachedEnd) {
      flushReadingSession(progress >= 92);
    }
    if (onReadingProgressChange) {
      onReadingProgressChange(article, progress, scrollTop);
    }
  };

  const handleShare = async () => {
    triggerHapticSelection();
    const cleanShareLink = stripTrackingParams(article.link || window.location.href);
    const shareData = {
      title: extractedMeta.title || article.title,
      text: `${extractedMeta.title || article.title} - ${article.feedTitle}`,
      url: cleanShareLink,
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Fallback to clipboard
      }
    }

    if (navigator.clipboard && cleanShareLink) {
      try {
        await navigator.clipboard.writeText(cleanShareLink);
        showToast('Link copied to clipboard');
        return;
      } catch {
        // ignore
      }
    }
    showToast('Story link ready');
  };

  // Reset per-article state & flush any completed reading session when story changes or Reader unmounts
  useEffect(() => {
    activeReadingMsRef.current = 0;
    lastTickAtRef.current = Date.now();
    lastUserActivityRef.current = Date.now();
    maxScrollProgressRef.current = 0;
    bodyReachedBottomRef.current = false;
    lastReportedActiveMsRef.current = 0;

    setSummaryData(null);
    setShowSummary(false);
    setIsLoadingSummary(false);
    setExtractedBlocks(null);
    setActiveSelectionText('');
    setLoadedImageUrls({});
    setScrollProgress(0);
    setControlsVisible(true);
    lastScrollTopRef.current = initialScrollTop || 0;
    requestAnimationFrame(() => {
      containerRef.current?.scrollTo({ top: initialScrollTop || 0 });
    });

    return () => {
      flushReadingSession(false);
    };
  }, [article.id, flushReadingSession]);

  // Foreground active-reading timer (high-precision delta, pauses when backgrounded or idle >45s)
  useEffect(() => {
    const onInteract = () => markUserActive();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        lastTickAtRef.current = Date.now();
        lastUserActivityRef.current = Date.now();
      } else {
        accumulateElapsedReadingMs();
      }
    };
    window.addEventListener('touchstart', onInteract, { passive: true });
    window.addEventListener('pointerdown', onInteract, { passive: true });
    window.addEventListener('keydown', onInteract, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    const interval = window.setInterval(() => {
      accumulateElapsedReadingMs();
    }, 500);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('touchstart', onInteract);
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [accumulateElapsedReadingMs, markUserActive]);

  // Listen for native iOS/Web text highlight changes inside the article body
  useEffect(() => {
    document.addEventListener('selectionchange', syncArticleSelection);
    return () => {
      document.removeEventListener('selectionchange', syncArticleSelection);
    };
  }, [syncArticleSelection]);

  // Automatically mark article as read upon viewing
  useEffect(() => {
    if (!article.isRead) {
      onToggleRead(article.id);
    }
  }, [article.id]);

  // Fetch rich article extractor from URL for clean distraction-free reading if not already pre-loaded
  useEffect(() => {
    let cancelled = false;
    setExtractedMeta({});
    setExtractedBlocks(null);
    const contentText = (article.contentClean || '').trim();
    const isGoogleRedirect = /news\.google\.com\/rss\/articles\//i.test(article.link || '');
    const alreadyExtracted =
      Boolean(article.isOfflineCached && contentText.length >= 160) ||
      contentText.length >= 450 ||
      isGoogleRedirect;

    if (!alreadyExtracted && article.link && article.link.startsWith('http')) {
      setIsLoadingExtraction(true);
      extractArticleWithFallback(article.link)
        .then((data) => {
          if (cancelled) return;
          if (data.success && data.blocks && data.blocks.length > 0) {
            const validBlocks = data.blocks.filter(
              (b: any) => !b.text || !isJavaScriptWarningText(b.text)
            );
            const cleanFromBlocks = validBlocks
              .map((b: any) => b.text || '')
              .filter(Boolean)
              .join('\n\n');
            if (validBlocks.length > 0 && cleanFromBlocks.length >= Math.min(120, contentText.length || 80)) {
              setExtractedBlocks(validBlocks);
              setExtractedMeta({
                title: data.title,
                author: data.author,
                leadImage: data.leadImage,
                readTimeMin: data.readTimeMin,
              });
              if (onCacheExtractedArticle) {
                const htmlFromBlocks = blocksToHtml(validBlocks);
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

  const activeThemeSpec =
    READER_THEMES.find((t) => t.id === preferences.theme) || READER_THEMES[3];

  // Dynamically synchronize CSS custom properties whenever preferences.theme changes
  useEffect(() => {
    const rootStyle = document.documentElement.style;
    for (const [prop, val] of Object.entries(activeThemeSpec.vars)) {
      rootStyle.setProperty(prop, val);
    }
  }, [activeThemeSpec]);

  const getThemeClasses = (theme: ReaderTheme) => {
    switch (theme) {
      case 'paper':
        return 'reader-theme-paper selection:bg-[#FF6719]/20';
      case 'sepia':
        return 'reader-theme-sepia selection:bg-[#FF6719]/20';
      case 'clean':
        return 'reader-theme-clean selection:bg-[#FF6719]/20';
      case 'oled':
        return 'reader-theme-oled selection:bg-white/15';
      case 'slate':
      default:
        return 'reader-theme-slate selection:bg-white/15';
    }
  };

  // Body font family styles mapping
  const getBodyFontFamilyStyle = (font: ReaderFont) => {
    switch (font) {
      case 'sans':
        return { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif" };
      case 'mono':
        return { fontFamily: "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace" };
      case 'serif':
      default:
        return { fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif" };
    }
  };

  const getLineHeightStyle = (lh: ReaderLineHeight) => {
    switch (lh) {
      case 'normal':
        return 1.56;
      case 'loose':
        return 1.82;
      case 'relaxed':
      default:
        return 1.68;
    }
  };

  const articleTags = tags.filter((t) => article.tags.includes(t.id));
  const rawAuthor = (extractedMeta.author || article.author || '').trim();
  const bylineText =
    rawAuthor && rawAuthor.toLowerCase() !== article.feedTitle.toLowerCase()
      ? `${article.feedTitle}, ${rawAuthor}`.toUpperCase()
      : article.feedTitle.toUpperCase();

  const subtitle = getEditorialSubtitle(article.summary, extractedMeta.title || article.title);
  const sourceInitial = (article.feedTitle || 'N').trim().charAt(0).toUpperCase();
  const authorInitial = rawAuthor ? rawAuthor.charAt(0).toUpperCase() : null;

  // Body font size: default 19px for authentic editorial serif legibility
  const effectiveBodySize = Math.max(16, preferences.fontSize + 1);

  const rawLeadImage = extractedMeta.leadImage || article.imageUrl;
  const isLeadImageAllowed = Boolean(
    rawLeadImage && isAllowedPublisherMediaUrl(rawLeadImage, publisherOriginUrl, blockThirdPartyMedia)
  );
  const safeLeadImageUrl = isLeadImageAllowed
    ? resolveImageThroughPrivacyRelay(rawLeadImage, preferences.privacyRelayUrl)
    : undefined;
  const isLeadImageGatedBehindTap = Boolean(
    safeLeadImageUrl && strictTextOnlyMode && !loadedImageUrls[safeLeadImageUrl]
  );

  const cleanArticlePermalink = article.link ? stripTrackingParams(article.link) : '';

  return (
    <div
      data-reader-theme={preferences.theme}
      className={`flex-1 flex flex-col h-full overflow-hidden relative reader-push-enter ${getThemeClasses(
        preferences.theme
      )}`}
      style={{
        ...(activeThemeSpec.vars as React.CSSProperties),
        backgroundColor: 'var(--reader-bg)',
        color: 'var(--reader-text)',
        transition: 'background-color 220ms ease, color 220ms ease',
      }}
    >
      {/* Top 2px Reading Momentum Bar */}
      {!preferences.distractionFree && (
        <div
          className="absolute top-0 left-0 right-0 h-[2px] z-40 pointer-events-none"
          style={{ backgroundColor: 'var(--reader-surface-strong)' }}
        >
          <div
            className="h-full bg-[#FF6719] transition-all duration-150"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="liquid-glass-dock px-3.5 py-1.5 rounded-full text-xs font-medium text-stone-100 flex items-center gap-1.5 shadow-2xl border border-white/20">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Apple Liquid Glass Typography, Appearance & Privacy Sheet */}
      {showTypographyMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-20 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setShowTypographyMenu(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="reader-liquid-card rounded-3xl p-5 w-full max-w-sm text-stone-100 shadow-2xl border border-white/20 animate-in zoom-in-95 duration-150 max-h-[82vh] overflow-y-auto no-scrollbar"
          >
            <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-white/10">
              <span className="text-xs font-semibold uppercase tracking-wider text-stone-300">
                Reader Appearance & Privacy
              </span>
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

            {/* 5-Mode Dynamic CSS Variable Theme Switcher */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-stone-400">Theme</span>
                <span className="text-[11px] font-semibold text-[#FF6719]">
                  {activeThemeSpec.name}
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label="Theme"
                className="grid grid-cols-5 gap-1.5 p-1 bg-black/40 border border-white/10 rounded-2xl"
              >
                {READER_THEMES.map((t) => {
                  const isActive = preferences.theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() => {
                        triggerHapticSelection();
                        onUpdatePreferences({ ...preferences, theme: t.id });
                      }}
                      className={`py-2 px-1 rounded-xl flex flex-col items-center gap-1.5 transition-all ${
                        isActive
                          ? 'liquid-glass-active-bubble ring-1 ring-[#FF6719] shadow-md'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full border border-white/30 shadow-xs flex items-center justify-center ${t.swatch}`}
                      >
                        {isActive && (
                          <Check
                            className={`w-3 h-3 ${
                              t.id === 'slate' || t.id === 'oled'
                                ? 'text-white'
                                : 'text-stone-900'
                            }`}
                          />
                        )}
                      </span>
                      <span className="text-[10px] font-medium text-stone-200 leading-none">
                        {t.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Font Selector */}
            <div className="mb-4">
              <span className="text-[11px] font-medium text-stone-400 block mb-2">Body Font</span>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/40 border border-white/10 rounded-2xl">
                {[
                  { id: 'serif', label: 'Serif', sample: 'Georgia', style: { fontFamily: 'Georgia, serif' } },
                  {
                    id: 'sans',
                    label: 'Sans',
                    sample: 'SF Pro',
                    style: { fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' },
                  },
                  {
                    id: 'mono',
                    label: 'Mono',
                    sample: 'SF Mono',
                    style: { fontFamily: 'ui-monospace, monospace' },
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
                <span>Text Size</span>
                <span className="font-mono text-stone-300">{effectiveBodySize} px</span>
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

            {/* Pure Focus Mode & Offline Cache Toggles */}
            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-white/10 mb-3">
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  const nextFocus = !preferences.distractionFree;
                  onUpdatePreferences({ ...preferences, distractionFree: nextFocus });
                  showToast(nextFocus ? 'Pure Focus Mode on' : 'Pure Focus Mode off');
                }}
                className={`py-2 px-2.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 border transition-all ${
                  preferences.distractionFree
                    ? 'bg-[#FF6719]/20 border-[#FF6719]/50 text-[#FF6719]'
                    : 'bg-black/35 border-white/10 text-stone-300 hover:text-white'
                }`}
              >
                <EyeOff className="w-3.5 h-3.5 shrink-0" />
                <span>Pure Focus</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onToggleOfflineCache(article);
                }}
                className={`py-2 px-2.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 border transition-all ${
                  article.isOfflineCached
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                    : 'bg-black/35 border-white/10 text-stone-300 hover:text-white'
                }`}
              >
                <HardDriveDownload className="w-3.5 h-3.5 shrink-0" />
                <span>{article.isOfflineCached ? 'Cached' : 'Cache Story'}</span>
              </button>
            </div>

            {/* Privacy Shield Controls: Block 3P Media & Tap-to-Load Media Mode */}
            <div className="pt-3 border-t border-white/10 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                <Shield className="w-3.5 h-3.5" />
                <span>IP & Tracker Protection</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    const next = !blockThirdPartyMedia;
                    onUpdatePreferences({ ...preferences, blockThirdPartyMedia: next });
                    showToast(next ? 'Third-party media blocked' : 'Third-party media allowed');
                  }}
                  className={`py-2 px-2.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 border transition-all ${
                    blockThirdPartyMedia
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-black/35 border-white/10 text-stone-400 hover:text-white'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  <span>Block 3P Media</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    const next = !strictTextOnlyMode;
                    onUpdatePreferences({ ...preferences, strictTextOnlyMode: next });
                    showToast(next ? 'Tap-to-Load Media on' : 'Tap-to-Load Media off');
                  }}
                  className={`py-2 px-2.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 border transition-all ${
                    strictTextOnlyMode
                      ? 'bg-[#FF6719]/20 border-[#FF6719]/50 text-[#FF6719]'
                      : 'bg-black/35 border-white/10 text-stone-300 hover:text-white'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>Tap-to-Load Media</span>
                </button>
              </div>

              <div className="pt-1">
                <label className="text-[10px] font-medium text-stone-400 block mb-1">
                  Stateless Privacy Relay URL (Optional)
                </label>
                <input
                  type="url"
                  value={preferences.privacyRelayUrl || ''}
                  onChange={(e) =>
                    onUpdatePreferences({ ...preferences, privacyRelayUrl: e.target.value })
                  }
                  placeholder="https://your-worker.workers.dev/?url="
                  className="w-full px-2.5 py-1.5 rounded-xl bg-black/40 border border-white/10 text-[11px] text-stone-200 placeholder:text-stone-500 focus:outline-none focus:border-[#FF6719]"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive iOS Left-Edge Swipe-Back Indicator Pill */}
      {edgeBackOffset > 12 && (
        <div
          aria-hidden="true"
          style={{
            transform: `translate3d(${Math.min(28, edgeBackOffset * 0.25)}px, -50%, 0)`,
            opacity: Math.min(1, edgeBackOffset / 64),
          }}
          className="fixed left-2 top-1/2 z-50 pointer-events-none"
        >
          <div
            className={`w-10 h-10 rounded-full liquid-glass-dock flex items-center justify-center border border-white/25 shadow-2xl transition-transform ${
              edgeBackOffset >= 68 ? 'scale-110 text-[#FF6719]' : 'text-white'
            }`}
          >
            <ChevronLeft className="w-5 h-5" />
          </div>
        </div>
      )}

      {/* Main Scrollable Article Reading Canvas */}
      <main
        ref={containerRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStartSwipe}
        onTouchMove={handleTouchMoveSwipe}
        onTouchEnd={(e) => handleTouchEndSwipe(e, false)}
        onTouchCancel={(e) => handleTouchEndSwipe(e, true)}
        onPointerDown={handlePointerDownSwipe}
        onPointerMove={handlePointerMoveSwipe}
        onPointerUp={(e) => handlePointerUpSwipe(e, false)}
        onPointerCancel={(e) => handlePointerUpSwipe(e, true)}
        onClick={() => {
          if (suppressCanvasClickRef.current) {
            suppressCanvasClickRef.current = false;
            return;
          }
          // Tapping the reading canvas toggles the floating bottom liquid glass controls
          // (skip toggling if user just finished selecting/highlighting text)
          if (!showTypographyMenu && !showQuoteModal) {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
            setControlsVisible((v) => !v);
          }
        }}
        style={{
          touchAction: 'pan-y',
          transform:
            edgeBackOffset > 0
              ? `translate3d(${edgeBackOffset}px, 0, 0)`
              : storySwipeOffset !== 0
                ? `translate3d(${storySwipeOffset}px, 0, 0)`
                : undefined,
          transition:
            edgeBackOffset > 0 || storySwipeOffset !== 0
              ? 'none'
              : 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="flex-1 overflow-y-auto px-[20px] pt-[max(env(safe-area-inset-top,0px),1.5rem)] pb-32 md:px-8 relative no-scrollbar"
      >
        <article className="max-w-[640px] mx-auto select-text">
          {/* 1. Uppercase Kicker (Publication Name) */}
          <div
            className="text-[12px] font-sans font-semibold uppercase tracking-[0.06em] mb-2.5"
            style={{ color: 'var(--reader-muted)' }}
          >
            {article.feedTitle}
          </div>

          {/* 2. Large Bold Sans-Serif Headline */}
          <h1
            className="font-sans font-bold tracking-[-0.022em] leading-[1.14]"
            style={{
              fontSize: 'clamp(27px, 7.2vw, 34px)',
              color: 'var(--reader-heading)',
            }}
          >
            {extractedMeta.title || article.title}
          </h1>

          {/* 3. Standfirst / Subtitle */}
          {subtitle && (
            <p
              className="font-sans font-normal text-[17px] leading-[1.42] mt-3.5 mb-5"
              style={{ color: 'var(--reader-muted)' }}
            >
              {subtitle}
            </p>
          )}

          {/* 4. Overlapping Circular Avatars + Reader Mark Row (hidden in Pure Focus Mode) */}
          {!preferences.distractionFree && (
            <div
              className={`flex items-center justify-between ${subtitle ? 'mt-5' : 'mt-6'} mb-3.5`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Left: Overlapping circular avatar stack (deterministic local monograms only, zero remote favicon leaks) */}
              <div className="flex items-center -space-x-2">
                <div
                  className="w-9 h-9 rounded-full bg-[#D92323] text-white flex items-center justify-center font-serif font-bold text-lg overflow-hidden shrink-0 shadow-xs"
                  style={{ boxShadow: '0 0 0 2px var(--reader-bg)' }}
                >
                  <span>{sourceInitial}</span>
                </div>

                {authorInitial && (
                  <div
                    className="w-9 h-9 rounded-full bg-gradient-to-br from-[#4F5D73] to-[#2C3545] text-white flex items-center justify-center font-sans font-semibold text-xs shrink-0"
                    style={{ boxShadow: '0 0 0 2px var(--reader-bg)' }}
                  >
                    {authorInitial}
                  </div>
                )}

                <div
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-[#FF7A2F] to-[#E8521A] flex items-center justify-center shrink-0"
                  style={{ boxShadow: '0 0 0 2px var(--reader-bg)' }}
                >
                  <span className="w-7 h-7 rounded-full border border-emerald-300/60" />
                </div>
              </div>

              {/* Right: Perspective & Reader Brand Mark / Quick Summary Trigger */}
              <div className="flex items-center gap-3">
                {onOpenPerspective && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      onOpenPerspective(article);
                    }}
                    title="Perspective - View all sources covering this story"
                    style={{
                      backgroundColor: 'var(--reader-surface)',
                      borderColor: 'var(--reader-border)',
                      color: 'var(--reader-heading)',
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all active:scale-95"
                  >
                    <PerspectiveLogo className="w-3.5 h-3.5 text-[#FF6719]" />
                    <span>Perspective</span>
                  </button>
                )}

                <button
                  onClick={handleGenerateSummary}
                  title="Toggle Editorial Summary"
                  style={{ color: 'var(--reader-heading)' }}
                  className="flex items-center gap-1.5 hover:opacity-80 transition-opacity active:scale-95"
                >
                  <svg
                    width="13"
                    height="15"
                    viewBox="0 0 14 16"
                    fill="#FF6719"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <path d="M0 0h14v2.2H0V0zm0 4.2h14v2.2H0V4.2zm0 4.2h14V16l-7-3.8L0 16V8.4z" />
                  </svg>
                  <span className="font-sans font-semibold text-[15px] tracking-[-0.02em]">
                    reader
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* 5. Uppercase Author Byline & Date-Time */}
          <div className="mt-3">
            <div
              className="text-[11.5px] font-sans font-bold uppercase tracking-[0.04em] leading-snug"
              style={{ color: 'var(--reader-heading)' }}
            >
              {bylineText}
            </div>
            <div
              className="text-[11.5px] font-sans font-medium uppercase tracking-[0.04em] mt-1 flex items-center gap-1.5 flex-wrap"
              style={{ color: 'var(--reader-muted)' }}
            >
              <span>{formatEditorialTimestamp(article.pubDate, article.timestamp)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {adaptiveEstimate.minutes}m read
              </span>
              {adaptiveEstimate.isPersonalized && (
                <span className="text-[10px] font-semibold text-[#FF6719] tracking-normal normal-case">
                  · Your {adaptiveEstimate.language === 'bn' ? 'Bangla' : 'English'} pace
                </span>
              )}
            </div>
          </div>

          {/* 6. Thin Subtle Horizontal Divider */}
          <div className="border-b my-5" style={{ borderColor: 'var(--reader-border)' }} />

          {/* Optional Editorial Summary Card */}
          {showSummary && (
            <aside
              onClick={(e) => e.stopPropagation()}
              className="my-6 rounded-2xl p-4 sm:p-5 border shadow-lg animate-in fade-in slide-in-from-top-2 duration-200"
              style={{
                backgroundColor: 'var(--reader-surface)',
                borderColor: 'var(--reader-border)',
                color: 'var(--reader-text)',
              }}
            >
              <div
                className="flex items-center justify-between pb-3 mb-3 border-b"
                style={{ borderColor: 'var(--reader-border)' }}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#FF6719]" />
                  <h3
                    className="font-sans font-bold text-xs uppercase tracking-wider"
                    style={{ color: 'var(--reader-heading)' }}
                  >
                    Editorial Summary
                  </h3>
                </div>
                <button
                  onClick={() => setShowSummary(false)}
                  aria-label="Hide summary"
                  style={{ color: 'var(--reader-muted)' }}
                  className="p-1 rounded-full hover:opacity-80 transition-opacity"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {isLoadingSummary ? (
                <div
                  className="py-6 flex items-center justify-center gap-2.5 text-xs font-sans"
                  style={{ color: 'var(--reader-muted)' }}
                >
                  <div className="w-4 h-4 border-2 border-[#FF6719] border-t-transparent rounded-full animate-spin" />
                  <span>Distilling key points…</span>
                </div>
              ) : summaryData ? (
                <div className="space-y-3 text-[14px] leading-relaxed">
                  <p className="font-serif" style={{ color: 'var(--reader-heading)' }}>
                    {summaryData.executiveSummary}
                  </p>
                  {summaryData.keyTakeaways && summaryData.keyTakeaways.length > 0 && (
                    <ul
                      className="space-y-1.5 pt-2 border-t font-sans text-[13px]"
                      style={{
                        borderColor: 'var(--reader-border)',
                        color: 'var(--reader-text)',
                      }}
                    >
                      {summaryData.keyTakeaways.map((point, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#FF6719] shrink-0 mt-2" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--reader-muted)' }}>
                  Unable to generate summary right now.
                </p>
              )}
            </aside>
          )}

          {/* 7. Lead / Hero Image (respects Block Third-Party Media & Tap-to-Load Media Mode) */}
          {safeLeadImageUrl && (
            isLeadImageGatedBehindTap ? (
              <div
                onClick={(e) => e.stopPropagation()}
                className="my-6 p-4 rounded-2xl border flex items-center justify-between gap-3 font-sans"
                style={{
                  backgroundColor: 'var(--reader-surface)',
                  borderColor: 'var(--reader-border)',
                }}
              >
                <div className="flex items-center gap-2.5 text-xs" style={{ color: 'var(--reader-muted)' }}>
                  <ImageIcon className="w-4 h-4 text-[#FF6719] shrink-0" />
                  <span>Lead image blocked until requested to protect your IP address</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticSelection();
                    setLoadedImageUrls((prev) => ({ ...prev, [safeLeadImageUrl]: true }));
                  }}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#FF6719] text-white active:scale-95 transition-transform shrink-0"
                >
                  Load Image
                </button>
              </div>
            ) : (
              <figure
                className="my-6 overflow-hidden rounded-[2px] relative group"
                style={{ backgroundColor: 'var(--reader-surface)' }}
              >
                <img
                  src={safeLeadImageUrl}
                  alt={extractedMeta.title || article.title}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  loading="eager"
                  className="w-full h-auto object-cover block"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                {!preferences.distractionFree && (
                  <button
                    type="button"
                    onClick={(e) => handleSaveArticlePhoto(safeLeadImageUrl, e)}
                    aria-label="Save photo to gallery"
                    title="Save photo to gallery"
                    className="absolute bottom-2.5 right-2.5 liquid-glass-dock px-2.5 py-1 rounded-full text-[10px] font-sans font-semibold text-white/95 flex items-center gap-1 border border-white/20 shadow-lg opacity-85 hover:opacity-100 active:scale-95 transition-all"
                  >
                    <Download className="w-3 h-3" />
                    <span>Save</span>
                  </button>
                )}
              </figure>
            )
          )}

          {/* Author Credit Attribution Line */}
          {rawAuthor && (
            <div
              className="mb-6 font-serif text-[18px] leading-[1.45]"
              style={{ color: 'var(--reader-heading)' }}
            >
              <div
                className="underline underline-offset-4"
                style={{ textDecorationColor: 'var(--reader-link-underline)' }}
              >
                {rawAuthor}
              </div>
              <div className="italic text-[17px]" style={{ color: 'var(--reader-muted)' }}>
                {article.feedTitle}
              </div>
            </div>
          )}

          {/* 8. Article Body Copy */}
          <div
            ref={articleBodyRef}
            onClick={handleBodyParagraphClick}
            onMouseUp={syncArticleSelection}
            onTouchEnd={syncArticleSelection}
            style={{
              ...getBodyFontFamilyStyle(preferences.font),
              fontSize: `${effectiveBodySize}px`,
              lineHeight: getLineHeightStyle(preferences.lineHeight),
              color: 'var(--reader-text)',
              WebkitUserSelect: 'text',
              userSelect: 'text',
            }}
            className="space-y-5 tracking-[-0.003em] select-text"
          >
            {extractedBlocks && extractedBlocks.length > 0 ? (
              extractedBlocks.map((block, idx) => {
                if (block.type === 'h2' || block.type === 'h3') {
                  return (
                    <h2
                      key={idx}
                      className="font-sans font-bold pt-4 text-[22px] tracking-tight leading-snug"
                      style={{ color: 'var(--reader-heading)' }}
                    >
                      {block.text}
                    </h2>
                  );
                }
                if (block.type === 'blockquote') {
                  return (
                    <blockquote
                      key={idx}
                      className="py-1 pl-4 my-5 border-l-2 italic"
                      style={{
                        borderColor: 'var(--reader-quote-border)',
                        color: 'var(--reader-quote-text)',
                      }}
                    >
                      {block.text}
                    </blockquote>
                  );
                }
                if (block.type === 'img' && block.src) {
                  if (!isAllowedPublisherMediaUrl(block.src, publisherOriginUrl, blockThirdPartyMedia)) {
                    return null;
                  }
                  const imgSrc =
                    resolveImageThroughPrivacyRelay(block.src, preferences.privacyRelayUrl) ||
                    block.src;
                  if (strictTextOnlyMode && !loadedImageUrls[imgSrc]) {
                    return (
                      <div
                        key={idx}
                        onClick={(e) => e.stopPropagation()}
                        className="my-5 p-4 rounded-2xl border flex items-center justify-between gap-3 font-sans"
                        style={{
                          backgroundColor: 'var(--reader-surface)',
                          borderColor: 'var(--reader-border)',
                        }}
                      >
                        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--reader-muted)' }}>
                          <ImageIcon className="w-4 h-4 text-[#FF6719] shrink-0" />
                          <span>Article image hidden in Tap-to-Load Mode</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerHapticSelection();
                            setLoadedImageUrls((prev) => ({ ...prev, [imgSrc]: true }));
                          }}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FF6719] text-white shrink-0"
                        >
                          Load Image
                        </button>
                      </div>
                    );
                  }
                  return (
                    <figure
                      key={idx}
                      className="my-6 overflow-hidden rounded-[2px]"
                      style={{ backgroundColor: 'var(--reader-surface)' }}
                    >
                      <div className="relative">
                        <img
                          src={imgSrc}
                          alt=""
                          referrerPolicy="no-referrer"
                          draggable={false}
                          className="w-full h-auto object-cover block"
                        />
                        {!preferences.distractionFree && (
                          <button
                            type="button"
                            onClick={(e) => handleSaveArticlePhoto(imgSrc, e)}
                            aria-label="Save photo to gallery"
                            title="Save photo to gallery"
                            className="absolute bottom-2.5 right-2.5 liquid-glass-dock px-2.5 py-1 rounded-full text-[10px] font-sans font-semibold text-white/95 flex items-center gap-1 border border-white/20 shadow-lg opacity-85 hover:opacity-100 active:scale-95 transition-all"
                          >
                            <Download className="w-3 h-3" />
                            <span>Save</span>
                          </button>
                        )}
                      </div>
                      {block.caption && (
                        <figcaption
                          className="pt-2 text-xs font-sans"
                          style={{ color: 'var(--reader-muted)' }}
                        >
                          {block.caption}
                        </figcaption>
                      )}
                    </figure>
                  );
                }
                return <p key={idx}>{block.text}</p>;
              })
            ) : article.contentHtml ? (
              <div
                className="article-prose max-w-none"
                dangerouslySetInnerHTML={{
                  __html: sanitizeArticleHtml(article.contentHtml, {
                    articleUrl: publisherOriginUrl,
                    blockThirdPartyMedia,
                    strictTextOnlyMode,
                  }),
                }}
              />
            ) : article.contentClean ? (
              <div className="space-y-5">
                {article.contentClean
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter((p) => Boolean(p) && !isJavaScriptWarningText(p))
                  .map((p, idx) => (
                    <p key={idx}>{p}</p>
                  ))}
              </div>
            ) : (
              <p>
                {isJavaScriptWarningText(article.summary || '') ? article.title : article.summary}
              </p>
            )}

            {(!extractedBlocks || extractedBlocks.length < 2) &&
              (article.contentClean || '').trim().length < 500 && (
                <div className="pt-2 space-y-5">
                  <p style={{ color: 'var(--reader-quote-text)' }}>
                    {`This report was published by ${article.feedTitle}${
                      rawAuthor ? ` (${rawAuthor})` : ''
                    }. Below are the key highlights and verified takeaways from this dispatch:`}
                  </p>
                  <div
                    className="p-4 rounded-2xl border space-y-2.5 font-sans text-[14px]"
                    style={{
                      backgroundColor: 'var(--reader-surface)',
                      borderColor: 'var(--reader-border)',
                    }}
                  >
                    <div className="text-xs font-bold uppercase tracking-wider text-[#FF6719]">
                      Key Story Highlights
                    </div>
                    <ul className="space-y-2" style={{ color: 'var(--reader-text)' }}>
                      {generateQuickTldrBullets(article).map((b, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#FF6719] shrink-0 mt-2" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

            {isLoadingExtraction && (
              <div
                className="pt-2 pb-1 flex items-center gap-2 text-[11px] font-sans"
                style={{ color: 'var(--reader-muted)' }}
              >
                <div className="w-2.5 h-2.5 border-2 border-[#FF6719] border-t-transparent rounded-full animate-spin shrink-0" />
                <span>Loading full story…</span>
              </div>
            )}
          </div>

          {/* Footer: Story Tags & Original Link */}
          {!preferences.distractionFree && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-14 pt-6 border-t flex flex-wrap items-center justify-between gap-4 text-xs font-sans"
              style={{
                borderColor: 'var(--reader-border)',
                color: 'var(--reader-muted)',
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                {articleTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border"
                    style={{
                      borderColor: 'var(--reader-border)',
                      backgroundColor: 'var(--reader-surface)',
                      color: 'var(--reader-heading)',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span>{tag.name}</span>
                  </span>
                ))}
                <button
                  onClick={() => {
                    triggerHapticSelection();
                    onOpenTagManager(article);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] transition-opacity hover:opacity-80"
                  style={{
                    borderColor: 'var(--reader-border)',
                    color: 'var(--reader-muted)',
                  }}
                >
                  <TagIcon className="w-3 h-3" />
                  <span>Tags</span>
                </button>
              </div>

              {cleanArticlePermalink && cleanArticlePermalink.startsWith('http') && (
                <a
                  href={cleanArticlePermalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-1 text-[11px] underline underline-offset-4 transition-opacity hover:opacity-80"
                  style={{ color: 'var(--reader-muted)' }}
                >
                  <span>View original</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </article>
      </main>

      {/* Floating Apple Liquid Glass Share Selected Line Pill */}
      {activeSelectionText && !showQuoteModal && !showTypographyMenu && (
        <div className="fixed bottom-[calc(max(env(safe-area-inset-bottom,0px),1rem)+3.75rem)] left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              triggerHapticComplete();
              setSelectedQuoteText(activeSelectionText);
              setShowQuoteModal(true);
              setActiveSelectionText('');
              window.getSelection()?.removeAllRanges();
            }}
            aria-label="Share selected line to story"
            className="liquid-glass-dock px-3.5 py-2 rounded-full flex items-center gap-2 text-xs font-semibold text-white border border-white/25 shadow-2xl active:scale-95 transition-transform max-w-[85vw]"
          >
            <Quote className="w-3.5 h-3.5 text-[#FF6719] shrink-0" />
            <span className="shrink-0">Share Line</span>
            <span className="text-[11px] font-normal text-stone-300 truncate max-w-[140px]">
              “{activeSelectionText}”
            </span>
          </button>
        </div>
      )}

      {/* Compact Apple Liquid Glass Floating Bottom Pill (Auto-hides on scroll down, tap screen to toggle) */}
      <footer
        className={`fixed bottom-[max(env(safe-area-inset-bottom,0px),1rem)] left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ${
          controlsVisible
            ? 'translate-y-0 opacity-100 pointer-events-auto'
            : 'translate-y-20 opacity-0 pointer-events-none'
        }`}
      >
        <div className="liquid-glass-dock px-2.5 py-1.5 rounded-full flex items-center gap-1 shadow-2xl border border-white/20">
          {/* Back to Feed */}
          <button
            onClick={() => {
              triggerHapticSelection();
              onBack();
            }}
            aria-label="Back to Feed"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-stone-200 hover:text-white hover:bg-white/10 transition-all active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="pr-0.5">Feed</span>
          </button>

          <div className="w-px h-4 bg-white/15 mx-0.5" />

          {/* Summary */}
          <button
            onClick={handleGenerateSummary}
            aria-label="Editorial Summary"
            title="Editorial Summary"
            className={`p-2 rounded-full transition-all active:scale-90 ${
              showSummary
                ? 'bg-white/20 text-[#FF6719]'
                : 'text-stone-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Sparkles
              className={`w-4 h-4 ${isLoadingSummary ? 'animate-spin text-[#FF6719]' : ''}`}
            />
          </button>

          {/* Typography & Privacy Settings (Aa) */}
          <button
            onClick={() => {
              triggerHapticSelection();
              setShowTypographyMenu(!showTypographyMenu);
            }}
            aria-label="Reader Appearance"
            className={`p-2 rounded-full transition-all active:scale-90 ${
              showTypographyMenu
                ? 'bg-white/20 text-white'
                : 'text-stone-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
          </button>

          {/* Bookmark */}
          <button
            onClick={() => {
              triggerHapticSelection();
              onToggleBookmark(article.id);
              showToast(article.isBookmarked ? 'Removed bookmark' : 'Saved to bookmarks');
            }}
            aria-label="Bookmark"
            className="p-2 rounded-full text-stone-300 hover:text-white hover:bg-white/10 transition-all active:scale-90"
          >
            <Bookmark
              className={`w-4 h-4 ${
                article.isBookmarked ? 'fill-[#FF6719] text-[#FF6719]' : ''
              }`}
            />
          </button>

          {/* Editorial Quote Card */}
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              triggerHapticSelection();
              const sel =
                activeSelectionText ||
                sanitizeTextSelection(window.getSelection()?.toString() || '');
              setSelectedQuoteText(sel);
              setShowQuoteModal(true);
              if (sel) {
                setActiveSelectionText('');
                window.getSelection()?.removeAllRanges();
              }
            }}
            aria-label="Create Quote Card"
            title="Pick or highlight any line to share"
            className="p-2 rounded-full text-stone-300 hover:text-white hover:bg-white/10 transition-all active:scale-90"
          >
            <Quote className="w-4 h-4" />
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share"
            className="p-2 rounded-full text-stone-300 hover:text-white hover:bg-white/10 transition-all active:scale-90"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {/* Previous / Next Story Navigation */}
          {(onPrevArticle || onNextArticle) && (
            <>
              <div className="w-px h-4 bg-white/15 mx-0.5" />
              {onPrevArticle && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    onPrevArticle();
                  }}
                  aria-label="Previous Story"
                  title="Previous Story"
                  className="p-2 rounded-full text-stone-300 hover:text-white hover:bg-white/10 transition-all active:scale-90"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              {onNextArticle && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    onNextArticle();
                  }}
                  aria-label="Next Story"
                  className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-full text-xs font-medium text-stone-200 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </footer>

      {/* Editorial Quote Card Share Modal */}
      <QuoteShareModal
        isOpen={showQuoteModal}
        onClose={() => setShowQuoteModal(false)}
        article={{
          ...article,
          title: extractedMeta.title || article.title,
          author: extractedMeta.author || article.author,
          imageUrl: safeLeadImageUrl,
        }}
        initialQuoteText={selectedQuoteText}
        articleText={fullReadableText}
        estimatedReadTimeMin={adaptiveEstimate.minutes}
      />
    </div>
  );
};
