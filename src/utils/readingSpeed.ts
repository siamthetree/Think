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

// Effective prose unit weights: standard news prose averages ~8 words/line
// so 0.85 * W + 1.2 * L === W at 8 words/line, while line-heavy formats
// (short lines, lists, quotes, breaks) add realistic visual-sweep time.
const UNIT_WORD_WEIGHT = 0.85;
const UNIT_LINE_WEIGHT = 1.2;

export interface ReadingObservation {
  articleId: string;
  language: ReadingLanguage;
  wordCount: number;
  lineCount: number;
  activeMs: number;
  wpm: number;
  timestamp: number;
}

export interface LanguageReadingSpeed {
  observedCount: number;
  learnedWpm: number | null;
  learnedMsPerWord: number | null;
  learnedMsPerLine: number | null;
  observations: ReadingObservation[];
}

export interface ReadingSpeedProfile {
  en: LanguageReadingSpeed;
  bn: LanguageReadingSpeed;
}

export function createDefaultReadingSpeedProfile(): ReadingSpeedProfile {
  return {
    en: {
      observedCount: 0,
      learnedWpm: null,
      learnedMsPerWord: null,
      learnedMsPerLine: null,
      observations: [],
    },
    bn: {
      observedCount: 0,
      learnedWpm: null,
      learnedMsPerWord: null,
      learnedMsPerLine: null,
      observations: [],
    },
  };
}

