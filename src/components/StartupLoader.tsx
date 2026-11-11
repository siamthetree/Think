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
/** Total visible time for the banner (ms) */
const BANNER_HOLD_MS = 3000;
/** Duration of the exit animation (must match CSS .splash-exit keyframe duration) */
const BANNER_EXIT_ANIM_MS = 540;
/** How long to wait for feeds before showing the app anyway */
const REFRESH_BUDGET_MS = 6000;
/** Max articles to prefetch full content for during startup */
const PREFETCH_LIMIT = 12;
/** Minimum re-open interval before we silently refresh in background */
const RESUME_DEBOUNCE_MS = 90_000; // 90 s

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
        if (item !== undefined) await job(item);
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
  const feeds          = loadFeedsFromStorage();
  const storedArticles = loadArticlesFromStorage();
  const incoming: FeedItem[] = [];
  const updatedFeeds  = [...feeds];

  await runPool(feeds, 8, async (feed) => {
    try {
      const data = await fetchFeedWithFallback({
        url:    feed.url,
        feedId: feed.id,
        title:  feed.title,
        tags:   feed.defaultTags || [],
      });
      incoming.push(
        ...data.items.map((item) => ({
          ...item,
          feedId:    feed.id,
          feedTitle: data.feedTitle || feed.title,
        }))
      );
      if (data.resolvedFeedUrl && data.resolvedFeedUrl !== feed.url) {
        const idx = updatedFeeds.findIndex((f) => f.id === feed.id);
        if (idx >= 0) updatedFeeds[idx] = { ...updatedFeeds[idx], url: data.resolvedFeedUrl };
      }
    } catch (err) {
      console.warn(`[ZenFeed] startup sync failed for ${feed.title}:`, err);
    }
  });

  let merged = incoming.length > 0 ? mergeItems(storedArticles, incoming) : storedArticles;

  // Prefetch full article bodies for the freshest items that only have teasers
  const candidates = merged
    .filter((a) => a.link.startsWith('http') && (!hasFullBody(a) || !a.imageUrl))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, PREFETCH_LIMIT);

  await runPool(candidates, 6, async (article) => {
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
    } catch {
      // skip — will be fetched lazily when user opens the article
    }
  });

  saveFeedsToStorage(updatedFeeds);
  saveArticlesToStorage(merged);
}

// ─── SplashScreen component ──────────────────────────────────────────────────
interface SplashProps {
  /** 0–100 progress for the bottom loader bar */
  progress: number;
  /** 'enter' | 'hold' | 'exit' | 'gone' */
  phase: 'enter' | 'hold' | 'exit' | 'gone';
}

const SplashScreen: React.FC<SplashProps> = ({ progress, phase }) => {
  if (phase === 'gone') return null;

  return (
    <div
      className={`splash-root ${phase === 'exit' ? 'splash-exit' : 'splash-enter'}`}
      aria-hidden="true"
    >
      {/* Ambient background glow */}
      <div className="splash-glow" aria-hidden="true" />

      {/* Central Statement */}
      <div className="relative z-10 px-6 max-w-lg text-center flex flex-col items-center justify-center">
        <h1
          className="splash-bengali-title font-serif"
          style={{ fontFamily: "'Noto Serif Bengali', 'Lora', Georgia, serif" }}
        >
          চলুন চিন্তা করি শেয়ারে
        </h1>
      </div>

      {/* Bottom progress pill */}
      <div className="splash-loader-wrap">
        <div className="splash-progress-track">
          <div
            className="splash-progress-fill"
            style={{ width: `${progress}%` }}
          />
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
  const [splashPhase,    setSplashPhase]    = useState<SplashPhase>('enter');
  const [progress,       setProgress]       = useState(0);
  const [contentVersion, setContentVersion] = useState(0);

  const mountedRef        = useRef(true);
  const hasRunSplashRef   = useRef(false);
  const lastResumeRef     = useRef(0);
  const refreshRunningRef = useRef(false);

  /**
   * Full startup sequence:
   *   1. Begin banner (enter animation already playing via CSS)
   *   2. Kick off background refresh immediately
   *   3. Animate progress bar along a natural curve
   *   4. After BANNER_HOLD_MS, play exit animation
   *   5. After exit animation completes, remove banner from DOM
   */
  const runStartup = useCallback(async (showBanner: boolean) => {
    if (refreshRunningRef.current) return;
    refreshRunningRef.current = true;

    if (showBanner) {
      setSplashPhase('enter');
      setProgress(0);
    }

    // Kick off network refresh in parallel — no awaiting here
    let refreshDone = false;
    const refreshTask = refreshStartupContent()
      .catch((err) => console.warn('[ZenFeed] startup refresh error:', err))
      .finally(() => {
        refreshDone = true;
        if (mountedRef.current) setContentVersion((v) => v + 1);
        refreshRunningRef.current = false;
      });

    if (!showBanner) {
      // Background re-open — just refresh silently
      await Promise.race([refreshTask, wait(REFRESH_BUDGET_MS)]);
      return;
    }

    // ── Animate progress bar across the banner hold duration ──
    // Curve: fast start, slow in middle (like iOS progress indicators)
    // 0ms→400ms: 0→55%  |  400ms→1500ms: 55→80%  |  1500ms→2800ms: 80→97%
    const progressTimers: ReturnType<typeof setTimeout>[] = [];
    const scheduleProgress = (pct: number, delay: number) =>
      progressTimers.push(setTimeout(() => { if (mountedRef.current) setProgress(pct); }, delay));

    scheduleProgress(55, 320);
    scheduleProgress(72, 800);
    scheduleProgress(85, 1400);
    scheduleProgress(93, 2200);
    scheduleProgress(100, BANNER_HOLD_MS - 100);

    // Hold the banner for 3 seconds (regardless of network speed)
    await wait(BANNER_HOLD_MS);

    // Trigger exit animation
    if (mountedRef.current) setSplashPhase('exit');

    // Wait for exit animation to finish before removing from DOM
    await wait(BANNER_EXIT_ANIM_MS);

    if (mountedRef.current) {
      setSplashPhase('gone');
      // Clear timers defensively
      progressTimers.forEach(clearTimeout);
    }

    // Don't block the UI — let refresh finish in background
    await Promise.race([refreshTask, wait(REFRESH_BUDGET_MS)]);
  }, []);

  // ── Initial mount ──
  useEffect(() => {
    mountedRef.current = true;
    lastResumeRef.current = Date.now();

    const isFirstLoad = !hasRunSplashRef.current;
    hasRunSplashRef.current = true;

    void runStartup(isFirstLoad);

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
      {/* App content — always mounted, animates in as splash exits */}
      <div
        className={splashPhase === 'gone' ? 'app-shell-ready h-full' : 'h-full'}
        style={{ visibility: splashPhase === 'enter' ? 'hidden' : 'visible' }}
      >
        {React.cloneElement(children, { key: contentVersion })}
      </div>

      {/* Splash banner — rendered on top */}
      <SplashScreen phase={splashPhase} progress={progress} />
    </div>
  );
};
