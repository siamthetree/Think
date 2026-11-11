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
/** Grapheme clusters for "চিন্তা-Think" so Bengali conjuncts/vowel marks never split mid-character */
const TYPEWRITER_GRAPHEMES = ['চি', 'ন্তা', '-', 'T', 'h', 'i', 'n', 'k'] as const;
/** Delay before typewriter starts (after main statement entrance begins) */
const TYPEWRITER_START_DELAY_MS = 480;
/** Per-character typing interval (ms) */
const TYPEWRITER_STEP_MS = 135;
/** Brief pause after the final character is shown before exiting to the feed */
const POST_TYPING_PAUSE_MS = 260;
/** Duration of the exit animation (must match CSS .splash-exit keyframe duration) */
const BANNER_EXIT_ANIM_MS = 540;
/** Max articles to prefetch full content for during startup */
const PREFETCH_LIMIT = 12;
/** Minimum re-open interval before we silently refresh in background */
const RESUME_DEBOUNCE_MS = 90_000; // 90 s

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  let merged           = loadArticlesFromStorage();
  const updatedFeeds   = [...feeds];

  await runPool(feeds, 8, async (feed) => {
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

  // Prefetch full article bodies in the background for the freshest items that only have teasers
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
  /** Currently typed substring of "চিন্তা-Think" */
  typedText: string;
  /** 'enter' | 'hold' | 'exit' | 'gone' */
  phase: 'enter' | 'hold' | 'exit' | 'gone';
}

const SplashScreen: React.FC<SplashProps> = ({ typedText, phase }) => {
  if (phase === 'gone') return null;

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
          চলুন দেশটা ঘুরি শেয়ারে, চিন্তা করি একসাথে।
        </h1>

        <div
          className="splash-typewriter font-serif"
          style={{ fontFamily: "'Noto Serif Bengali', 'Lora', Georgia, serif" }}
        >
          <span>{typedText}</span>
          <span className="splash-typewriter-cursor" aria-hidden="true" />
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
  const [splashPhase, setSplashPhase] = useState<SplashPhase>('enter');
  const [typedCount,  setTypedCount]  = useState(0);

  const mountedRef        = useRef(true);
  const hasRunSplashRef   = useRef(false);
  const lastResumeRef     = useRef(0);
  const refreshRunningRef = useRef(false);

  /**
   * Full startup sequence:
   *   1. Begin banner (enter animation playing via CSS)
   *   2. Kick off background news fetching immediately (streaming updates to feed)
   *   3. Type "চিন্তা-Think" character-by-character below the main statement
   *   4. As soon as the full "চিন্তা-Think" text is shown, trigger exit animation and show feed
   *   5. Meanwhile background fetching continues seamlessly
   */
  const runStartup = useCallback(async (showBanner: boolean) => {
    // Always kick off background news fetching if not already running
    if (!refreshRunningRef.current) {
      refreshRunningRef.current = true;
      void refreshStartupContent()
        .catch((err) => console.warn('[ZenFeed] startup refresh error:', err))
        .finally(() => {
          refreshRunningRef.current = false;
        });
    }

    if (!showBanner) {
      return;
    }

    setSplashPhase('enter');
    setTypedCount(0);

    // Let the main Bengali statement animate in first
    await wait(TYPEWRITER_START_DELAY_MS);

    // Type "চিন্তা-Think" grapheme by grapheme
    for (let i = 1; i <= TYPEWRITER_GRAPHEMES.length; i++) {
      if (!mountedRef.current) return;
      setTypedCount(i);
      await wait(TYPEWRITER_STEP_MS);
    }

    // Brief hold so the completed "চিন্তা-Think" text registers clearly
    await wait(POST_TYPING_PAUSE_MS);

    // Trigger exit animation to reveal the feed immediately while news keeps fetching
    if (mountedRef.current) setSplashPhase('exit');

    await wait(BANNER_EXIT_ANIM_MS);

    if (mountedRef.current) {
      setSplashPhase('gone');
    }
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

  const typedText = TYPEWRITER_GRAPHEMES.slice(0, typedCount).join('');

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* App content — always mounted, animates in as splash exits */}
      <div
        className={splashPhase === 'gone' ? 'app-shell-ready h-full' : 'h-full'}
        style={{ visibility: splashPhase === 'enter' ? 'hidden' : 'visible' }}
      >
        {children}
      </div>

      {/* Splash banner — rendered on top */}
      <SplashScreen phase={splashPhase} typedText={typedText} />
    </div>
  );
};
