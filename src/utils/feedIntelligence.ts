import type { FeedItem } from '../types';

export interface StoryCluster {
  id: string;
  primary: FeedItem;
  perspectives: FeedItem[]; // Additional coverage from other sources/articles
  topicKeywords: string[];
}

export interface DailyBriefingEdition {
  editionTitle: 'Morning Briefing' | 'Afternoon Briefing' | 'Evening Briefing' | 'Night Briefing';
  subtitle: string;
  stories: FeedItem[];
  totalReadMinutes: number;
}

export interface ReadingHabitState {
  dailyGoal: number;
  todayDate: string; // YYYY-MM-DD
  todayReadIds: string[];
  todayMinutes: number;
  streakDays: number;
  lastCompletedDate: string | null;
}

export interface ReadingProgressItem {
  articleId: string;
  title: string;
  feedTitle: string;
  progressPercent: number; // 1..94
  scrollTop: number;
  updatedAt: number;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'will', 'your',
  'about', 'into', 'after', 'over', 'under', 'between', 'what', 'when', 'where',
  'which', 'their', 'there', 'been', 'were', 'they', 'more', 'some', 'than',
  'news', 'report', 'says', 'amid', 'new', 'how', 'why', 'who', 'its', 'are',
  'was', 'has', 'had', 'not', 'but', 'you', 'all', 'can', 'her', 'his', 'our',
  'out', 'day', 'get', 'make', 'made', 'just', 'like', 'know', 'take', 'year',
  'এবং', 'থেকে', 'করে', 'জন্য', 'হয়েছে', 'বলে', 'সাথে', 'নিয়ে', 'মধ্যে', 'কিন্তু',
  'আরও', 'একটি', 'হবে', 'হয়', 'বা', 'না', 'ও', 'এই', 'তার', 'করা', 'পর', 'দুই',
]);

/**
 * Extracts normalized significant tokens (English & Bengali words >= 3 chars)
 */
export function extractSignificantTokens(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  return Array.from(new Set(cleaned));
}

/**
 * Computes token similarity between two headlines/summaries
 */
export function computeStorySimilarity(a: FeedItem, b: FeedItem): {
  score: number;
  sharedKeywords: string[];
} {
  const tokensA = extractSignificantTokens(`${a.title} ${a.summary?.slice(0, 120) || ''}`);
  const tokensB = extractSignificantTokens(`${b.title} ${b.summary?.slice(0, 120) || ''}`);
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { score: 0, sharedKeywords: [] };
  }

  const setB = new Set(tokensB);
  const shared = tokensA.filter((t) => setB.has(t));
  if (shared.length === 0) {
    return { score: 0, sharedKeywords: [] };
  }

  const minLen = Math.min(tokensA.length, tokensB.length);
  const overlapScore = shared.length / Math.max(1, minLen);
  return {
    score: overlapScore,
    sharedKeywords: shared.slice(0, 3),
  };
}

/**
 * Groups related articles into Developing Story Clusters while keeping chronological feed order.
 * Requires at least 2 shared significant tokens or >= 0.34 overlap score within a 36-hour window.
 */
export function clusterStoriesByTopic(articles: FeedItem[]): StoryCluster[] {
  const assigned = new Set<string>();
  const clusters: StoryCluster[] = [];
  const MAX_TIME_GAP_MS = 36 * 60 * 60 * 1000;

  for (let i = 0; i < articles.length; i++) {
    const primary = articles[i];
    if (assigned.has(primary.id)) continue;
    assigned.add(primary.id);

    const perspectives: FeedItem[] = [];
    const keywordSet = new Set<string>();

    for (let j = i + 1; j < articles.length; j++) {
      const candidate = articles[j];
      if (assigned.has(candidate.id)) continue;
      if (Math.abs(primary.timestamp - candidate.timestamp) > MAX_TIME_GAP_MS) continue;

      const { score, sharedKeywords } = computeStorySimilarity(primary, candidate);
      if (sharedKeywords.length >= 2 || score >= 0.34) {
        perspectives.push(candidate);
        assigned.add(candidate.id);
        sharedKeywords.forEach((k) => keywordSet.add(k));
        if (perspectives.length >= 4) break;
      }
    }

    clusters.push({
      id: `cluster_${primary.id}`,
      primary,
      perspectives,
      topicKeywords: Array.from(keywordSet).slice(0, 3),
    });
  }

  return clusters;
}

