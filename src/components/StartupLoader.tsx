import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { FeedItem } from '../types';
import {
  fetchFeedWithFallback,
  extractArticleWithFallback,
} from '../utils/apiClient';
import {
  hasFullBody,
  loadArticlesFromStorage,
  loadFeedsFromStorage,
  saveArticlesToStorage,
  saveFeedsToStorage,
} from '../utils/storage';
import { blocksToHtml } from '../utils/sanitize';

// ─── Constants ──────────────────────────────────────────────
/**
 * Pre-segmented Bengali grapheme clusters for Line 1 & Line 2 of:
 * "চলুন দেশটা ঘুরি শেয়ারে, চিন্তা করি একসাথে।"
 * Pre-segmenting guarantees vowel signs (ু, ে, া, ি) and conjuncts (ন্তা) never split mid-character.
 */
const HEADLINE_LINE1_GRAPHEMES = [
  'চ', 'লু', 'ন', ' ',
  'দে', 'শ', 'টা', ' ',
  'ঘু', 'রি', ' ',
  'শে', 'য়া', 'রে', ',',
] as const;

const HEADLINE_LINE2_GRAPHEMES = [
  'চি', 'ন্তা', ' ',
  'ক', 'রি', ' ',
  'এ', 'ক', 'সা', 'থে', '।',
] as const;

const TOTAL_HEADLINE_GRAPHEMES =
  HEADLINE_LINE1_GRAPHEMES.length + HEADLINE_LINE2_GRAPHEMES.length;

/** Grapheme clusters for "চিন্তা-Think" below the main statement */
const SUBTITLE_GRAPHEMES = ['চি', 'ন্তা', '-', 'T', 'h', 'i', 'n', 'k'] as const;

/** Brief initial settle before typing starts (ms) */
const INITIAL_START_DELAY_MS = 60;
/** Fast typing speed for the main Bengali headline (ms per grapheme) */
const HEADLINE_STEP_MS = 24;
/** Crisp, smooth typing speed for "চিন্তা-Think" — slightly slower than headline but never sluggish */
const SUBTITLE_STEP_MS = 55;
/** Tiny frame hold once "চিন্তা-Think" is fully shown before opening the feed (ms) */
const POST_TYPING_PAUSE_MS = 80;
/** Duration of the exit animation (must match CSS .splash-exit keyframe duration) */
const BANNER_EXIT_ANIM_MS = 240;
/** Max articles to prefetch full content for in background */
const PREFETCH_LIMIT = 4;
/** Minimum re-open interval before we silently refresh in background */
const RESUME_DEBOUNCE_MS = 90_000; // 90 s
/** Session key to prevent splash loop if iOS WKWebView ever reloads */
const SPLASH_SESSION_KEY = 'chinta_splash_completed_v2';

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hasSplashAlreadyRunInSession(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markSplashRunInSession(): void {
  try {
    sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
  } catch {
    // ignore storage errors in private mode
  }
}

/**
 * Drives a step counter from 1..totalSteps using performance.now() + setTimeout(16)
 * so it works reliably even when iOS throttles requestAnimationFrame during launch.
 */
function runSmoothTypewriter(
  totalSteps: number,
  stepMs: number,
  isMounted: () => boolean,
  onStep: (count: number) => void
): Promise<void> {
  return new Promise((resolve) => {
    if (totalSteps <= 0 || !isMounted()) {
      resolve();
      return;
    }
    const startTime = performance.now();
    let lastCount = 0;

    const tick = () => {
      if (!isMounted()) {
        resolve();
        return;
      }
      const elapsed = performance.now() - startTime;
      const nextCount = Math.min(totalSteps, Math.floor(elapsed / stepMs) + 1);
      if (nextCount !== lastCount) {
        lastCount = nextCount;
        onStep(nextCount);
      }
      if (nextCount >= totalSteps) {
        resolve();
        return;
      }
      setTimeout(tick, 16);
    };

    tick();
  });
}

function notifyStorageUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('chinta:storage-updated'));
  }
}

