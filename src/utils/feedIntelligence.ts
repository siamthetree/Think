import type { Feed, FeedItem, Tag } from '../types';

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

export interface ReadHistoryEntry {
  id: string;
  title: string;
  feedId: string;
  feedTitle: string;
  feedUrl?: string;
  timestamp: number;
  readTimeMin: number;
  imageUrl?: string;
  tags?: string[];
}

export interface ReadingHabitState {
  dailyGoal: number;
  todayDate: string; // YYYY-MM-DD
  todayReadIds: string[];
  todayMinutes: number;
  streakDays: number;
  lastCompletedDate: string | null;
  totalReadIds?: string[];
  totalMinutes?: number;
  sourceReadCounts?: Record<string, number>;
  readHistory?: ReadHistoryEntry[];
}

export interface ReadingProgressItem {
  articleId: string;
  title: string;
  feedTitle: string;
  progressPercent: number; // 1..94
  scrollTop: number;
  updatedAt: number;
}

export interface SpotifyTopSourceStat {
  rank: number;
  feedId: string;
  title: string;
  feedUrl?: string;
  storyCount: number;
  minutes: number;
  sharePercent: number;
}

export interface SpotifyTopGenreStat {
  rank: number;
  tagId: string;
  name: string;
  color: string;
  storyCount: number;
  sharePercent: number;
}

export interface SpotifyReaderAura {
  title:
    | 'Signal Seeker'
    | 'The Synthesis Architect'
    | 'The Policy Strategist'
    | 'Macro Pulse Analyst'
    | 'Frontier Technologist';
  subtitle: string;
  gradientFrom: string;
  gradientTo: string;
}

export interface SpotifyReadingStats {
  totalMinutesRead: number;
  totalStoriesRead: number;
  todayMinutesRead: number;
  todayStoriesRead: number;
  streakDays: number;
  estimatedWordsRead: number;
  topSources: SpotifyTopSourceStat[];
  topGenres: SpotifyTopGenreStat[];
  recentStories: ReadHistoryEntry[];
  readerAura: SpotifyReaderAura;
}

const STOP_WORDS = new Set([
  // Common English function words & reporting verbs
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'will', 'your',
  'about', 'into', 'after', 'over', 'under', 'between', 'what', 'when', 'where',
  'which', 'their', 'there', 'been', 'were', 'they', 'more', 'some', 'than',
  'news', 'report', 'reports', 'reported', 'says', 'said', 'amid', 'new', 'how',
  'why', 'who', 'its', 'are', 'was', 'has', 'had', 'not', 'but', 'you', 'all',
  'can', 'her', 'his', 'our', 'out', 'day', 'days', 'get', 'make', 'made',
  'just', 'like', 'know', 'take', 'year', 'years', 'month', 'week', 'today',
  'latest', 'update', 'updates', 'live', 'breaking', 'story', 'stories', 'read',
  'first', 'second', 'third', 'former', 'current', 'official', 'officials',
  'people', 'public', 'country', 'state', 'city', 'high', 'rise', 'falls',
  'percent', 'million', 'billion', 'crore', 'lakh', 'taka', 'dollar', 'dollars',
  'also', 'still', 'back', 'even', 'many', 'most', 'much', 'very', 'only',
  'could', 'would', 'should', 'must', 'being', 'before', 'while', 'during',
  'through', 'against', 'around', 'among', 'within', 'without', 'another',
  // Broad geographic & category words (prevent unrelated same-beat collisions)
  'bangladesh', 'bangladeshi', 'dhaka', 'chattogram', 'chittagong', 'sylhet',
  'rajshahi', 'khulna', 'india', 'indian', 'pakistan', 'china', 'chinese',
  'america', 'american', 'europe', 'european', 'britain', 'british', 'russia',
  'world', 'global', 'national', 'international', 'local', 'regional', 'foreign',
  'government', 'govt', 'minister', 'ministry', 'prime', 'president', 'chief',
  'parliament', 'election', 'party', 'political', 'politics', 'policy',
  'economy', 'economic', 'market', 'markets', 'business', 'trade', 'finance',
  'financial', 'bank', 'banks', 'banking', 'central', 'industry', 'sector',
  'police', 'court', 'courts', 'highcourt', 'judge', 'legal', 'case', 'cases',
  'crime', 'security', 'military', 'army', 'defense', 'defence',
  'health', 'medical', 'hospital', 'education', 'school', 'university', 'student',
  'students', 'sports', 'sport', 'cricket', 'football', 'match', 'team',
  'tech', 'technology', 'digital', 'company', 'companies', 'firm', 'firms',
  // Bengali stop words & broad geographic/category words
  'এবং', 'থেকে', 'করে', 'জন্য', 'হয়েছে', 'হয়েছে', 'বলে', 'বলেন', 'জানান',
  'সাথে', 'সঙ্গে', 'নিয়ে', 'নিয়ে', 'মধ্যে', 'কিন্তু', 'আরও', 'একটি', 'হবে',
  'হয়', 'হয়', 'বা', 'না', 'ও', 'এই', 'তার', 'করা', 'পর', 'দুই', 'তিন',
  'বাংলাদেশ', 'বাংলাদেশের', 'ঢাকা', 'ঢাকার', 'সরকার', 'সরকারি', 'মন্ত্রী',
  'প্রধানমন্ত্রী', 'অর্থনীতি', 'বাজার', 'ব্যাংক', 'পুলিশ', 'আদালত', 'বিশ্ব',
  'জাতীয়', 'জাতীয়', 'আন্তর্জাতিক', 'রাজনীতি', 'বাণিজ্য', 'খেলা', 'সংবাদ',
  'খবর', 'সর্বশেষ', 'আজ', 'নতুন', 'দেশ', 'দেশের', 'মানুষ', 'জানা', 'গেছে',
]);

