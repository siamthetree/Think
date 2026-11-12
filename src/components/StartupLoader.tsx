import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Feed, FeedItem } from '../types';
import { fetchFeedWithFallback } from '../utils/apiClient';
import { loadFeedsFromStorage } from '../utils/storage';

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
/**
 * Two-stage typewriter + 2-second reading hold:
 * - Main statement (26 graphemes × 48ms = ~1,248ms)
 * - "চিন্তা-Think" (8 graphemes × 75ms = ~600ms)
 * - Hold after all text is shown = 2,000ms (2 full seconds so user can read what is written)
 * Meanwhile, the first priority news sources load in parallel during this ~3.85s window.
 */
const HEADLINE_STEP_MS = 48;
const SUBTITLE_STEP_MS = 75;
/** Hold the banner for 2 full seconds after all text is typed so the user can read it */
const BANNER_HOLD_AFTER_TEXT_MS = 2000;
/** Duration of the exit animation (must match CSS .splash-exit keyframe duration) */
const BANNER_EXIT_ANIM_MS = 220;
/** Calm settle window after the home page opens before background feeds resume fetching */
const POST_OPEN_CALM_WINDOW_MS = 2500;
/** Pause between individual background feed fetches so the main thread stays completely smooth */
const BACKGROUND_FEED_STEP_DELAY_MS = 800;
/** Minimum re-open interval before we silently refresh in background */
const RESUME_DEBOUNCE_MS = 120_000; // 120 s
/**
 * Persistent localStorage timestamp guard:
 * On iOS WKWebView, if a process reload ever occurs within 12 seconds,
 * localStorage survives (unlike sessionStorage) and prevents the banner from ever looping.
 */