/**
 * Builds a 5-story time-of-day Smart Edition Briefing with publisher diversity.
 */
export function buildDailyBriefing(
  articles: FeedItem[],
  nowMs: number = Date.now()
): DailyBriefingEdition {
  const hour = new Date(nowMs).getHours();
  let editionTitle: DailyBriefingEdition['editionTitle'] = 'Morning Briefing';
  let subtitle = 'Five essential stories to start your day with clarity';

  if (hour >= 12 && hour < 17) {
    editionTitle = 'Afternoon Briefing';
    subtitle = 'Midday developments and essential perspectives across sources';
  } else if (hour >= 17 && hour < 22) {
    editionTitle = 'Evening Briefing';
    subtitle = 'Today’s five defining stories, distilled for calm evening reading';
  } else if (hour >= 22 || hour < 5) {
    editionTitle = 'Night Briefing';
    subtitle = 'Late-hour wrap of the day’s most significant reporting';
  }

  // Prefer unread stories first, then newest, diversifying by publisher (feedId)
  const sorted = [...articles].sort((a, b) => {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return b.timestamp - a.timestamp;
  });

  const selected: FeedItem[] = [];
  const usedFeeds = new Set<string>();

  for (const item of sorted) {
    if (selected.length >= 5) break;
    if (!usedFeeds.has(item.feedId)) {
      selected.push(item);
      usedFeeds.add(item.feedId);
    }
  }

  // Fill remaining slots up to 5 if fewer than 5 unique feeds exist
  if (selected.length < 5) {
    const selectedIds = new Set(selected.map((s) => s.id));
    for (const item of sorted) {
      if (selected.length >= 5) break;
      if (!selectedIds.has(item.id)) {
        selected.push(item);
        selectedIds.add(item.id);
      }
    }
  }

  // If the first briefing slide is identical to the first card in the feed below, rotate so slide 1 highlights another publisher first
  const orderedStories =
    selected.length >= 2 && articles.length > 0 && selected[0].id === articles[0].id
      ? [...selected.slice(1), selected[0]]
      : selected;

  const totalReadMinutes = orderedStories.reduce(
    (sum, item) => sum + Math.max(1, item.readTimeMin || 3),
    0
  );

  return {
    editionTitle,
    subtitle,
    stories: orderedStories,
    totalReadMinutes,
  };
}

/**
 * Deterministically extracts 3 crisp TL;DR bullet points for instant zero-latency Quick Peek.
 */
export function generateQuickTldrBullets(article: FeedItem): string[] {
  const rawSource = [article.contentClean || '', article.summary || '']
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!rawSource || rawSource.length < 40) {
    return [
      article.title,
      `Published by ${article.feedTitle} · Estimated ${article.readTimeMin || 3} min read.`,
      'Open in Distraction-Free Reader to extract the complete article text.',
    ];
  }

  // Split on sentence boundaries (English '.', '!', '?' and Bengali dari '।')
  const sentences = rawSource
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 28 && s !== article.title);

  const uniqueBullets: string[] = [];
  for (const sentence of sentences) {
    if (uniqueBullets.length >= 3) break;
    const clipped =
      sentence.length > 145 ? `${sentence.slice(0, 140).trim()}…` : sentence;
    if (!uniqueBullets.some((b) => b.slice(0, 30) === clipped.slice(0, 30))) {
      uniqueBullets.push(clipped);
    }
  }

  while (uniqueBullets.length < 3) {
    if (uniqueBullets.length === 0) {
      uniqueBullets.push(article.summary?.slice(0, 140) || article.title);
    } else if (uniqueBullets.length === 1) {
      uniqueBullets.push(
        `Source perspective from ${article.feedTitle}${article.author ? ` (${article.author})` : ''}.`
      );
    } else {
      uniqueBullets.push(
        `Full distraction-free text available (${article.readTimeMin || 3} min read).`
      );
    }
  }

  return uniqueBullets.slice(0, 3);
}