/**
 * Lightweight English/Bengali stemmer so inflections (tighten/tightened/tightening, rates/rate) unify.
 */
export function normalizeTopicToken(token: string): string {
  const clean = token.trim().toLowerCase();
  if (!clean || clean.length < 3) return clean;
  // Skip non-ASCII (e.g. Bengali) suffix stripping so Bengali conjuncts remain intact
  if (/[^\x00-\x7F]/.test(clean)) return clean;

  if (clean.length > 6 && clean.endsWith('ations')) return clean.slice(0, -1);
  if (clean.length > 5 && clean.endsWith('ments')) return clean.slice(0, -1);
  if (clean.length > 5 && clean.endsWith('ings')) return clean.slice(0, -4);
  if (clean.length > 5 && clean.endsWith('ing')) return clean.slice(0, -3);
  if (clean.length > 4 && clean.endsWith('ies')) return `${clean.slice(0, -3)}y`;
  if (clean.length > 4 && clean.endsWith('ied')) return `${clean.slice(0, -3)}y`;
  if (clean.length > 4 && clean.endsWith('ers')) return clean.slice(0, -3);
  if (clean.length > 4 && clean.endsWith('ed')) return clean.slice(0, -2);
  if (clean.length > 4 && /(?:ch|sh|x|z|ss|o)es$/.test(clean)) return clean.slice(0, -2);
  if (clean.length > 3 && clean.endsWith('s') && !clean.endsWith('ss')) {
    return clean.slice(0, -1);
  }
  return clean;
}

/**
 * Extracts normalized significant unigram tokens (English & Bengali words >= 3 chars).
 */
export function extractSignificantTokens(text: string): string[] {
  if (!text) return [];
  const rawWords = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));

  const out: string[] = [];
  for (const w of rawWords) {
    if (STOP_WORDS.has(w)) continue;
    const stemmed = normalizeTopicToken(w);
    if (stemmed.length >= 3 && !STOP_WORDS.has(stemmed)) {
      out.push(stemmed);
    }
  }

  return Array.from(new Set(out));
}

/**
 * Extracts ordered 2-word topic bigrams from already-filtered significant tokens.
 */
export function extractTopicBigrams(tokens: string[]): string[] {
  if (!tokens || tokens.length < 2) return [];
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return Array.from(new Set(bigrams));
}

export interface PerspectiveMatch {
  article: FeedItem;
  score: number;
  sharedKeywords: string[];
  isDifferentSource: boolean;
  matchType: 'same-story' | 'related-perspective';
}

export interface PerspectiveSearchResult {
  target: FeedItem;
  queryKeywords: string[];
  matches: PerspectiveMatch[];
  sourceCount: number;
}

/**
 * Computes token & bigram similarity between two stories strictly on specific subjects.
 */
export function computeStorySimilarity(a: FeedItem, b: FeedItem): {
  score: number;
  sharedKeywords: string[];
  headlineOverlapCount: number;
} {
  const headA = extractSignificantTokens(a.title);
  const headB = extractSignificantTokens(b.title);
  const tokensA = extractSignificantTokens(`${a.title} ${a.summary?.slice(0, 160) || ''}`);
  const tokensB = extractSignificantTokens(`${b.title} ${b.summary?.slice(0, 160) || ''}`);

  if (tokensA.length === 0 || tokensB.length === 0) {
    return { score: 0, sharedKeywords: [], headlineOverlapCount: 0 };
  }

  const headSetB = new Set(headB);
  const sharedHead = headA.filter((t) => headSetB.has(t));

  const setB = new Set(tokensB);
  const shared = tokensA.filter((t) => setB.has(t));
  if (shared.length === 0) {
    return { score: 0, sharedKeywords: [], headlineOverlapCount: 0 };
  }

  const bigramsA = extractTopicBigrams(headA);
  const bigramsB = new Set(extractTopicBigrams(headB));
  const sharedBigrams = bigramsA.filter((bg) => bigramsB.has(bg));

  const minLen = Math.min(tokensA.length, tokensB.length);
  const overlapScore = shared.length / Math.max(1, minLen) + sharedBigrams.length * 0.16;

  return {
    score: Math.min(1.5, overlapScore),
    sharedKeywords: Array.from(new Set([...sharedHead, ...shared])).slice(0, 5),
    headlineOverlapCount: sharedHead.length,
  };
}

/**
 * Topic-strict cross-source Perspective search across all articles from all app sources.
 * Excludes broad geographic/category words and matches strictly on shared headline tokens,
 * bigrams, and specific story subjects.
 */