async function runPool<T>(
  items: T[],
  limit: number,
  job: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) {
          await job(item);
          // Yield briefly between tasks so iOS WebView memory and UI stay responsive
          await wait(40);
        }
      }
    })
  );
}

function mergeItems(previous: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const byId   = new Map(incoming.map((i) => [i.id,   i]));
  const byLink = new Map(incoming.map((i) => [i.link, i]));
  const seen   = new Set<string>();

  const refreshed = previous.map((article) => {
    const latest = byId.get(article.id) || byLink.get(article.link);
    if (!latest) return article;
    seen.add(latest.id);
    return {
      ...latest,
      isRead:          article.isRead,
      isBookmarked:    article.isBookmarked,
      isOfflineCached: article.isOfflineCached || latest.isOfflineCached,
      contentHtml:     hasFullBody(article) && !hasFullBody(latest) ? article.contentHtml : latest.contentHtml,
      contentClean:    hasFullBody(article) && !hasFullBody(latest) ? article.contentClean : latest.contentClean,
      cachedAt:        article.cachedAt,
      tags:            article.tags.length > 0 ? article.tags : latest.tags,
    };
  });

  const additions = incoming.filter(
    (i) => !seen.has(i.id) && !previous.some((a) => a.link === i.link)
  );
  return [...additions, ...refreshed].sort((a, b) => b.timestamp - a.timestamp);
}

async function refreshStartupContent(): Promise<void> {
  const feeds        = loadFeedsFromStorage();
  let merged         = loadArticlesFromStorage();
  const updatedFeeds = [...feeds];

  // Use gentle concurrency (2 at a time) so iPhone WKWebView never spikes memory
  await runPool(feeds, 2, async (feed) => {
    try {
      const data = await fetchFeedWithFallback({
        url:    feed.url,
        feedId: feed.id,
        title:  feed.title,
        tags:   feed.defaultTags || [],
      });
      const feedItems = data.items.map((item) => ({
        ...item,
        feedId:    feed.id,
        feedTitle: data.feedTitle || feed.title,
      }));
      if (data.resolvedFeedUrl && data.resolvedFeedUrl !== feed.url) {
        const idx = updatedFeeds.findIndex((f) => f.id === feed.id);
        if (idx >= 0) updatedFeeds[idx] = { ...updatedFeeds[idx], url: data.resolvedFeedUrl };
        saveFeedsToStorage(updatedFeeds);
      }
      if (feedItems.length > 0) {
        merged = mergeItems(merged, feedItems);
        saveArticlesToStorage(merged);
        notifyStorageUpdated();
      }
    } catch (err) {
      console.warn(`[ZenFeed] startup sync failed for ${feed.title}:`, err);
    }
  });

  // Prefetch full article bodies gently (1 at a time) for top stories
  const candidates = merged
    .filter((a) => a.link.startsWith('http') && (!hasFullBody(a) || !a.imageUrl))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, PREFETCH_LIMIT);

  await runPool(candidates, 1, async (article) => {
    try {
      const extracted = await extractArticleWithFallback(article.link);
      if (!extracted.success || !extracted.blocks?.length) return;
      const contentClean = extracted.blocks.map((b) => b.text || '').filter(Boolean).join('\n\n');
      const contentHtml  = blocksToHtml(extracted.blocks);
      merged = merged.map((a) =>
        a.id !== article.id ? a : {
          ...a,
          contentClean:    contentClean.length > (a.contentClean?.length ?? 0) ? contentClean : a.contentClean,
          contentHtml:     contentHtml.length  > (a.contentHtml?.length  ?? 0) ? contentHtml  : a.contentHtml,
          imageUrl:        a.imageUrl || extracted.leadImage,
          author:          a.author   || extracted.author,
          readTimeMin:     extracted.readTimeMin || a.readTimeMin,
          isOfflineCached: contentClean.length >= 800 || a.isOfflineCached,
          cachedAt:        contentClean.length >= 800 ? Date.now() : a.cachedAt,
        }
      );
      saveArticlesToStorage(merged);
      notifyStorageUpdated();
    } catch {
      // skip — will be fetched lazily when user opens the article
    }
  });

  saveFeedsToStorage(updatedFeeds);
  saveArticlesToStorage(merged);
  notifyStorageUpdated();
}

