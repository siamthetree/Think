export type ReadingLanguage = 'en' | 'bn';

export const CALIBRATION_ARTICLE_THRESHOLD = 15;
export const DEFAULT_EN_WPM = 220;
export const DEFAULT_BN_WPM = 190;
export const MIN_OBSERVABLE_WORDS = 40;
export const MIN_OBSERVABLE_ACTIVE_MS = 5000;
export const MAX_OBSERVABLE_ACTIVE_MS = 2 * 60 * 60 * 1000;
export const MIN_WPM_BOUND = 40;
export const MAX_WPM_BOUND = 5000;
const MAX_OBSERVATIONS_PER_LANG = 50;

export interface ReadingObservation {
  articleId: string;
  language: ReadingLanguage;
  wordCount: number;
  activeMs: number;
  wpm: number;
  timestamp: number;
}

export interface LanguageReadingSpeed {
  observedCount: number;
  learnedWpm: number | null;
  observations: ReadingObservation[];
}

export interface ReadingSpeedProfile {
  en: LanguageReadingSpeed;
  bn: LanguageReadingSpeed;
}

export function createDefaultReadingSpeedProfile(): ReadingSpeedProfile {
  return {
    en: { observedCount: 0, learnedWpm: null, observations: [] },
    bn: { observedCount: 0, learnedWpm: null, observations: [] },
  };
}

/**
 * Normalizes persisted reading speed state safely across app versions.
 */
export function normalizeReadingSpeedProfile(raw: unknown): ReadingSpeedProfile {
  const base = createDefaultReadingSpeedProfile();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Partial<ReadingSpeedProfile>;

  const normalizeLang = (lang: ReadingLanguage, val: unknown): LanguageReadingSpeed => {
    if (!val || typeof val !== 'object') return base[lang];
    const v = val as Partial<LanguageReadingSpeed>;
    const observations = Array.isArray(v.observations)
      ? v.observations
          .filter(
            (o): o is ReadingObservation =>
              Boolean(
                o &&
                  typeof o === 'object' &&
                  typeof o.articleId === 'string' &&
                  Number.isFinite(o.wordCount) &&
                  Number.isFinite(o.activeMs) &&
                  o.wordCount >= MIN_OBSERVABLE_WORDS &&
                  o.activeMs >= MIN_OBSERVABLE_ACTIVE_MS
              )
          )
          .slice(-MAX_OBSERVATIONS_PER_LANG)
      : [];

    const observedCount = Math.max(
      observations.length,
      typeof v.observedCount === 'number' && Number.isFinite(v.observedCount)
        ? Math.max(0, Math.floor(v.observedCount))
        : 0
    );

    const learnedWpm = computeCalibratedWpm(observations, observedCount, v.learnedWpm ?? null);
    return {
      observedCount,
      learnedWpm,
      observations,
    };
  };

  return {
    en: normalizeLang('en', obj.en),
    bn: normalizeLang('bn', obj.bn),
  };
}

/**
 * Strips basic HTML tags to plain text for accurate word counting and language detection.
 */
export function stripHtmlForTiming(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Counts readable words in English, Bengali, or mixed-script prose,
 * ignoring standalone punctuation markers like `—` or `।`.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
  return tokens.length;
}

/**
 * Detects whether an article is predominantly Bangla (`'bn'`) or English (`'en'`).
 */
export function detectArticleLanguage(text: string, fallbackTitle = ''): ReadingLanguage {
  const sample = `${text || ''} ${fallbackTitle || ''}`.trim();
  if (!sample) return 'en';

  const bnMatches = sample.match(/[\u0980-\u09FF]/g);
  const latinMatches = sample.match(/[A-Za-z]/g);
  const bnCount = bnMatches ? bnMatches.length : 0;
  const latinCount = latinMatches ? latinMatches.length : 0;

  if (bnCount === 0) return 'en';
  if (bnCount >= 12 && bnCount >= latinCount * 0.25) return 'bn';
  if (bnCount > latinCount) return 'bn';
  return 'en';
}

export function extractArticleTextForTiming(article: {
  contentClean?: string;
  contentHtml?: string;
  summary?: string;
  title?: string;
}): string {
  const clean = (article.contentClean || '').trim();
  if (clean.length >= 60) return clean;
  if (article.contentHtml) {
    const stripped = stripHtmlForTiming(article.contentHtml);
    if (stripped.length > clean.length) return stripped;
  }
  if (clean.length > 0) return clean;
  const sum = stripHtmlForTiming(article.summary || '');
  if (sum.length > 0) return `${article.title || ''} ${sum}`.trim();
  return (article.title || '').trim();
}

function computeCalibratedWpm(
  observations: ReadingObservation[],
  observedCount: number,
  fallbackLearnedWpm: number | null = null
): number | null {
  if (observedCount < CALIBRATION_ARTICLE_THRESHOLD) return null;
  if (observations.length === 0) return fallbackLearnedWpm;

  // Trim single lowest & highest WPM outlier once 15+ samples exist so accidental pauses don't skew pace
  const sorted = [...observations].sort((a, b) => a.wpm - b.wpm);
  const pool = sorted.length >= CALIBRATION_ARTICLE_THRESHOLD ? sorted.slice(1, -1) : sorted;

  const totalWords = pool.reduce((sum, o) => sum + o.wordCount, 0);
  const totalMinutes = pool.reduce((sum, o) => sum + o.activeMs, 0) / 60000;
  if (totalMinutes <= 0 || totalWords <= 0) return fallbackLearnedWpm;

  const wpm = totalWords / totalMinutes;
  return Math.round(Math.max(MIN_WPM_BOUND, Math.min(MAX_WPM_BOUND, wpm)));
}