export function findPerspectivesAcrossSources(
  target: FeedItem,
  allArticles: FeedItem[]
): PerspectiveSearchResult {
  const titleTokens = extractSignificantTokens(target.title);
  const titleBigrams = extractTopicBigrams(titleTokens);
  const summaryTokens = extractSignificantTokens(
    `${target.summary?.slice(0, 240) || ''} ${target.contentClean?.slice(0, 300) || ''}`
  );
  const queryKeywords = Array.from(new Set([...titleTokens, ...summaryTokens.slice(0, 6)])).slice(
    0,
    8
  );

  const titleTokenSet = new Set(titleTokens);
  const titleBigramSet = new Set(titleBigrams);
  const allTargetTokenSet = new Set([...titleTokens, ...summaryTokens]);

  const matches: PerspectiveMatch[] = [];
  const seenLinks = new Set<string>();
  if (target.link) seenLinks.add(target.link.trim().toLowerCase());

  for (const candidate of allArticles) {
    if (candidate.id === target.id) continue;
    const normLink = (candidate.link || '').trim().toLowerCase();
    if (normLink && seenLinks.has(normLink)) continue;

    const normTargetTitle = target.title.trim().toLowerCase();
    const normCandidateTitle = candidate.title.trim().toLowerCase();

    const candTitleTokens = extractSignificantTokens(candidate.title);
    const candTitleBigrams = extractTopicBigrams(candTitleTokens);
    const candBodyTokens = extractSignificantTokens(
      `${candidate.summary?.slice(0, 240) || ''} ${candidate.contentClean?.slice(0, 300) || ''}`
    );
    const candAllTokens = Array.from(new Set([...candTitleTokens, ...candBodyTokens]));

    const sharedHeadlineTokens = candTitleTokens.filter((t) => titleTokenSet.has(t));
    const sharedBigrams = candTitleBigrams.filter((bg) => titleBigramSet.has(bg));
    const sharedKeywords = candAllTokens.filter((t) => allTargetTokenSet.has(t));

    if (sharedKeywords.length === 0 && normTargetTitle !== normCandidateTitle) {
      continue;
    }

    const isDifferentSource =
      candidate.feedId !== target.feedId &&
      candidate.feedTitle.trim().toLowerCase() !== target.feedTitle.trim().toLowerCase();

    const minTitleLen = Math.max(1, Math.min(titleTokens.length, candTitleTokens.length));
    const headlineOverlapRatio = sharedHeadlineTokens.length / minTitleLen;
    const bodyOverlapRatio =
      sharedKeywords.length / Math.max(1, Math.min(allTargetTokenSet.size, candAllTokens.length));

    let score =
      headlineOverlapRatio * 0.62 +
      bodyOverlapRatio * 0.28 +
      sharedBigrams.length * 0.22 +
      sharedHeadlineTokens.length * 0.08;

    if (normTargetTitle === normCandidateTitle) {
      score += 1.0;
    }

    const headlineOverlapCount = sharedHeadlineTokens.length;
    const passesStrictThreshold =
      normTargetTitle === normCandidateTitle ||
      (headlineOverlapCount >= 1 && sharedKeywords.length >= 2) ||
      (headlineOverlapCount >= 2 && score >= 0.28) ||
      score >= 0.42;

    if (!passesStrictThreshold) continue;

    const isSameStory =
      normTargetTitle === normCandidateTitle ||
      sharedBigrams.length >= 1 ||
      headlineOverlapCount >= 2 ||
      (headlineOverlapCount >= 1 && score >= 0.48);

    if (normLink) seenLinks.add(normLink);
    const displayKeywords = Array.from(
      new Set([...sharedHeadlineTokens, ...sharedKeywords])
    ).slice(0, 4);

    matches.push({
      article: candidate,
      score: Number(score.toFixed(4)),
      sharedKeywords: displayKeywords,
      isDifferentSource,
      matchType: isSameStory ? 'same-story' : 'related-perspective',
    });
  }

  matches.sort((a, b) => {
    if (a.matchType !== b.matchType) {
      return a.matchType === 'same-story' ? -1 : 1;
    }
    if (Math.abs(b.score - a.score) > 0.08) {
      return b.score - a.score;
    }
    if (a.isDifferentSource !== b.isDifferentSource) {
      return a.isDifferentSource ? -1 : 1;
    }
    return b.article.timestamp - a.article.timestamp;
  });

  const uniqueSourceNames = new Set<string>([
    target.feedTitle.trim().toLowerCase(),
    ...matches.map((m) => m.article.feedTitle.trim().toLowerCase()),
  ]);

  return {
    target,
    queryKeywords: queryKeywords.slice(0, 5),
    matches,
    sourceCount: uniqueSourceNames.size,
  };
}

/** Backwards-compatible alias for cross-source Perspective search */
export const searchPerspectivesAcrossSources = findPerspectivesAcrossSources;