/**
 * Formats a timestamp (ms) into local YYYY-MM-DD string
 */
export function toDateKey(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks if dateA (YYYY-MM-DD) is the calendar day immediately before dateB (YYYY-MM-DD)
 */
export function isYesterdayOf(dateA: string | null, dateB: string): boolean {
  if (!dateA) return false;
  const [yA, mA, dA] = dateA.split('-').map(Number);
  const [yB, mB, dB] = dateB.split('-').map(Number);
  if (!yA || !yB) return false;
  const utcA = Date.UTC(yA, mA - 1, dA);
  const utcB = Date.UTC(yB, mB - 1, dB);
  const diffDays = Math.round((utcB - utcA) / (24 * 60 * 60 * 1000));
  return diffDays === 1;
}

/**
 * Normalizes stored ReadingHabitState to the current calendar date so stale days roll over cleanly
 */
export function normalizeReadingHabitState(
  state: ReadingHabitState,
  todayKey: string = toDateKey()
): ReadingHabitState {
  if (state.todayDate === todayKey) {
    return state;
  }

  // If the user neither completed yesterday nor read today, check if streak is still alive from yesterday
  const streakStillValid =
    state.lastCompletedDate === todayKey ||
    isYesterdayOf(state.lastCompletedDate, todayKey);

  return {
    dailyGoal: state.dailyGoal || 3,
    todayDate: todayKey,
    todayReadIds: [],
    todayMinutes: 0,
    streakDays: streakStillValid ? state.streakDays : 0,
    lastCompletedDate: state.lastCompletedDate,
  };
}

/**
 * Records a completed story read into the user's daily reading habit state.
 */
export function recordArticleReadInHabit(
  prevState: ReadingHabitState,
  articleId: string,
  readTimeMin: number,
  todayKey: string = toDateKey()
): { nextState: ReadingHabitState; justHitDailyGoal: boolean } {
  const current = normalizeReadingHabitState(prevState, todayKey);

  if (current.todayReadIds.includes(articleId)) {
    return { nextState: current, justHitDailyGoal: false };
  }

  const nextReadIds = [...current.todayReadIds, articleId];
  const nextMinutes = current.todayMinutes + Math.max(1, Math.min(15, readTimeMin || 3));
  const wasBelowGoal = current.todayReadIds.length < current.dailyGoal;
  const nowMeetsGoal = nextReadIds.length >= current.dailyGoal;
  const justHitDailyGoal = wasBelowGoal && nowMeetsGoal;

  let nextStreak = current.streakDays;
  let nextLastCompleted = current.lastCompletedDate;

  if (justHitDailyGoal && current.lastCompletedDate !== todayKey) {
    if (isYesterdayOf(current.lastCompletedDate, todayKey)) {
      nextStreak = current.streakDays + 1;
    } else {
      nextStreak = Math.max(1, current.streakDays || 1);
    }
    nextLastCompleted = todayKey;
  } else if (nextStreak === 0 && nextReadIds.length > 0) {
    nextStreak = 1;
  }

  return {
    nextState: {
      ...current,
      todayReadIds: nextReadIds,
      todayMinutes: nextMinutes,
      streakDays: nextStreak,
      lastCompletedDate: nextLastCompleted,
    },
    justHitDailyGoal,
  };
}

/**
 * Filters incoming articles to find genuinely new ones not yet present in currentArticles
 */
export function findNewIncomingArticles(
  currentArticles: FeedItem[],
  incomingArticles: FeedItem[]
): FeedItem[] {
  const existingIds = new Set(currentArticles.map((a) => a.id));
  const existingLinks = new Set(currentArticles.map((a) => a.link));

  return incomingArticles.filter(
    (item) => !existingIds.has(item.id) && (!item.link || !existingLinks.has(item.link))
  );
}