export interface RecordSessionInput {
  articleId: string;
  text: string;
  title?: string;
  activeMs: number;
  timestamp?: number;
}

export interface RecordSessionResult {
  nextProfile: ReadingSpeedProfile;
  recorded: boolean;
  language: ReadingLanguage;
  wordCount: number;
  observedCount: number;
  justCalibrated: boolean;
  learnedWpm: number | null;
}

/**
 * Records a finished article reading session for either English or Bangla independently.
 * Once 15 articles have been observed for a language, computes and locks in the reader's
 * personalized words-per-minute pace for that language.
 */
export function recordCompletedReadingSession(
  prevProfile: ReadingSpeedProfile,
  input: RecordSessionInput
): RecordSessionResult {
  const current = normalizeReadingSpeedProfile(prevProfile);
  const language = detectArticleLanguage(input.text, input.title || '');
  const wordCount = countWords(input.text);
  const activeMs = Math.round(input.activeMs);

  const langState = current[language];

  if (
    !input.articleId ||
    wordCount < MIN_OBSERVABLE_WORDS ||
    activeMs < MIN_OBSERVABLE_ACTIVE_MS ||
    activeMs > MAX_OBSERVABLE_ACTIVE_MS
  ) {
    return {
      nextProfile: current,
      recorded: false,
      language,
      wordCount,
      observedCount: langState.observedCount,
      justCalibrated: false,
      learnedWpm: langState.learnedWpm,
    };
  }

  const rawWpm = wordCount / (activeMs / 60000);
  const clampedWpm = Math.round(Math.max(MIN_WPM_BOUND, Math.min(MAX_WPM_BOUND, rawWpm)));
  const obs: ReadingObservation = {
    articleId: input.articleId,
    language,
    wordCount,
    activeMs,
    wpm: clampedWpm,
    timestamp: input.timestamp ?? Date.now(),
  };

  const existingIdx = langState.observations.findIndex((o) => o.articleId === input.articleId);
  let nextObservations: ReadingObservation[];
  let nextObservedCount = langState.observedCount;

  if (existingIdx !== -1) {
    nextObservations = langState.observations.map((o, idx) => (idx === existingIdx ? obs : o));
  } else {
    nextObservations = [...langState.observations, obs].slice(-MAX_OBSERVATIONS_PER_LANG);
    nextObservedCount = langState.observedCount + 1;
  }

  const nextLearnedWpm = computeCalibratedWpm(
    nextObservations,
    nextObservedCount,
    langState.learnedWpm
  );
  const prevWasCalibrated = langState.observedCount >= CALIBRATION_ARTICLE_THRESHOLD;
  const nowIsCalibrated = nextObservedCount >= CALIBRATION_ARTICLE_THRESHOLD && nextLearnedWpm !== null;

  const nextProfile: ReadingSpeedProfile = {
    ...current,
    [language]: {
      observedCount: nextObservedCount,
      learnedWpm: nextLearnedWpm,
      observations: nextObservations,
    },
  };

  return {
    nextProfile,
    recorded: true,
    language,
    wordCount,
    observedCount: nextObservedCount,
    justCalibrated: !prevWasCalibrated && nowIsCalibrated,
    learnedWpm: nextLearnedWpm,
  };
}

export function getBaselineWpm(language: ReadingLanguage): number {
  return language === 'bn' ? DEFAULT_BN_WPM : DEFAULT_EN_WPM;
}

export function getEffectiveWpm(
  profile: ReadingSpeedProfile,
  language: ReadingLanguage
): { wpm: number; isPersonalized: boolean; observedCount: number } {
  const langState = profile[language];
  const isPersonalized =
    langState.observedCount >= CALIBRATION_ARTICLE_THRESHOLD &&
    typeof langState.learnedWpm === 'number' &&
    langState.learnedWpm > 0;

  return {
    wpm: isPersonalized ? (langState.learnedWpm as number) : getBaselineWpm(language),
    isPersonalized,
    observedCount: langState.observedCount,
  };
}

export interface AdaptiveReadTimeEstimate {
  minutes: number;
  wordCount: number;
  language: ReadingLanguage;
  isPersonalized: boolean;
  wpmUsed: number;
}

/**
 * Estimates an article's reading time in minutes using the reader's learned speed
 * for its language (`en` or `bn`) once 15 articles have been observed, falling back to
 * language-appropriate baseline WPM beforehand.
 */
export function estimateArticleReadTime(
  article: {
    contentClean?: string;
    contentHtml?: string;
    summary?: string;
    title?: string;
    readTimeMin?: number;
  },
  profile: ReadingSpeedProfile
): AdaptiveReadTimeEstimate {
  const text = extractArticleTextForTiming(article);
  const wordCount = countWords(text);
  const language = detectArticleLanguage(text, article.title || '');
  const { wpm, isPersonalized } = getEffectiveWpm(profile, language);

  // When full text hasn't been extracted yet (teaser < 60 words) and RSS provided a baseline readTimeMin > 1,
  // scale that estimate proportionally to the reader's personalized pace.
  if (wordCount < 60 && typeof article.readTimeMin === 'number' && article.readTimeMin > 1) {
    const scaled = Math.round((article.readTimeMin * getBaselineWpm(language)) / wpm);
    return {
      minutes: Math.max(1, scaled),
      wordCount,
      language,
      isPersonalized,
      wpmUsed: wpm,
    };
  }

  const minutes = Math.max(1, Math.round(wordCount / wpm));
  return {
    minutes,
    wordCount,
    language,
    isPersonalized,
    wpmUsed: wpm,
  };
}