/**
 * Groups related articles into Perspective Clusters while keeping chronological feed order.
 * Uses strict topic matching so unrelated category articles never falsely cluster.
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

      const { score, sharedKeywords, headlineOverlapCount } = computeStorySimilarity(
        primary,
        candidate
      );
      if (
        (headlineOverlapCount >= 1 && sharedKeywords.length >= 2) ||
        (headlineOverlapCount >= 2 && score >= 0.28) ||
        score >= 0.42
      ) {
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
 * Normalizes stored ReadingHabitState to the current calendar date while preserving persistent Wrapped history.
 */
export function normalizeReadingHabitState(
  state: ReadingHabitState,
  todayKey: string = toDateKey()
): ReadingHabitState {
  const baseTotalReadIds = Array.isArray(state.totalReadIds) ? state.totalReadIds : [];
  const baseTotalMinutes = typeof state.totalMinutes === 'number' ? state.totalMinutes : state.todayMinutes || 0;
  const baseSourceCounts =
    state.sourceReadCounts && typeof state.sourceReadCounts === 'object'
      ? state.sourceReadCounts
      : {};
  const baseHistory = Array.isArray(state.readHistory) ? state.readHistory : [];

  if (state.todayDate === todayKey) {
    return {
      ...state,
      totalReadIds: baseTotalReadIds,
      totalMinutes: baseTotalMinutes,
      sourceReadCounts: baseSourceCounts,
      readHistory: baseHistory,
    };
  }

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
    totalReadIds: baseTotalReadIds,
    totalMinutes: baseTotalMinutes,
    sourceReadCounts: baseSourceCounts,
    readHistory: baseHistory,
  };
}

/**
 * Records a completed story read into the user's daily reading habit & persistent Spotify-style stats history.
 */
export function recordArticleReadInHabit(
  prevState: ReadingHabitState,
  articleId: string,
  readTimeMin: number,
  todayKey: string = toDateKey(),
  articleMeta?: Partial<ReadHistoryEntry>
): { nextState: ReadingHabitState; justHitDailyGoal: boolean } {
  const current = normalizeReadingHabitState(prevState, todayKey);
  const clampedMin = Math.max(1, Math.min(15, readTimeMin || 3));

  const prevTotalReadIds = current.totalReadIds || [];
  const alreadyRecordedEver = prevTotalReadIds.includes(articleId);

  if (current.todayReadIds.includes(articleId)) {
    // Still ensure metadata is present in readHistory if passed
    if (articleMeta && !(current.readHistory || []).some((h) => h.id === articleId)) {
      const entry: ReadHistoryEntry = {
        id: articleId,
        title: articleMeta.title || 'Story',
        feedId: articleMeta.feedId || 'unknown',
        feedTitle: articleMeta.feedTitle || 'News Source',
        feedUrl: articleMeta.feedUrl,
        timestamp: articleMeta.timestamp || Date.now(),
        readTimeMin: clampedMin,
        imageUrl: articleMeta.imageUrl,
        tags: articleMeta.tags || [],
      };
      return {
        nextState: {
          ...current,
          readHistory: [entry, ...(current.readHistory || [])].slice(0, 60),
        },
        justHitDailyGoal: false,
      };
    }
    return { nextState: current, justHitDailyGoal: false };
  }

  const nextReadIds = [...current.todayReadIds, articleId];
  const nextMinutes = current.todayMinutes + clampedMin;
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

  const nextTotalReadIds = alreadyRecordedEver
    ? prevTotalReadIds
    : [...prevTotalReadIds, articleId].slice(-500);
  const nextTotalMinutes = (current.totalMinutes || 0) + (alreadyRecordedEver ? 0 : clampedMin);

  const nextSourceCounts = { ...(current.sourceReadCounts || {}) };
  const sourceKey = articleMeta?.feedId || articleMeta?.feedTitle;
  if (sourceKey && !alreadyRecordedEver) {
    nextSourceCounts[sourceKey] = (nextSourceCounts[sourceKey] || 0) + 1;
  }

  let nextHistory = current.readHistory || [];
  if (articleMeta?.title) {
    const newEntry: ReadHistoryEntry = {
      id: articleId,
      title: articleMeta.title,
      feedId: articleMeta.feedId || 'unknown',
      feedTitle: articleMeta.feedTitle || 'News Source',
      feedUrl: articleMeta.feedUrl,
      timestamp: Date.now(),
      readTimeMin: clampedMin,
      imageUrl: articleMeta.imageUrl,
      tags: articleMeta.tags || [],
    };
    nextHistory = [newEntry, ...nextHistory.filter((h) => h.id !== articleId)].slice(0, 60);
  }

  return {
    nextState: {
      ...current,
      todayReadIds: nextReadIds,
      todayMinutes: nextMinutes,
      streakDays: nextStreak,
      lastCompletedDate: nextLastCompleted,
      totalReadIds: nextTotalReadIds,
      totalMinutes: nextTotalMinutes,
      sourceReadCounts: nextSourceCounts,
      readHistory: nextHistory,
    },
    justHitDailyGoal,
  };
}

/**
 * Computes Spotify Wrapped-style Reading Stats from persistent habit history and loaded articles.
 */
