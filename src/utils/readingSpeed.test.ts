import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALIBRATION_ARTICLE_THRESHOLD,
  DEFAULT_BN_WPM,
  DEFAULT_EN_WPM,
  countLines,
  countWords,
  createDefaultReadingSpeedProfile,
  detectArticleLanguage,
  estimateArticleReadTime,
  normalizeReadingSpeedProfile,
  recordCompletedReadingSession,
} from './readingSpeed';

function makeEnglishText(wordCount: number): string {
  const sample = ['grid', 'battery', 'energy', 'coastal', 'system', 'policy', 'market', 'report'];
  const out: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    out.push(sample[i % sample.length]);
  }
  return out.join(' ');
}

function makeBanglaText(wordCount: number): string {
  const sample = ['বাংলাদেশ', 'অর্থনীতি', 'বিদ্যুৎ', 'প্রকল্প', 'উন্নয়ন', 'বাজার', 'প্রতিবেদন', 'শহর'];
  const out: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    out.push(sample[i % sample.length]);
  }
  return out.join(' ');
}

function makeLineFormattedEnglish(wordsPerLine: number, lineCount: number): string {
  const words = ['grid', 'battery', 'energy', 'coastal', 'system', 'policy', 'market', 'report'];
  const lines: string[] = [];
  for (let l = 0; l < lineCount; l++) {
    const lineWords: string[] = [];
    for (let w = 0; w < wordsPerLine; w++) {
      lineWords.push(words[(l + w) % words.length]);
    }
    lines.push(lineWords.join(' '));
  }
  return lines.join('\n');
}

test('detectArticleLanguage distinguishes Bangla and English accurately even with mixed brand names', () => {
  assert.equal(detectArticleLanguage(makeEnglishText(120)), 'en');
  assert.equal(
    detectArticleLanguage(`${makeBanglaText(80)} BBC News USD AI`),
    'bn'
  );
});

test('calibrates after 15 finished articles and predicts separately for English and Bangla', () => {
  let profile = createDefaultReadingSpeedProfile();
  const en10k = makeEnglishText(10000);
  const bn10k = makeBanglaText(10000);

  // 14 articles finished (below 15): remains on baseline defaults
  for (let i = 1; i < CALIBRATION_ARTICLE_THRESHOLD; i++) {
    const res = recordCompletedReadingSession(profile, {
      articleId: `en_${i}`,
      text: en10k,
      activeMs: 5 * 60 * 1000, // 5 minutes for 10,000 words = 2,000 WPM
    });
    profile = res.nextProfile;
    assert.equal(res.recorded, true);
    assert.equal(res.language, 'en');
    assert.equal(res.justCalibrated, false);
    assert.equal(res.learnedWpm, null);
  }

  const preCalEstimate = estimateArticleReadTime({ contentClean: en10k }, profile);
  assert.equal(preCalEstimate.isPersonalized, false);
  assert.equal(preCalEstimate.wpmUsed, DEFAULT_EN_WPM);

  // 15th article triggers calibration -> English calibrated to 5 min (2,000 WPM)
  const calEn = recordCompletedReadingSession(profile, {
    articleId: `en_${CALIBRATION_ARTICLE_THRESHOLD}`,
    text: en10k,
    activeMs: 5 * 60 * 1000,
  });
  profile = calEn.nextProfile;
  assert.equal(calEn.justCalibrated, true);
  assert.equal(calEn.totalObservedCount, 15);
  assert.equal(calEn.learnedWpm, 2000);

  const postEnEstimate = estimateArticleReadTime({ contentClean: en10k }, profile);
  assert.equal(postEnEstimate.isPersonalized, true);
  assert.equal(postEnEstimate.language, 'en');
  assert.equal(postEnEstimate.minutes, 5);

  // Bangla with 0 reads scales from Bangla baseline (190) rather than cloning English baseline (220)
  const crossBnEstimate = estimateArticleReadTime({ contentClean: bn10k }, profile);
  assert.equal(crossBnEstimate.isPersonalized, true);
  assert.equal(crossBnEstimate.language, 'bn');
  assert.notEqual(crossBnEstimate.wpmUsed, postEnEstimate.wpmUsed);

  // Observe 15 Bangla articles of 10,000 words finished in 4 minutes each -> 2,500 WPM
  for (let i = 1; i <= CALIBRATION_ARTICLE_THRESHOLD; i++) {
    const res = recordCompletedReadingSession(profile, {
      articleId: `bn_${i}`,
      text: bn10k,
      activeMs: 4 * 60 * 1000,
    });
    profile = res.nextProfile;
    if (i === CALIBRATION_ARTICLE_THRESHOLD) {
      assert.equal(res.justCalibrated, true);
      assert.equal(res.learnedWpm, 2500);
    }
  }

  // English predicts 5 minutes while Bangla predicts 4 minutes
  const finalEn = estimateArticleReadTime({ contentClean: en10k }, profile);
  const finalBn = estimateArticleReadTime({ contentClean: bn10k }, profile);
  assert.equal(finalEn.minutes, 5);
  assert.equal(finalBn.minutes, 4);
  assert.notEqual(finalEn.wpmUsed, finalBn.wpmUsed);
});