// ─── SplashScreen component ──────────────────────────────────────────────────
interface SplashProps {
  /** Number of graphemes typed in the main Bengali statement */
  headlineCount: number;
  /** Number of graphemes typed in "চিন্তা-Think" */
  subtitleCount: number;
  /** 'enter' | 'hold' | 'exit' | 'gone' */
  phase: 'enter' | 'hold' | 'exit' | 'gone';
}

const SplashScreen: React.FC<SplashProps> = ({
  headlineCount,
  subtitleCount,
  phase,
}) => {
  if (phase === 'gone') return null;

  const line1Len = HEADLINE_LINE1_GRAPHEMES.length;
  const line1Count = Math.min(headlineCount, line1Len);
  const line2Count = Math.max(0, headlineCount - line1Len);

  const line1Text = HEADLINE_LINE1_GRAPHEMES.slice(0, line1Count).join('');
  const line2Text = HEADLINE_LINE2_GRAPHEMES.slice(0, line2Count).join('');
  const subtitleText = SUBTITLE_GRAPHEMES.slice(0, subtitleCount).join('');

  const isTypingHeadline = headlineCount < TOTAL_HEADLINE_GRAPHEMES && subtitleCount === 0;
  const isCursorOnLine1 = isTypingHeadline && headlineCount <= line1Len;
  const isCursorOnLine2 = isTypingHeadline && headlineCount > line1Len;
  const isCursorOnSubtitle = !isTypingHeadline;

  return (
    <div
      className={`splash-root ${phase === 'exit' ? 'splash-exit' : 'splash-enter'}`}
      aria-hidden="true"
    >
      {/* Ambient background glow */}
      <div className="splash-glow" aria-hidden="true" />

      {/* Central Statement + Typewriter Signature Below */}
      <div className="relative z-10 px-6 max-w-lg text-center flex flex-col items-center justify-center">
        <h1
          className="splash-bengali-title font-serif"
          style={{ fontFamily: "'Noto Serif Bengali', 'Lora', Georgia, serif" }}
        >
          <span className="splash-bengali-line">
            <span>{line1Text}</span>
            {isCursorOnLine1 && (
              <span className="splash-typewriter-cursor" aria-hidden="true" />
            )}
          </span>
          <span className="splash-bengali-line">
            <span>{line2Text}</span>
            {isCursorOnLine2 && (
              <span className="splash-typewriter-cursor" aria-hidden="true" />
            )}
          </span>
        </h1>

        <div
          className="splash-typewriter font-serif"
          style={{ fontFamily: "'Noto Serif Bengali', 'Lora', Georgia, serif" }}
        >
          <span>{subtitleText}</span>
          {isCursorOnSubtitle && (
            <span className="splash-typewriter-cursor" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── StartupLoader ───────────────────────────────────────────────────────────
interface StartupLoaderProps {
  children: React.ReactElement;
}

type SplashPhase = 'enter' | 'hold' | 'exit' | 'gone';

export const StartupLoader: React.FC<StartupLoaderProps> = ({ children }) => {
  const alreadyShown = hasSplashAlreadyRunInSession();
  const [splashPhase,   setSplashPhase]   = useState<SplashPhase>(alreadyShown ? 'gone' : 'enter');
  const [headlineCount, setHeadlineCount] = useState(alreadyShown ? TOTAL_HEADLINE_GRAPHEMES : 0);
  const [subtitleCount, setSubtitleCount] = useState(alreadyShown ? SUBTITLE_GRAPHEMES.length : 0);

  const mountedRef        = useRef(true);
  const hasRunSplashRef   = useRef(alreadyShown);
  const lastResumeRef     = useRef(0);
  const refreshRunningRef = useRef(false);

  const triggerBackgroundRefresh = useCallback(() => {
    if (refreshRunningRef.current) return;
    refreshRunningRef.current = true;
    void refreshStartupContent()
      .catch((err) => console.warn('[ZenFeed] startup refresh error:', err))
      .finally(() => {
        refreshRunningRef.current = false;
      });
  }, []);

  /**
   * Full startup sequence:
   *   1. Mark session splash started so it can never loop on iPhone WebView reloads
   *   2. Fast typewriter for "চলুন দেশটা ঘুরি শেয়ারে, চিন্তা করি একসাথে।" (24ms/grapheme)
   *   3. Immediately upon completion, crisp typewriter for "চিন্তা-Think" (55ms/grapheme)
   *   4. The instant "চিন্তা-Think" arrives on screen fully, exit banner and open feed
   *   5. Run background news fetching without blocking or crashing the WebView
   */
  const runStartup = useCallback(async (showBanner: boolean) => {
    if (!showBanner) {
      triggerBackgroundRefresh();
      return;
    }

    // Mark immediately so even if iOS WKWebView reloads, it won't loop the banner
    markSplashRunInSession();

    setSplashPhase('enter');
    setHeadlineCount(0);
    setSubtitleCount(0);

    // Start background feed fetch after a short delay so 100% of CPU is free for silky typing
    const bgTimer = setTimeout(() => {
      if (mountedRef.current) triggerBackgroundRefresh();
    }, 500);

    // Hard safety timer: guarantee the app opens within 1.85s even if timers are throttled
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current) {
        setHeadlineCount(TOTAL_HEADLINE_GRAPHEMES);
        setSubtitleCount(SUBTITLE_GRAPHEMES.length);
        setSplashPhase('gone');
      }
    }, 1850);

    try {
      await wait(INITIAL_START_DELAY_MS);

      // Stage 1: Fast typewriter for "চলুন দেশটা ঘুরি শেয়ারে, চিন্তা করি একসাথে।"
      await runSmoothTypewriter(
        TOTAL_HEADLINE_GRAPHEMES,
        HEADLINE_STEP_MS,
        () => mountedRef.current,
        (count) => setHeadlineCount(count)
      );

      if (!mountedRef.current) return;

      // Stage 2: Immediately type "চিন্তা-Think" below
      await runSmoothTypewriter(
        SUBTITLE_GRAPHEMES.length,
        SUBTITLE_STEP_MS,
        () => mountedRef.current,
        (count) => setSubtitleCount(count)
      );

      if (!mountedRef.current) return;

      // Open the app as soon as "চিন্তা-Think" arrives on screen fully
      await wait(POST_TYPING_PAUSE_MS);

      if (mountedRef.current) setSplashPhase('exit');

      await wait(BANNER_EXIT_ANIM_MS);

      if (mountedRef.current) {
        setSplashPhase('gone');
      }
    } finally {
      clearTimeout(safetyTimer);
      // Ensure background refresh is running
      triggerBackgroundRefresh();
      void bgTimer;
    }
  }, [triggerBackgroundRefresh]);

  // ── Initial mount ──
  useEffect(() => {
    mountedRef.current = true;
    lastResumeRef.current = Date.now();

    const shouldShowBanner = !hasRunSplashRef.current;
    hasRunSplashRef.current = true;

    void runStartup(shouldShowBanner);

    // ── App resume handlers (silent background refresh) ──
    const handleResume = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastResumeRef.current < RESUME_DEBOUNCE_MS) return;
      lastResumeRef.current = now;
      void runStartup(false);
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('pageshow', handleResume);
    window.addEventListener('focus',    handleResume);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('focus',    handleResume);
    };
  }, [runStartup]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* App content — always mounted and rendered underneath so transition is instant */}
      <div className={splashPhase === 'gone' ? 'app-shell-ready h-full' : 'h-full'}>
        {children}
      </div>

      {/* Splash banner — rendered on top */}
      <SplashScreen
        phase={splashPhase}
        headlineCount={headlineCount}
        subtitleCount={subtitleCount}
      />
    </div>
  );
};