export function computeSpotifyReadingStats(
  habit: ReadingHabitState,
  articles: FeedItem[],
  feeds: Feed[],
  tags: Tag[]
): SpotifyReadingStats {
  const normalized = normalizeReadingHabitState(habit);
  const articleMap = new Map(articles.map((a) => [a.id, a]));
  const feedMap = new Map(feeds.map((f) => [f.id, f]));
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  const history = normalized.readHistory || [];
  const readArticlesFromFeed = articles.filter((a) => a.isRead);

  // Unify read story IDs across persistent log + currently read items
  const allReadIds = new Set<string>([
    ...(normalized.totalReadIds || []),
    ...normalized.todayReadIds,
    ...history.map((h) => h.id),
    ...readArticlesFromFeed.map((a) => a.id),
  ]);

  const totalStoriesRead = Math.max(allReadIds.size, normalized.todayReadIds.length);

  // Accumulate minutes & per-source stats
  let accumulatedHistoryMin = 0;
  const sourceAgg = new Map<
    string,
    { feedId: string; title: string; feedUrl?: string; storyCount: number; minutes: number }
  >();
  const tagAgg = new Map<string, { tagId: string; storyCount: number }>();

  const countedIds = new Set<string>();

  const addStoryStat = (item: {
    id: string;
    feedId: string;
    feedTitle: string;
    feedUrl?: string;
    readTimeMin: number;
    tags?: string[];
  }) => {
    if (countedIds.has(item.id)) return;
    countedIds.add(item.id);
    const min = Math.max(1, item.readTimeMin || 3);
    accumulatedHistoryMin += min;

    const feedObj = feedMap.get(item.feedId);
    const key = (item.feedId && item.feedId !== 'unknown' ? item.feedId : item.feedTitle).toLowerCase();
    const existing = sourceAgg.get(key) || {
      feedId: item.feedId,
      title: feedObj?.title || item.feedTitle || 'News Source',
      feedUrl: feedObj?.url || item.feedUrl,
      storyCount: 0,
      minutes: 0,
    };
    existing.storyCount += 1;
    existing.minutes += min;
    sourceAgg.set(key, existing);

    const itemTags = item.tags && item.tags.length > 0 ? item.tags : feedObj?.defaultTags || [];
    for (const tid of itemTags) {
      const prev = tagAgg.get(tid) || { tagId: tid, storyCount: 0 };
      prev.storyCount += 1;
      tagAgg.set(tid, prev);
    }
  };

  for (const h of history) {
    const live = articleMap.get(h.id);
    addStoryStat({
      id: h.id,
      feedId: live?.feedId || h.feedId,
      feedTitle: live?.feedTitle || h.feedTitle,
      feedUrl: live?.feedUrl || h.feedUrl,
      readTimeMin: live?.readTimeMin || h.readTimeMin || 3,
      tags: live?.tags && live.tags.length > 0 ? live.tags : h.tags,
    });
  }

  for (const art of readArticlesFromFeed) {
    addStoryStat(art);
  }

  // Fold in persistent sourceReadCounts if older entries aren't in history anymore
  if (normalized.sourceReadCounts) {
    for (const [key, count] of Object.entries(normalized.sourceReadCounts)) {
      if (!count) continue;
      const feedObj = feedMap.get(key);
      const mapKey = key.toLowerCase();
      const existing = sourceAgg.get(mapKey);
      if (!existing) {
        sourceAgg.set(mapKey, {
          feedId: key,
          title: feedObj?.title || key,
          feedUrl: feedObj?.url,
          storyCount: count,
          minutes: count * 3,
        });
      } else if (existing.storyCount < count) {
        const diff = count - existing.storyCount;
        existing.storyCount = count;
        existing.minutes += diff * 3;
      }
    }
  }

  const totalMinutesRead = Math.max(
    normalized.totalMinutes || 0,
    normalized.todayMinutes || 0,
    accumulatedHistoryMin
  );
  const estimatedWordsRead = totalMinutesRead * 220;

  // Ranked #1-#5 Top Publishers
  const sortedSources = Array.from(sourceAgg.values())
    .sort((a, b) => b.storyCount - a.storyCount || b.minutes - a.minutes)
    .slice(0, 5);
  const totalSourceStories = Math.max(
    1,
    sortedSources.reduce((s, item) => s + item.storyCount, 0)
  );
  const topSources: SpotifyTopSourceStat[] = sortedSources.map((s, idx) => ({
    rank: idx + 1,
    feedId: s.feedId,
    title: s.title,
    feedUrl: s.feedUrl,
    storyCount: s.storyCount,
    minutes: s.minutes,
    sharePercent: Math.round((s.storyCount / totalSourceStories) * 100),
  }));

  // Ranked #1-#4 Top Beats / Genres
  const sortedTags = Array.from(tagAgg.values())
    .sort((a, b) => b.storyCount - a.storyCount)
    .slice(0, 4);
  const totalTagHits = Math.max(
    1,
    sortedTags.reduce((s, t) => s + t.storyCount, 0)
  );
  const topGenres: SpotifyTopGenreStat[] = sortedTags.map((t, idx) => {
    const tagObj = tagMap.get(t.tagId);
    return {
      rank: idx + 1,
      tagId: t.tagId,
      name: tagObj?.name || t.tagId.replace(/^tag_/, ''),
      color: tagObj?.color || '#1DB954',
      storyCount: t.storyCount,
      sharePercent: Math.round((t.storyCount / totalTagHits) * 100),
    };
  });

  // Recent stories ready to share as Spotify Song cards
  const recentMerged: ReadHistoryEntry[] = [];
  const seenRecent = new Set<string>();
  for (const h of history) {
    if (seenRecent.has(h.id)) continue;
    seenRecent.add(h.id);
    const live = articleMap.get(h.id);
    recentMerged.push({
      id: h.id,
      title: live?.title || h.title,
      feedId: live?.feedId || h.feedId,
      feedTitle: live?.feedTitle || h.feedTitle,
      feedUrl: live?.feedUrl || h.feedUrl,
      timestamp: h.timestamp || live?.timestamp || Date.now(),
      readTimeMin: live?.readTimeMin || h.readTimeMin || 3,
      imageUrl: live?.imageUrl || h.imageUrl,
      tags: live?.tags || h.tags || [],
    });
  }
  for (const art of readArticlesFromFeed) {
    if (seenRecent.has(art.id)) continue;
    seenRecent.add(art.id);
    recentMerged.push({
      id: art.id,
      title: art.title,
      feedId: art.feedId,
      feedTitle: art.feedTitle,
      feedUrl: art.feedUrl,
      timestamp: art.timestamp,
      readTimeMin: art.readTimeMin || 3,
      imageUrl: art.imageUrl,
      tags: art.tags || [],
    });
  }
  // If user hasn't read anything yet, offer latest unread feed stories for Song Share preview
  if (recentMerged.length === 0 && articles.length > 0) {
    for (const art of articles.slice(0, 4)) {
      recentMerged.push({
        id: art.id,
        title: art.title,
        feedId: art.feedId,
        feedTitle: art.feedTitle,
        feedUrl: art.feedUrl,
        timestamp: art.timestamp,
        readTimeMin: art.readTimeMin || 3,
        imageUrl: art.imageUrl,
        tags: art.tags || [],
      });
    }
  }

  // Determine Reader Aura persona
  const leadBeat = topGenres[0]?.tagId || '';
  let readerAura: SpotifyReaderAura = {
    title: 'Signal Seeker',
    subtitle: 'Curating distraction-free reporting across independent outlets.',
    gradientFrom: '#1DB954',
    gradientTo: '#0B3B24',
  };
  if (leadBeat.includes('tech')) {
    readerAura = {
      title: 'Frontier Technologist',
      subtitle: 'Tracking breakthroughs in computing, infrastructure, and digital craft.',
      gradientFrom: '#6366F1',
      gradientTo: '#1E1B4B',
    };
  } else if (leadBeat.includes('markets') || leadBeat.includes('finance')) {
    readerAura = {
      title: 'Macro Pulse Analyst',
      subtitle: 'Following capital flows, monetary shifts, and structural trade signals.',
      gradientFrom: '#10B981',
      gradientTo: '#064E3B',
    };
  } else if (leadBeat.includes('investigative') || leadBeat.includes('world') || leadBeat.includes('opinion')) {
    readerAura = {
      title: 'The Policy Strategist',
      subtitle: 'Connecting long-form investigations and global affairs without noise.',
      gradientFrom: '#FF6719',
      gradientTo: '#7C2D12',
    };
  } else if (topSources.length >= 3 || totalStoriesRead >= 6) {
    readerAura = {
      title: 'The Synthesis Architect',
      subtitle: 'Cross-referencing multiple newsrooms to build a sharper worldview.',
      gradientFrom: '#EC4899',
      gradientTo: '#4C1D95',
    };
  }

  return {
    totalMinutesRead,
    totalStoriesRead,
    todayMinutesRead: normalized.todayMinutes,
    todayStoriesRead: normalized.todayReadIds.length,
    streakDays: normalized.streakDays,
    estimatedWordsRead,
    topSources,
    topGenres,
    recentStories: recentMerged.slice(0, 8),
    readerAura,
  };
}