test('calibrates at 15 total articles across mixed English and Bangla reads and factors line counts', () => {
  let profile = createDefaultReadingSpeedProfile();

  // 10 English reads (mixed dense & line-heavy so Ridge learns both word & line costs)
  for (let i = 1; i <= 10; i++) {
    const isLineHeavy = i % 2 === 0;
    const text = isLineHeavy
      ? makeLineFormattedEnglish(4, 150) // 600 words across 150 short lines
      : makeLineFormattedEnglish(30, 20); // 600 words across 20 paragraphs
    const res = recordCompletedReadingSession(profile, {
      articleId: `mix_en_${i}`,
      text,
      activeMs: isLineHeavy ? 210_000 : 120_000, // 3.5m vs 2m for the same 600 words
    });
    profile = res.nextProfile;
    assert.equal(res.justCalibrated, false);
  }

  // 4 Bangla reads (total = 14 < 15 -> still uncalibrated)
  for (let i = 1; i <= 4; i++) {
    const res = recordCompletedReadingSession(profile, {
      articleId: `mix_bn_${i}`,
      text: makeBanglaText(600),
      activeMs: 150_000,
    });
    profile = res.nextProfile;
    assert.equal(res.justCalibrated, false);
  }
  assert.equal(estimateArticleReadTime({ contentClean: makeBanglaText(600) }, profile).isPersonalized, false);

  // 5th Bangla read reaches 15 total articles -> calibrates both languages!
  const fifteenth = recordCompletedReadingSession(profile, {
    articleId: 'mix_bn_5',
    text: makeBanglaText(600),
    activeMs: 150_000,
  });
  profile = fifteenth.nextProfile;
  assert.equal(fifteenth.totalObservedCount, 15);
  assert.equal(fifteenth.justCalibrated, true);

  // Same 600 words, but 150 short lines vs 20 dense paragraphs -> predicts longer for 150 lines
  const dense600 = makeLineFormattedEnglish(30, 20);
  const shortLines600 = makeLineFormattedEnglish(4, 150);
  assert.ok(countLines(shortLines600, 'en') > countLines(dense600, 'en'));

  const denseEst = estimateArticleReadTime({ contentClean: dense600 }, profile);
  const lineHeavyEst = estimateArticleReadTime({ contentClean: shortLines600 }, profile);
  assert.equal(denseEst.isPersonalized, true);
  assert.equal(lineHeavyEst.isPersonalized, true);
  assert.ok(lineHeavyEst.predictedSeconds > denseEst.predictedSeconds);
  assert.ok(lineHeavyEst.minutes >= denseEst.minutes);
});

test('deduplicates re-opened articleId, ignores tiny snippets, and normalizes legacy profiles', () => {
  let profile = createDefaultReadingSpeedProfile();
  const en500 = makeEnglishText(500);

  const tooFast = recordCompletedReadingSession(profile, {
    articleId: 'a1',
    text: en500,
    activeMs: 1200,
  });
  assert.equal(tooFast.recorded, false);
  assert.equal(tooFast.observedCount, 0);

  const tooTiny = recordCompletedReadingSession(profile, {
    articleId: 'a2',
    text: makeEnglishText(15),
    activeMs: 15000,
  });
  assert.equal(tooTiny.recorded, false);

  const first = recordCompletedReadingSession(profile, {
    articleId: 'a3',
    text: en500,
    activeMs: 60000,
  });
  profile = first.nextProfile;
  assert.equal(first.observedCount, 1);

  const second = recordCompletedReadingSession(profile, {
    articleId: 'a3',
    text: en500,
    activeMs: 65000,
  });
  assert.equal(second.observedCount, 1);

  // Legacy profile without lineCount normalizes safely
  const legacy = normalizeReadingSpeedProfile({
    en: {
      observedCount: 15,
      learnedWpm: 300,
      observations: Array.from({ length: 15 }, (_, idx) => ({
        articleId: `leg_${idx}`,
        language: 'en',
        wordCount: 600,
        activeMs: 120000,
        wpm: 300,
        timestamp: Date.now(),
      })),
    },
    bn: { observedCount: 0, learnedWpm: null, observations: [] },
  });
  assert.equal(legacy.en.observations[0].lineCount, 75);
  assert.equal(legacy.en.learnedWpm, 300);
});

test('countWords and countLines handle English, Bangla, and HTML line breaks accurately', () => {
  assert.equal(countWords('Hello — world । বাংলাদেশ ২০২৬ !'), 4);
  const tenShortLines = Array.from({ length: 10 }, () => 'Short line here').join('\n');
  const oneParagraph = Array.from({ length: 10 }, () => 'Short line here').join(' ');
  assert.ok(countLines(tenShortLines, 'en') > countLines(oneParagraph, 'en'));
});