export function getTotalObservedCount(profile: ReadingSpeedProfile): number {
  return (profile.en?.observedCount || 0) + (profile.bn?.observedCount || 0);
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
 * Preserves structural line breaks when converting HTML to plain lines for line counting.
 */
export function htmlToStructuredLines(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
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
 * Counts reading lines in an article across explicit line breaks / HTML blocks
 * AND wrapped visual reading lines (~52 chars/line English, ~46 chars/line Bangla).
 * Articles with more line breaks or shorter lines yield higher line counts than dense blocks.
 */
export function countLines(text: string, language?: ReadingLanguage): number {
  const raw = (text || '').trim();
  if (!raw) return 0;

  const lang = language || detectArticleLanguage(raw);
  const charsPerLine = lang === 'bn' ? 46 : 52;
  const structuralLines = raw
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => /[\p{L}\p{N}]/u.test(line));

  if (structuralLines.length === 0) return 1;

  let totalLines = 0;
  for (const line of structuralLines) {
    totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  return Math.max(1, totalLines);
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

export function extractArticleStructuredTextForLines(article: {
  contentClean?: string;
  contentHtml?: string;
  summary?: string;
  title?: string;
}): string {
  const clean = (article.contentClean || '').trim();
  const hasExplicitNewlines = clean.includes('\n');
  if (clean.length >= 60 && hasExplicitNewlines) return clean;

  if (article.contentHtml) {
    const structured = htmlToStructuredLines(article.contentHtml);
    if (structured.length >= Math.max(20, clean.length * 0.7)) {
      return structured;
    }
  }
  if (clean.length > 0) return clean;
  if (article.summary) {
    const structuredSum = htmlToStructuredLines(article.summary);
    if (structuredSum.length > 0) {
      return `${article.title ? `${article.title}\n` : ''}${structuredSum}`.trim();
    }
  }
  return (article.title || '').trim();
}

function getEffectiveUnits(wordCount: number, lineCount: number): number {
  return Math.max(1, UNIT_WORD_WEIGHT * wordCount + UNIT_LINE_WEIGHT * lineCount);
}

interface CalibratedPaceModel {
  learnedWpm: number;
  msPerWord: number;
  msPerLine: number;
}

/**
 * Fits a regularized (words, lines) -> time model from observed articles.
 * Automatically trims the single lowest & highest speed outliers once >= 15 samples exist,
 * guarantees exact zero-bias energy conservation on uniform prose, and learns separate
 * per-word and per-line time costs via scale-invariant 2x2 ridge regression when line density varies.
 */
function fitWordLinePaceModel(observations: ReadingObservation[]): CalibratedPaceModel | null {
  if (observations.length === 0) return null;

  const sorted = [...observations].sort((a, b) => a.wpm - b.wpm);
  const pool = sorted.length >= CALIBRATION_ARTICLE_THRESHOLD ? sorted.slice(1, -1) : sorted;

  const totalWords = pool.reduce((sum, o) => sum + o.wordCount, 0);
  const totalLines = pool.reduce((sum, o) => sum + Math.max(1, o.lineCount), 0);
  const totalMs = pool.reduce((sum, o) => sum + o.activeMs, 0);
  const totalUnits = pool.reduce((sum, o) => sum + getEffectiveUnits(o.wordCount, o.lineCount), 0);

  if (totalMs <= 0 || totalWords <= 0 || totalUnits <= 0) return null;

  const rawWpm = totalWords / (totalMs / 60000);
  const learnedWpm = Math.round(Math.max(MIN_WPM_BOUND, Math.min(MAX_WPM_BOUND, rawWpm)));

  // Prior proportional split using learned effective-unit pace
  const msPerUnit = totalMs / totalUnits;
  const priorMsPerWord = UNIT_WORD_WEIGHT * msPerUnit;
  const priorMsPerLine = UNIT_LINE_WEIGHT * msPerUnit;

  let msPerWord = priorMsPerWord;
  let msPerLine = priorMsPerLine;

  // When we have >= 4 observations with varying words-per-line ratios, solve regularized 2x2 residual system
  if (pool.length >= 4) {
    const ratios = pool.map((o) => o.wordCount / Math.max(1, o.lineCount));
    const minRatio = Math.min(...ratios);
    const maxRatio = Math.max(...ratios);

    if (maxRatio - minRatio >= 0.75) {
      let sWW = 0;
      let sLL = 0;
      let sWL = 0;
      let sWR = 0;
      let sLR = 0;

      for (const o of pool) {
        const w = o.wordCount;
        const l = Math.max(1, o.lineCount);
        const residual = o.activeMs - (priorMsPerWord * w + priorMsPerLine * l);
        sWW += w * w;
        sLL += l * l;
        sWL += w * l;
        sWR += w * residual;
        sLR += l * residual;
      }

      // Scale-invariant ridge penalty (gentle shrinkage toward prior split)
      const regFactor = 0.12;
      const a11 = sWW * (1 + regFactor) + 1e-6;
      const a22 = sLL * (1 + regFactor) + 1e-6;
      const a12 = sWL;
      const det = a11 * a22 - a12 * a12;

      if (Math.abs(det) > 1e-6) {
        const dW = (sWR * a22 - sLR * a12) / det;
        const dL = (a11 * sLR - a12 * sWR) / det;

        const candW = Math.max(priorMsPerWord * 0.25, Math.min(priorMsPerWord * 3.0, priorMsPerWord + dW));
        const candL = Math.max(priorMsPerLine * 0.1, Math.min(priorMsPerLine * 5.0, priorMsPerLine + dL));

        const predictedTotalMs = candW * totalWords + candL * totalLines;
        if (predictedTotalMs > 0) {
          const normScale = totalMs / predictedTotalMs;
          msPerWord = candW * normScale;
          msPerLine = candL * normScale;
        }
      }
    }
  }

  // Clamp extreme overall rates symmetrically to [MIN_WPM_BOUND, MAX_WPM_BOUND]
  const minAllowedMsPerUnit = 60000 / MAX_WPM_BOUND;
  const maxAllowedMsPerUnit = 60000 / MIN_WPM_BOUND;
  const impliedMsPerUnit =
    (msPerWord * totalWords + msPerLine * totalLines) / Math.max(1, totalUnits);

  if (impliedMsPerUnit < minAllowedMsPerUnit && impliedMsPerUnit > 0) {
    const scale = minAllowedMsPerUnit / impliedMsPerUnit;
    msPerWord *= scale;
    msPerLine *= scale;
  } else if (impliedMsPerUnit > maxAllowedMsPerUnit) {
    const scale = maxAllowedMsPerUnit / impliedMsPerUnit;
    msPerWord *= scale;
    msPerLine *= scale;
  }

  return {
    learnedWpm,
    msPerWord,
    msPerLine,
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
          .map((o) => ({
            ...o,
            lineCount:
              typeof o.lineCount === 'number' && Number.isFinite(o.lineCount) && o.lineCount >= 1
                ? Math.round(o.lineCount)
                : Math.max(1, Math.round(o.wordCount / 8)),
          }))
          .slice(-MAX_OBSERVATIONS_PER_LANG)
      : [];

    const observedCount = Math.max(
      observations.length,
      typeof v.observedCount === 'number' && Number.isFinite(v.observedCount)
        ? Math.max(0, Math.floor(v.observedCount))
        : 0
    );

    const model = fitWordLinePaceModel(observations);
    return {
      observedCount,
      learnedWpm: model ? model.learnedWpm : (v.learnedWpm ?? null),
      learnedMsPerWord: model ? model.msPerWord : (v.learnedMsPerWord ?? null),
      learnedMsPerLine: model ? model.msPerLine : (v.learnedMsPerLine ?? null),
      observations,
    };
  };

  const normalized: ReadingSpeedProfile = {
    en: normalizeLang('en', obj.en),
    bn: normalizeLang('bn', obj.bn),
  };

  // Before 15 total articles are finished, keep learnedWpm null until threshold is crossed
  if (getTotalObservedCount(normalized) < CALIBRATION_ARTICLE_THRESHOLD) {
    normalized.en.learnedWpm = null;
    normalized.en.learnedMsPerWord = null;
    normalized.en.learnedMsPerLine = null;
    normalized.bn.learnedWpm = null;
    normalized.bn.learnedMsPerWord = null;
    normalized.bn.learnedMsPerLine = null;
  }

  return normalized;
}

export interface RecordSessionInput {
  articleId: string;
  text: string;
  contentHtml?: string;
  title?: string;
  activeMs: number;
  timestamp?: number;
}

export interface RecordSessionResult {
  nextProfile: ReadingSpeedProfile;
  recorded: boolean;
  language: ReadingLanguage;
  wordCount: number;
  lineCount: number;
  observedCount: number;
  totalObservedCount: number;
  justCalibrated: boolean;
  learnedWpm: number | null;
}

/**
 * Records a finished article reading session (words, lines, language, duration).
 * Once the user finishes reading 15 articles, calibrates personalized reading-time
 * prediction using the article's words, lines, and language.
 */
export function recordCompletedReadingSession(
  prevProfile: ReadingSpeedProfile,
  input: RecordSessionInput
): RecordSessionResult {
  const current = normalizeReadingSpeedProfile(prevProfile);
  const language = detectArticleLanguage(input.text, input.title || '');
  const wordCount = countWords(input.text);
  const structuredText =
    input.text.includes('\n') || !input.contentHtml
      ? input.text
      : htmlToStructuredLines(input.contentHtml);
  const lineCount = countLines(structuredText || input.text, language);
  const activeMs = Math.round(input.activeMs);

  const langState = current[language];
  const prevTotalObserved = getTotalObservedCount(current);

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
      lineCount,
      observedCount: langState.observedCount,
      totalObservedCount: prevTotalObserved,
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
    lineCount,
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

  const nextEn =
    language === 'en'
      ? { ...current.en, observedCount: nextObservedCount, observations: nextObservations }
      : { ...current.en };
  const nextBn =
    language === 'bn'
      ? { ...current.bn, observedCount: nextObservedCount, observations: nextObservations }
      : { ...current.bn };

  const nextTotalObserved = nextEn.observedCount + nextBn.observedCount;
  const prevWasTotalCalibrated = prevTotalObserved >= CALIBRATION_ARTICLE_THRESHOLD;
  const nowIsTotalCalibrated = nextTotalObserved >= CALIBRATION_ARTICLE_THRESHOLD;

  // Populate calibrated word + line models once 15 total articles are finished
  if (nowIsTotalCalibrated) {
    const enModel = fitWordLinePaceModel(nextEn.observations);
    nextEn.learnedWpm = enModel ? enModel.learnedWpm : nextEn.learnedWpm;
    nextEn.learnedMsPerWord = enModel ? enModel.msPerWord : nextEn.learnedMsPerWord;
    nextEn.learnedMsPerLine = enModel ? enModel.msPerLine : nextEn.learnedMsPerLine;

    const bnModel = fitWordLinePaceModel(nextBn.observations);
    nextBn.learnedWpm = bnModel ? bnModel.learnedWpm : nextBn.learnedWpm;
    nextBn.learnedMsPerWord = bnModel ? bnModel.msPerWord : nextBn.learnedMsPerWord;
    nextBn.learnedMsPerLine = bnModel ? bnModel.msPerLine : nextBn.learnedMsPerLine;
  } else {
    nextEn.learnedWpm = null;
    nextEn.learnedMsPerWord = null;
    nextEn.learnedMsPerLine = null;
    nextBn.learnedWpm = null;
    nextBn.learnedMsPerWord = null;
    nextBn.learnedMsPerLine = null;
  }

  const nextProfile: ReadingSpeedProfile = {
    en: nextEn,
    bn: nextBn,
  };

  const activeLangState = nextProfile[language];
  const prevLangWasCalibrated =
    prevWasTotalCalibrated && langState.observedCount >= CALIBRATION_ARTICLE_THRESHOLD;
  const nowLangCalibrated =
    nowIsTotalCalibrated && activeLangState.observedCount === CALIBRATION_ARTICLE_THRESHOLD;

  const justCalibrated =
    (!prevWasTotalCalibrated && nowIsTotalCalibrated) ||
    (!prevLangWasCalibrated && nowLangCalibrated && existingIdx === -1);

  return {
    nextProfile,
    recorded: true,
    language,
    wordCount,
    lineCount,
    observedCount: nextObservedCount,
    totalObservedCount: nextTotalObserved,
    justCalibrated,
    learnedWpm: activeLangState.learnedWpm,
  };
}

export function getBaselineWpm(language: ReadingLanguage): number {
  return language === 'bn' ? DEFAULT_BN_WPM : DEFAULT_EN_WPM;
}

export function getEffectivePaceParameters(
  profile: ReadingSpeedProfile,
  language: ReadingLanguage
): {
  wpm: number;
  msPerWord: number;
  msPerLine: number;
  isPersonalized: boolean;
  observedCount: number;
  totalObservedCount: number;
} {
  const totalObserved = getTotalObservedCount(profile);
  const langState = profile[language];
  const otherLang: ReadingLanguage = language === 'en' ? 'bn' : 'en';
  const otherState = profile[otherLang];

  const baselineWpm = getBaselineWpm(language);
  const baseMsPerUnit = 60000 / baselineWpm;
  const baseMsPerWord = UNIT_WORD_WEIGHT * baseMsPerUnit;
  const baseMsPerLine = UNIT_LINE_WEIGHT * baseMsPerUnit;

  if (totalObserved < CALIBRATION_ARTICLE_THRESHOLD) {
    return {
      wpm: baselineWpm,
      msPerWord: baseMsPerWord,
      msPerLine: baseMsPerLine,
      isPersonalized: false,
      observedCount: langState.observedCount,
      totalObservedCount: totalObserved,
    };
  }

  // User has finished >= 15 articles total:
  // 1) If target language has >= 1 observation, use its learned (words, lines) pace
  //    (blended smoothly with cross-language speed ratio if < 3 samples in this language).
  if (
    langState.observedCount > 0 &&
    typeof langState.learnedMsPerWord === 'number' &&
    typeof langState.learnedMsPerLine === 'number' &&
    typeof langState.learnedWpm === 'number'
  ) {
    if (
      langState.observedCount < 3 &&
      otherState.observedCount >= 3 &&
      typeof otherState.learnedWpm === 'number'
    ) {
      const otherRatio = otherState.learnedWpm / getBaselineWpm(otherLang);
      const crossWpm = Math.round(
        Math.max(MIN_WPM_BOUND, Math.min(MAX_WPM_BOUND, baselineWpm * otherRatio))
      );
      const crossMsPerUnit = 60000 / crossWpm;
      const crossMsPerWord = UNIT_WORD_WEIGHT * crossMsPerUnit;
      const crossMsPerLine = UNIT_LINE_WEIGHT * crossMsPerUnit;
      const weightOwn = langState.observedCount / 3;
      return {
        wpm: Math.round(weightOwn * langState.learnedWpm + (1 - weightOwn) * crossWpm),
        msPerWord: weightOwn * langState.learnedMsPerWord + (1 - weightOwn) * crossMsPerWord,
        msPerLine: weightOwn * langState.learnedMsPerLine + (1 - weightOwn) * crossMsPerLine,
        isPersonalized: true,
        observedCount: langState.observedCount,
        totalObservedCount: totalObserved,
      };
    }

    return {
      wpm: langState.learnedWpm,
      msPerWord: langState.learnedMsPerWord,
      msPerLine: langState.learnedMsPerLine,
      isPersonalized: true,
      observedCount: langState.observedCount,
      totalObservedCount: totalObserved,
    };
  }

  // 2) If user finished 15+ articles in the other language and 0 in this language yet,
  //    apply their personal speed multiplier onto this language's distinct baseline (words + lines).
  if (otherState.observedCount > 0 && typeof otherState.learnedWpm === 'number') {
    const ratio = otherState.learnedWpm / getBaselineWpm(otherLang);
    const scaledWpm = Math.round(
      Math.max(MIN_WPM_BOUND, Math.min(MAX_WPM_BOUND, baselineWpm * ratio))
    );
    const scaledMsPerUnit = 60000 / scaledWpm;
    return {
      wpm: scaledWpm,
      msPerWord: UNIT_WORD_WEIGHT * scaledMsPerUnit,
      msPerLine: UNIT_LINE_WEIGHT * scaledMsPerUnit,
      isPersonalized: true,
      observedCount: langState.observedCount,
      totalObservedCount: totalObserved,
    };
  }

  return {
    wpm: baselineWpm,
    msPerWord: baseMsPerWord,
    msPerLine: baseMsPerLine,
    isPersonalized: false,
    observedCount: langState.observedCount,
    totalObservedCount: totalObserved,
  };
}

export function getEffectiveWpm(
  profile: ReadingSpeedProfile,
  language: ReadingLanguage
): { wpm: number; isPersonalized: boolean; observedCount: number } {
  const pace = getEffectivePaceParameters(profile, language);
  return {
    wpm: pace.wpm,
    isPersonalized: pace.isPersonalized,
    observedCount: pace.observedCount,
  };
}

export interface AdaptiveReadTimeEstimate {
  minutes: number;
  predictedSeconds: number;
  wordCount: number;
  lineCount: number;
  language: ReadingLanguage;
  isPersonalized: boolean;
  wpmUsed: number;
  totalObservedCount: number;
}

/**
 * Predicts an article's reading time using its word count, line count, and language (`en` or `bn`).
 * Uses baseline language speeds before 15 finished articles, then switches to the user's
 * personalized (words, lines, language) model once 15 articles have been observed.
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
  const normalizedProfile = normalizeReadingSpeedProfile(profile);
  const text = extractArticleTextForTiming(article);
  const structuredText = extractArticleStructuredTextForLines(article);
  const wordCount = countWords(text);
  const language = detectArticleLanguage(text, article.title || '');
  const lineCount = countLines(structuredText || text, language);
  const pace = getEffectivePaceParameters(normalizedProfile, language);

  // When full text hasn't been extracted yet (teaser < 60 words) and RSS provided a baseline readTimeMin > 1,
  // scale that estimate proportionally to the reader's personalized pace.
  if (wordCount < 60 && typeof article.readTimeMin === 'number' && article.readTimeMin > 1) {
    const scaledMin = (article.readTimeMin * getBaselineWpm(language)) / pace.wpm;
    return {
      minutes: Math.max(1, Math.round(scaledMin)),
      predictedSeconds: Math.max(15, Math.round(scaledMin * 60)),
      wordCount,
      lineCount,
      language,
      isPersonalized: pace.isPersonalized,
      wpmUsed: pace.wpm,
      totalObservedCount: pace.totalObservedCount,
    };
  }

  const predictedMs = Math.max(
    0,
    wordCount * pace.msPerWord + lineCount * pace.msPerLine
  );
  const predictedMinutesFloat = predictedMs / 60000;
  const minutes = Math.max(1, Math.round(predictedMinutesFloat));

  return {
    minutes,
    predictedSeconds: Math.max(1, Math.round(predictedMs / 1000)),
    wordCount,
    lineCount,
    language,
    isPersonalized: pace.isPersonalized,
    wpmUsed: pace.wpm,
    totalObservedCount: pace.totalObservedCount,
  };
}