const SPLASH_GUARD_STORAGE_KEY = 'chinta_last_splash_timestamp_v3';
const SPLASH_RELOAD_LOOP_WINDOW_MS = 12_000;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldSkipSplashFromReloadLoop(): boolean {
  try {
    if (typeof window !== 'undefined' && window.location.search.includes('autostart=1')) {
      return true;
    }
    const raw = localStorage.getItem(SPLASH_GUARD_STORAGE_KEY);
    if (!raw) return false;
    const lastTs = Number(raw);
    if (!Number.isFinite(lastTs)) return false;
    return Date.now() - lastTs < SPLASH_RELOAD_LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function recordSplashStartedTimestamp(): void {
  try {
    localStorage.setItem(SPLASH_GUARD_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }
}

/**
 * Drives a step counter from 1..totalSteps using performance.now() + setTimeout(16)
 * so it never stutters or drops steps on iOS.
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

function dispatchIncomingArticles(
  items: FeedItem[],
  resolvedFeeds: Array<{ id: string; url: string }>
): void {
  if (typeof window === 'undefined') return;
  if (items.length === 0 && resolvedFeeds.length === 0) return;
  window.dispatchEvent(
    new CustomEvent('chinta:incoming-articles', {
      detail: { items, resolvedFeeds },
    })
  );
}

async function fetchSingleFeedItems(feed: Feed): Promise<{
  items: FeedItem[];
  resolvedFeed?: { id: string; url: string };
}> {
  const data = await fetchFeedWithFallback({
    url:    feed.url,
    feedId: feed.id,
    title:  feed.title,
    tags:   feed.defaultTags || [],
  });
  const items = data.items.map((item) => ({
    ...item,
    feedId:    feed.id,
    feedTitle: data.feedTitle || feed.title,
  }));
  const resolvedFeed =
    data.resolvedFeedUrl && data.resolvedFeedUrl !== feed.url
      ? { id: feed.id, url: data.resolvedFeedUrl }
      : undefined;
  return { items, resolvedFeed };
}

/**
 * Two-phase memory-safe news loader:
 * - Phase 1 (During Banner): Fetches the first 3 fast XML/RSS feeds in parallel while the banner is
 *   typing and holding for 2 seconds. Buffers the articles in memory and flushes them in a SINGLE
 *   in-memory event right before the banner exits so the home page opens with loaded news and zero re-render storm.
 * - Phase 2 (Background): Waits 2.5 seconds after the home page opens so iOS WebKit finishes compositing,
 *   then fetches remaining sources gently one-by-one (800ms apart).
 */
function startPhasedStartupSync(waitForBannerOpenPromise?: Promise<void>): {
  flushPriorityBatch: () => void;
  fullSyncDone: Promise<void>;
} {
  const feeds = loadFeedsFromStorage();

  // Prioritize fast XML/RSS feeds first so initial stories load within 1–2 seconds during the banner
  const sortedFeeds = [...feeds].sort((a, b) => {
    const aFast = /(\.xml|\/feed|\/rss)/i.test(a.url) ? 0 : 1;
    const bFast = /(\.xml|\/feed|\/rss)/i.test(b.url) ? 0 : 1;
    return aFast - bFast;
  });

  const priorityFeeds = sortedFeeds.slice(0, 3);
  const backgroundFeeds = sortedFeeds.slice(3);

  let bufferedItems: FeedItem[] = [];
  let bufferedResolved: Array<{ id: string; url: string }> = [];
  let priorityFlushed = !waitForBannerOpenPromise;

  const flushPriorityBatch = () => {
    priorityFlushed = true;
    if (bufferedItems.length > 0 || bufferedResolved.length > 0) {
      const itemsToSend = bufferedItems;
      const resolvedToSend = bufferedResolved;
      bufferedItems = [];
      bufferedResolved = [];
      dispatchIncomingArticles(itemsToSend, resolvedToSend);
    }
  };

  const fullSyncDone = (async () => {
    // Phase 1: Fetch priority feeds in parallel while the banner is displayed
    await Promise.allSettled(
      priorityFeeds.map(async (feed) => {
        try {
          const { items, resolvedFeed } = await fetchSingleFeedItems(feed);
          if (priorityFlushed) {
            // If this priority feed finished after the banner already opened, dispatch gently
            dispatchIncomingArticles(items, resolvedFeed ? [resolvedFeed] : []);
          } else {
            if (items.length > 0) bufferedItems.push(...items);
            if (resolvedFeed) bufferedResolved.push(resolvedFeed);
          }
        } catch (err) {
          console.warn(`[Chinta] priority startup sync failed for ${feed.title}:`, err);
        }
      })
    );

    // Ensure any remaining buffered priority items are flushed
    flushPriorityBatch();

    // Wait until the startup banner has completely exited and the home screen has settled
    if (waitForBannerOpenPromise) {
      await waitForBannerOpenPromise;
    }
    await wait(POST_OPEN_CALM_WINDOW_MS);

    // Phase 2: Fetch remaining feeds sequentially one-by-one in the background
    for (const feed of backgroundFeeds) {
      try {
        const { items, resolvedFeed } = await fetchSingleFeedItems(feed);
        if (items.length > 0 || resolvedFeed) {
          dispatchIncomingArticles(items, resolvedFeed ? [resolvedFeed] : []);
        }
      } catch (err) {
        console.warn(`[Chinta] background sync failed for ${feed.title}:`, err);
      }
      await wait(BACKGROUND_FEED_STEP_DELAY_MS);
    }
  })();

  return { flushPriorityBatch, fullSyncDone };
}

// ─── SplashScreen component ──────────────────────────────────────────────────
interface SplashProps {
  /** Number of graphemes typed in the main Bengali statement */
  headlineCount: number;
  /** Number of graphemes typed in "চিন্তা-Think" */
  subtitleCount: number;
  /** 'enter' | 'hold' | 'exit' | 'gone' */
  phase: 'enter' | 'hold' | 'exit' | 'gone';
  /** Allow instant tap-anywhere dismiss */
  onDismiss: () => void;
}

const SplashScreen: React.FC<SplashProps> = ({
  headlineCount,
  subtitleCount,
  phase,
  onDismiss,
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
      onClick={onDismiss}
      className={`splash-root cursor-pointer ${phase === 'exit' ? 'splash-exit' : 'splash-enter'}`}
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
  const skipSplash = shouldSkipSplashFromReloadLoop();
  const [splashPhase,   setSplashPhase]   = useState<SplashPhase>(skipSplash ? 'gone' : 'enter');
  const [headlineCount, setHeadlineCount] = useState(skipSplash ? TOTAL_HEADLINE_GRAPHEMES : 0);
  const [subtitleCount, setSubtitleCount] = useState(skipSplash ? SUBTITLE_GRAPHEMES.length : 0);

  const mountedRef        = useRef(true);
  const hasRunSplashRef   = useRef(skipSplash);
  const lastResumeRef     = useRef(0);
  const refreshRunningRef = useRef(false);
  const dismissSplashRef  = useRef<(() => void) | null>(null);

  const startSyncIfIdle = useCallback((waitForBannerOpenPromise?: Promise<void>) => {
    if (refreshRunningRef.current) return null;
    refreshRunningRef.current = true;
    const sync = startPhasedStartupSync(waitForBannerOpenPromise);
    void sync.fullSyncDone
      .catch((err) => console.warn('[Chinta] startup sync error:', err))
      .finally(() => {
        refreshRunningRef.current = false;
      });
    return sync;
  }, []);

  /**
   * Startup sequence:
   *   1. Immediately kick off Phase 1 priority news fetch in parallel with the banner
   *   2. Type "চলুন দেশটা ঘুরি শেয়ারে, চিন্তা করি একসাথে।" smoothly
   *   3. Immediately type "চিন্তা-Think" below it
   *   4. Hold or dismiss cleanly by 2.4s (or immediately on tap)
   */
  const runInitialBannerAndSync = useCallback(async () => {
    recordSplashStartedTimestamp();

    let notifyBannerOpened!: () => void;
    const bannerOpenedPromise = new Promise<void>((resolve) => {
      notifyBannerOpened = resolve;
    });

    // Start loading the first few news sources immediately while the banner is showing
    const sync = startSyncIfIdle(bannerOpenedPromise);

    let finished = false;
    const finishSplashNow = () => {
      if (finished) return;
      finished = true;
      sync?.flushPriorityBatch();
      notifyBannerOpened();
      if (mountedRef.current) {
        setHeadlineCount(TOTAL_HEADLINE_GRAPHEMES);
        setSubtitleCount(SUBTITLE_GRAPHEMES.length);
        setSplashPhase('gone');
      }
    };

    dismissSplashRef.current = finishSplashNow;

    // Hard safety timer: guarantee the banner always exits by 2.4s even if a timer stalls
    const safetyTimer = setTimeout(finishSplashNow, 2400);

    try {
      await wait(INITIAL_START_DELAY_MS);
      if (finished || !mountedRef.current) return;

      // Stage 1: Faster typewriter for "চলুন দেশটা ঘুরি শেয়ারে, চিন্তা করি একসাথে।"
      await runSmoothTypewriter(
        TOTAL_HEADLINE_GRAPHEMES,
        HEADLINE_STEP_MS,
        () => mountedRef.current && !finished,
        (count) => {
          if (!finished) setHeadlineCount(count);
        }
      );

      if (finished || !mountedRef.current) return;

      // Stage 2: Immediately type "চিন্তা-Think"
      await runSmoothTypewriter(
        SUBTITLE_GRAPHEMES.length,
        SUBTITLE_STEP_MS,
        () => mountedRef.current && !finished,
        (count) => {
          if (!finished) setSubtitleCount(count);
        }
      );

      if (finished || !mountedRef.current) return;

      // Stage 3: Hold briefly before transitioning out (2.4s safety timer also caps total duration)
      setSplashPhase('hold');
      await wait(BANNER_HOLD_AFTER_TEXT_MS);

      if (finished || !mountedRef.current) return;

      // Flush the loaded first batch of news once right before the banner exits
      sync?.flushPriorityBatch();
      await wait(40);

      if (finished || !mountedRef.current) return;
      setSplashPhase('exit');

      await wait(BANNER_EXIT_ANIM_MS);
      finishSplashNow();
    } finally {
      clearTimeout(safetyTimer);
      notifyBannerOpened();
    }
  }, [startSyncIfIdle]);

  // ── Initial mount ──
  useEffect(() => {
    mountedRef.current = true;
    lastResumeRef.current = Date.now();

    if (!hasRunSplashRef.current) {
      hasRunSplashRef.current = true;
      void runInitialBannerAndSync();
    } else {
      startSyncIfIdle();
    }

    // ── App resume handlers (silent background refresh only — never touches splashPhase) ──
    const handleResume = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastResumeRef.current < RESUME_DEBOUNCE_MS) return;
      lastResumeRef.current = now;
      startSyncIfIdle();
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
  }, [runInitialBannerAndSync, startSyncIfIdle]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* App content — always mounted underneath so loaded articles are visible the instant splash exits */}
      <div className={splashPhase === 'gone' ? 'app-shell-ready h-full' : 'h-full'}>
        {children}
      </div>

      {/* Splash banner — rendered on top; tap anywhere to dismiss immediately */}
      <SplashScreen
        phase={splashPhase}
        headlineCount={headlineCount}
        subtitleCount={subtitleCount}
        onDismiss={() => {
          dismissSplashRef.current?.();
          setSplashPhase('gone');
        }}
      />
    </div>
  );
};