/**
 * Produces a canonical article link key (normalizes http->https, strips www., strips tracking query params & trailing slashes)
 */
export function canonicalizeArticleLink(rawLink?: string): string {
  if (!rawLink) return '';
  const trimmed = rawLink.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid', 'guccounter', 'cmpid', 'taid',
      'ns_mchannel', 'ns_source', 'ocid', 'at_medium', 'at_campaign',
    ];
    for (const key of trackingParams) {
      parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const proto = parsed.protocol === 'http:' ? 'https:' : parsed.protocol.toLowerCase();
    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
    const search = parsed.searchParams.toString();
    return `${proto}//${host}${cleanPath}${search ? `?${search}` : ''}`;
  } catch {
    return trimmed.replace(/^http:\/\//i, 'https://').replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Produces a normalized headline signature for duplicate/read matching across URL variants.
 */
export function normalizeHeadlineKey(title?: string): string {
  if (!title) return '';
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D"'`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_HEADLINE_DEDUP_CHARS = 18;

/**
 * Returns all stable identifiers/signatures for an article (id, raw link, canonical link, normalized title).
 */
export function getArticleReadSignatures(
  item: Pick<FeedItem, 'id' | 'link'> & { title?: string }
): string[] {
  const sigs: string[] = [];
  if (item.id) sigs.push(item.id);
  if (item.link) {
    sigs.push(item.link);
    const canon = canonicalizeArticleLink(item.link);
    if (canon) sigs.push(canon);
  }
  const titleKey = normalizeHeadlineKey(item.title);
  if (titleKey.length >= MIN_HEADLINE_DEDUP_CHARS) {
    sigs.push(`title:${titleKey}`);
  }
  return Array.from(new Set(sigs));
}

/**
 * Checks whether an article has already been read using its ID, canonicalized link, or normalized headline.
 */
export function isArticleInReadKeys(
  item: Pick<FeedItem, 'id' | 'link'> & { title?: string },
  readKeys: Set<string>
): boolean {
  if (!readKeys || readKeys.size === 0) return false;
  if (item.id && readKeys.has(item.id)) return true;
  if (item.link) {
    if (readKeys.has(item.link)) return true;
    const canonical = canonicalizeArticleLink(item.link);
    if (canonical && readKeys.has(canonical)) return true;
  }
  const titleKey = normalizeHeadlineKey(item.title);
  if (titleKey.length >= MIN_HEADLINE_DEDUP_CHARS && readKeys.has(`title:${titleKey}`)) {
    return true;
  }
  return false;
}

/**
 * Excludes any incoming articles the user has already read so refreshes only bring new unread content
 */
export function filterOutAlreadyReadIncoming(
  incomingArticles: FeedItem[],
  readKeys: Set<string>
): FeedItem[] {
  if (!readKeys || readKeys.size === 0) return incomingArticles;
  return incomingArticles.filter((item) => !isArticleInReadKeys(item, readKeys));
}

/**
 * Deduplicates feed items by id, canonical link, and normalized headline while merging rich fields
 * and local flags so repeated/syndicated duplicates never stack up in the newsfeed.
 */
export function deduplicateFeedItems(items: FeedItem[]): FeedItem[] {
  if (items.length <= 1) return items;

  const unique: FeedItem[] = [];
  const byId = new Map<string, number>();
  const byLink = new Map<string, number>();
  const byTitle = new Map<string, number>();

  const registerIndex = (item: FeedItem, idx: number) => {
    if (item.id) byId.set(item.id, idx);
    const canon = canonicalizeArticleLink(item.link);
    if (canon) byLink.set(canon, idx);
    const titleKey = normalizeHeadlineKey(item.title);
    if (titleKey.length >= MIN_HEADLINE_DEDUP_CHARS) {
      byTitle.set(titleKey, idx);
    }
  };

  for (const raw of items) {
    if (!raw) continue;
    const canon = canonicalizeArticleLink(raw.link);
    const titleKey = normalizeHeadlineKey(raw.title);

    let matchIdx: number | undefined;
    if (raw.id && byId.has(raw.id)) {
      matchIdx = byId.get(raw.id);
    } else if (canon && byLink.has(canon)) {
      matchIdx = byLink.get(canon);
    } else if (titleKey.length >= MIN_HEADLINE_DEDUP_CHARS && byTitle.has(titleKey)) {
      matchIdx = byTitle.get(titleKey);
    }

    if (matchIdx === undefined) {
      const idx = unique.length;
      unique.push(raw);
      registerIndex(raw, idx);
      continue;
    }

    const existing = unique[matchIdx];
    const existingBodyLen = (existing.contentClean || '').length + (existing.summary || '').length;
    const rawBodyLen = (raw.contentClean || '').length + (raw.summary || '').length;
    const rawHasBetterBody = rawBodyLen > existingBodyLen + 30 || (!existing.imageUrl && Boolean(raw.imageUrl));

    const merged: FeedItem = {
      ...(rawHasBetterBody ? raw : existing),
      id: existing.id,
      isRead: existing.isRead || raw.isRead,
      isBookmarked: existing.isBookmarked || raw.isBookmarked,
      hiddenFromFeed: existing.hiddenFromFeed ?? raw.hiddenFromFeed,
      isOfflineCached: existing.isOfflineCached || raw.isOfflineCached,
      imageUrl: existing.imageUrl || raw.imageUrl,
      author: existing.author || raw.author,
      summary:
        (existing.summary || '').length >= (raw.summary || '').length
          ? existing.summary
          : raw.summary,
      contentClean:
        (existing.contentClean || '').length >= (raw.contentClean || '').length
          ? existing.contentClean
          : raw.contentClean,
      contentHtml:
        (existing.contentHtml || '').length >= (raw.contentHtml || '').length
          ? existing.contentHtml
          : raw.contentHtml,
      timestamp: Math.max(existing.timestamp || 0, raw.timestamp || 0),
      pubDate: (raw.timestamp || 0) > (existing.timestamp || 0) ? raw.pubDate || existing.pubDate : existing.pubDate || raw.pubDate,
      fetchedBatchTs: Math.max(existing.fetchedBatchTs || 0, raw.fetchedBatchTs || 0) || undefined,
      tags: existing.tags.length >= raw.tags.length ? existing.tags : raw.tags,
    };

    unique[matchIdx] = merged;
    registerIndex(merged, matchIdx);
  }

  return unique;
}

/**
 * Ranks & interleaves articles like a Facebook/Instagram feed:
 * - Newly fetched refresh waves (fetchedBatchTs) stay surfaced at the top
 * - Unread stories rank ahead of previously read items
 * - Within each wave, sorts newest-first while breaking up long single-source streaks (>2 consecutive)
 */
export function rankAndInterleaveFeedItems(items: FeedItem[]): FeedItem[] {
  if (items.length <= 1) return items;

  const sorted = [...items].sort((a, b) => {
    // 1. Unread items ahead of already-read items
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;

    // 2. Refresh/arrival wave priority (fresh batches surface at the top!)
    const batchA = Math.floor((a.fetchedBatchTs || 0) / 1000);
    const batchB = Math.floor((b.fetchedBatchTs || 0) / 1000);
    if (batchA !== batchB) return batchB - batchA;

    // 3. Publication timestamp newest-first
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  // Group into same (isRead, batchSecond) buckets and diversify consecutive sources inside large buckets
  const result: FeedItem[] = [];
  let i = 0;
  while (i < sorted.length) {
    const baseRead = sorted[i].isRead;
    const baseBatch = Math.floor((sorted[i].fetchedBatchTs || 0) / 1000);
    const bucket: FeedItem[] = [];
    while (
      i < sorted.length &&
      sorted[i].isRead === baseRead &&
      Math.floor((sorted[i].fetchedBatchTs || 0) / 1000) === baseBatch
    ) {
      bucket.push(sorted[i]);
      i += 1;
    }

    const distinctFeeds = new Set(bucket.map((b) => b.feedId)).size;
    if (distinctFeeds <= 1 || bucket.length <= 3) {
      result.push(...bucket);
      continue;
    }

    // Smoothly cap consecutive posts from the same source to 2 in a row when other sources exist
    const queue = [...bucket];
    let lastFeedId = '';
    let streak = 0;
    while (queue.length > 0) {
      let pickIdx = 0;
      if (streak >= 2) {
        const altIdx = queue.findIndex((item) => item.feedId !== lastFeedId);
        if (altIdx !== -1 && altIdx <= 12) {
          pickIdx = altIdx;
        }
      }
      const [picked] = queue.splice(pickIdx, 1);
      if (picked.feedId === lastFeedId) {
        streak += 1;
      } else {
        lastFeedId = picked.feedId;
        streak = 1;
      }
      result.push(picked);
    }
  }

  return result;
}

/**
 * Clears read articles from the refreshed scope while recording their keys so they never come back.
 * Bookmarked read stories are preserved with hiddenFromFeed=true so Saved tab keeps them intact.
 */
export function clearReadArticlesForRefresh(
  articles: FeedItem[],
  scopePredicate?: (item: FeedItem) => boolean
): { nextArticles: FeedItem[]; newlyRecordedKeys: string[] } {
  const keys = new Set<string>();
  const nextArticles: FeedItem[] = [];

  for (const item of articles) {
    const inScope = !scopePredicate || scopePredicate(item);
    if (item.isRead) {
      for (const sig of getArticleReadSignatures(item)) {
        keys.add(sig);
      }
      if (inScope) {
        if (item.isBookmarked) {
          nextArticles.push({ ...item, hiddenFromFeed: true });
        }
        continue;
      }
    }
    nextArticles.push(item);
  }

  return {
    nextArticles,
    newlyRecordedKeys: Array.from(keys),
  };
}

/**
 * Filters incoming articles to find genuinely new unread ones not yet present in currentArticles or readKeys
 */
export function findNewIncomingArticles(
  currentArticles: FeedItem[],
  incomingArticles: FeedItem[],
  readKeys?: Set<string>
): FeedItem[] {
  const existingIds = new Set(currentArticles.map((a) => a.id));
  const existingLinks = new Set(
    currentArticles.flatMap((a) => [a.link, canonicalizeArticleLink(a.link)].filter(Boolean))
  );
  const existingTitles = new Set(
    currentArticles
      .map((a) => normalizeHeadlineKey(a.title))
      .filter((t) => t.length >= MIN_HEADLINE_DEDUP_CHARS)
  );

  const uniqueNew: FeedItem[] = [];
  for (const item of incomingArticles) {
    if (readKeys && isArticleInReadKeys(item, readKeys)) continue;
    if (existingIds.has(item.id)) continue;

    const canonLink = canonicalizeArticleLink(item.link);
    if (item.link && (existingLinks.has(item.link) || (canonLink && existingLinks.has(canonLink)))) {
      continue;
    }

    const titleKey = normalizeHeadlineKey(item.title);
    if (titleKey.length >= MIN_HEADLINE_DEDUP_CHARS && existingTitles.has(titleKey)) {
      continue;
    }

    existingIds.add(item.id);
    if (item.link) existingLinks.add(item.link);
    if (canonLink) existingLinks.add(canonLink);
    if (titleKey.length >= MIN_HEADLINE_DEDUP_CHARS) existingTitles.add(titleKey);
    uniqueNew.push(item);
  }

  return uniqueNew;
}
